#!/usr/bin/env python3
"""
Enrich bills with LLM-generated educational content

This script:
1. Reads bill text from bill_embeddings table (PDF extracted text)
2. Reads debate summaries from bill_debate_summary table
3. Uses OpenAI to generate educational content for each bill
4. Stores enrichments in bill_enrichment table

Generated content includes:
- Short summary (one-liner for quick scanning)
- Detailed plain-language summary (for citizens)
- Key points (who is affected, what changes, when it takes effect)
- Impact tags (for filtering/categorization)
- Pros and cons (from debate analysis)
- Example scenario (concrete impact illustration)

Usage:
    pnpm enrich:bills --limit 10
    pnpm enrich:bills --bill-id 1427 --force
    pnpm enrich:bills --batch --limit 100
    pnpm enrich:bills --batch-status batch_abc123
    pnpm enrich:bills --batch-results batch_abc123
"""

import os
import sys
import json
import hashlib
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Optional, Any

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

try:
    import openai
except ImportError:
    print("openai package not installed. Run: pip install openai")
    sys.exit(1)

DELAY_BETWEEN_REQUESTS = 0.5  # Reduced delay for efficiency
LLM_MODEL = "gpt-5.4-nano"  # 400K context, 128K output, cheapest GPT-5.4-class
MAX_PDF_CHARS = 100000  # Use more of the bill text with large context window


def hash_text(text: str) -> str:
    """Generate MD5 hash of text for change detection."""
    return hashlib.md5(text.encode()).hexdigest()


def generate_enrichment(
    client: openai.OpenAI,
    bill_title: str,
    pdf_text: Optional[str],
    debate_summary: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Generate enrichment content using OpenAI API."""

    prompt = build_enrichment_prompt(bill_title, pdf_text, debate_summary)

    response = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        response_format={"type": "json_object"},
    )

    result = json.loads(response.choices[0].message.content)

    # Validate required fields
    if not result.get("summaryShort") or not result.get("summaryDetailed"):
        raise ValueError("Missing required fields in response")

    return result


def build_enrichment_prompt(
    bill_title: str,
    pdf_text: Optional[str],
    debate_summary: Optional[Dict[str, Any]],
) -> str:
    """Build the enrichment prompt for a bill."""

    # Build context from available sources
    context = f"法案名: {bill_title}\n\n"

    if pdf_text:
        # Use more of the PDF text with larger context window
        truncated_pdf = pdf_text[:MAX_PDF_CHARS]
        if len(pdf_text) > MAX_PDF_CHARS:
            context += (
                f"法案本文 (抜粋、全{len(pdf_text):,}" f"文字中):\n{truncated_pdf}\n\n"
            )
        else:
            context += f"法案本文:\n{truncated_pdf}\n\n"

    # Add debate summary if available (from bill_debate_summary table)
    if debate_summary:
        context += "国会での議論の要約:\n"

        pro_args = debate_summary.get("pro_arguments", [])
        if pro_args:
            context += "【賛成派の論点】\n"
            for arg in pro_args:
                context += f"  - {arg}\n"

        con_args = debate_summary.get("con_arguments", [])
        if con_args:
            context += "【反対派の論点】\n"
            for arg in con_args:
                context += f"  - {arg}\n"

        key_questions = debate_summary.get("key_questions", [])
        if key_questions:
            context += "【主な質問】\n"
            for q in key_questions:
                context += f"  - {q}\n"

        gov_explanations = debate_summary.get("gov_explanations", [])
        if gov_explanations:
            context += "【政府の説明】\n"
            for exp in gov_explanations:
                context += f"  - {exp}\n"

        context += "\n"

    prompt = f"""あなたは日本の法律を一般市民にわかりやすく説明する専門家です。\
以下の法案情報を分析し、指定されたJSON形式で情報を生成してください。

{context}

以下の形式で回答してください。必ず有効なJSONで返してください：

{{
  "summaryShort": "50〜80文字の一行要約。専門用語を避け、この法案が何をするのかを簡潔に説明",
  "summaryDetailed": "200〜300文字の詳細説明。高校生でも理解できる平易な言葉で、法案の目的と内容を説明",
  "keyPoints": [
    {{
      "who": "影響を受ける人や組織（例：年収500万円以上の個人）",
      "what": "何が変わるか（例：所得税率が20%から25%に増加）",
      "when": "いつから施行されるか（不明な場合は「公布後」など）"
    }}
  ],
  "impactTags": ["#タグ1", "#タグ2", "#タグ3"],
  "prosAndCons": {{
    "pros": ["賛成派の論点1", "賛成派の論点2", "賛成派の論点3"],
    "cons": ["反対派の論点1", "反対派の論点2", "反対派の論点3"]
  }},
  "exampleScenario": "もしこの法案が成立したら...という形で、具体的な例を挙げて影響を説明（100〜150文字）"
}}

重要な注意点：
- 中立的な立場を保ち、「良い」「悪い」などの評価語は使わない
- 「Aの観点からはメリット」「Bの観点からはデメリット」のように主体を明示する
- 条文で使われている正式名称を基本とし、必要に応じて括弧で簡単な説明を付ける
- 不確かな情報は推測せず、確認できる情報のみを含める
- keyPointsは1〜3項目、impactTagsは3〜5個、pros/consは各2〜3個を目安にする"""

    return prompt


def get_bills_to_enrich(
    conn,
    limit: Optional[int],
    force_regenerate: bool,
    bill_id: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Get bills that need enrichment."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    # If specific bill_id is provided, fetch only that bill
    if bill_id:
        query = """
        SELECT
            b.id,
            b.title,
            bem.text_content as pdf_text,
            be.status,
            (SELECT COUNT(*)
             FROM bill_debates db
             WHERE db.bill_id = b.id
            ) as debate_count
        FROM bill b
        LEFT JOIN bill_embeddings bem
            ON b.id = bem.bill_id
        LEFT JOIN bill_enrichment be
            ON b.id = be.bill_id
        WHERE b.id = %s
        """
        cursor.execute(query, (bill_id,))
        bills = cursor.fetchall()
        cursor.close()
        return bills

    where_clause = (
        "1=1"
        if force_regenerate
        else """
        (be.bill_id IS NULL
         OR be.status = 'pending'
         OR be.status = 'failed')
    """
    )

    limit_clause = f"LIMIT {limit}" if limit else ""
    query = f"""
    SELECT
        b.id,
        b.title,
        bem.text_content as pdf_text,
        be.status,
        (SELECT COUNT(*)
         FROM bill_debates db
         WHERE db.bill_id = b.id) as debate_count
    FROM bill b
    LEFT JOIN bill_embeddings bem
        ON b.id = bem.bill_id
    LEFT JOIN bill_enrichment be
        ON b.id = be.bill_id
    WHERE {where_clause}
    ORDER BY
        (SELECT COUNT(*)
         FROM bill_debates db
         WHERE db.bill_id = b.id) DESC,
        bem.text_content IS NOT NULL DESC,
        b.submission_session DESC
    {limit_clause}
    """

    cursor.execute(query)
    bills = cursor.fetchall()
    cursor.close()

    return bills


def get_debate_summary_for_bill(
    conn,
    bill_id: int,
) -> Optional[Dict[str, Any]]:
    """Get debate summary for a specific bill
    from bill_debate_summary table."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    query = """
    SELECT
        pro_arguments_summary,
        con_arguments_summary,
        key_questions,
        government_explanations,
        debate_count
    FROM bill_debate_summary
    WHERE bill_id = %s
        AND status = 'completed'
    """

    cursor.execute(query, (bill_id,))
    result = cursor.fetchone()
    cursor.close()

    if not result:
        return None

    # Parse JSON fields
    try:
        pro_args = json.loads(result["pro_arguments_summary"] or "[]")
        con_args = json.loads(result["con_arguments_summary"] or "[]")
        key_q = json.loads(result["key_questions"] or "[]")
        gov_exp = json.loads(result["government_explanations"] or "[]")
        return {
            "pro_arguments": pro_args,
            "con_arguments": con_args,
            "key_questions": key_q,
            "gov_explanations": gov_exp,
            "debate_count": result["debate_count"],
        }
    except json.JSONDecodeError:
        return None


def upsert_enrichment(
    conn,
    bill_id: int,
    status: str,
    result: Optional[Dict] = None,
    error: Optional[str] = None,
):
    """Insert or update enrichment record."""
    cursor = conn.cursor()

    if result:
        query = """
        INSERT INTO bill_enrichment (
            bill_id, summary_short,
            summary_detailed, key_points,
            impact_tags, pros_and_cons,
            example_scenario,
            status, llm_model,
            source_text_hash, error_message,
            created_at, updated_at
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW()
        )
        ON CONFLICT (bill_id) DO UPDATE SET
            summary_short = EXCLUDED.summary_short,
            summary_detailed = EXCLUDED.summary_detailed,
            key_points = EXCLUDED.key_points,
            impact_tags = EXCLUDED.impact_tags,
            pros_and_cons = EXCLUDED.pros_and_cons,
            example_scenario = EXCLUDED.example_scenario,
            status = EXCLUDED.status,
            llm_model = EXCLUDED.llm_model,
            source_text_hash = EXCLUDED.source_text_hash,
            error_message = EXCLUDED.error_message,
            updated_at = NOW()
        """
        cursor.execute(
            query,
            (
                bill_id,
                result.get("summaryShort"),
                result.get("summaryDetailed"),
                json.dumps(
                    result.get("keyPoints", []),
                    ensure_ascii=False,
                ),
                json.dumps(
                    result.get("impactTags", []),
                    ensure_ascii=False,
                ),
                json.dumps(
                    result.get("prosAndCons", {}),
                    ensure_ascii=False,
                ),
                result.get("exampleScenario"),
                status,
                LLM_MODEL,
                result.get("sourceHash"),
                error,
            ),
        )
    else:
        query = """
        INSERT INTO bill_enrichment
            (bill_id, status, error_message,
             created_at, updated_at)
        VALUES (%s, %s, %s, NOW(), NOW())
        ON CONFLICT (bill_id) DO UPDATE SET
            status = EXCLUDED.status,
            error_message = EXCLUDED.error_message,
            updated_at = NOW()
        """
        cursor.execute(query, (bill_id, status, error))

    conn.commit()
    cursor.close()


def prepare_batch_requests(
    conn,
    bills: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Prepare batch API request lines for all bills."""
    requests = []
    for bill in bills:
        if not bill["title"]:
            continue

        debate_summary = get_debate_summary_for_bill(conn, bill["id"])
        prompt = build_enrichment_prompt(
            bill["title"],
            bill.get("pdf_text"),
            debate_summary,
        )

        request_line = {
            "custom_id": f"enrich-{bill['id']}",
            "method": "POST",
            "url": "/v1/chat/completions",
            "body": {
                "model": LLM_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.3,
                "response_format": {"type": "json_object"},
            },
        }
        requests.append(request_line)
    return requests


def submit_batch(
    client: openai.OpenAI,
    requests: List[Dict[str, Any]],
) -> str:
    """Write JSONL, upload, and submit a batch job. Returns batch ID."""
    # Write JSONL to temp file
    with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
        for req in requests:
            f.write(json.dumps(req, ensure_ascii=False) + "\n")
        jsonl_path = f.name

    print(f"Wrote {len(requests)} requests to {jsonl_path}")

    # Upload file
    with open(jsonl_path, "rb") as f:
        file_obj = client.files.create(file=f, purpose="batch")
    print(f"Uploaded file: {file_obj.id}")

    # Create batch
    batch = client.batches.create(
        input_file_id=file_obj.id,
        endpoint="/v1/chat/completions",
        completion_window="24h",
        metadata={"script": "enrich_bills", "model": LLM_MODEL},
    )
    print(f"Batch created: {batch.id}")
    print(f"Status: {batch.status}")

    # Clean up temp file
    os.unlink(jsonl_path)

    return batch.id


def check_batch_status(client: openai.OpenAI, batch_id: str):
    """Check and print the status of a batch job."""
    batch = client.batches.retrieve(batch_id)
    print(f"Batch ID: {batch.id}")
    print(f"Status: {batch.status}")
    print(f"Request counts: {batch.request_counts}")
    if batch.output_file_id:
        print(f"Output file: {batch.output_file_id}")
    if batch.error_file_id:
        print(f"Error file: {batch.error_file_id}")
    return batch


def retrieve_batch_results(
    client: openai.OpenAI,
    conn,
    batch_id: str,
):
    """Retrieve batch results and save to database."""
    batch = client.batches.retrieve(batch_id)

    if batch.status != "completed":
        print(f"Batch {batch_id} is not completed yet." f" Status: {batch.status}")
        if batch.status == "failed":
            print("Batch failed. Check error file for details.")
            if batch.error_file_id:
                error_content = client.files.content(batch.error_file_id)
                print(error_content.text)
        return

    if not batch.output_file_id:
        print("No output file available.")
        return

    # Download results
    content = client.files.content(batch.output_file_id)
    results_text = content.text

    success_count = 0
    error_count = 0

    for line in results_text.strip().split("\n"):
        if not line:
            continue
        result_obj = json.loads(line)
        custom_id = result_obj["custom_id"]
        bill_id = int(custom_id.replace("enrich-", ""))

        response = result_obj.get("response")
        error = result_obj.get("error")

        if error:
            print(f"  Bill {bill_id}: Error - {error}")
            upsert_enrichment(
                conn,
                bill_id,
                "failed",
                error=json.dumps(error, ensure_ascii=False),
            )
            error_count += 1
            continue

        if response and response.get("status_code") == 200:
            body = response["body"]
            content_str = body["choices"][0]["message"]["content"]
            result = json.loads(content_str)

            if not result.get("summaryShort") or not result.get("summaryDetailed"):
                upsert_enrichment(
                    conn,
                    bill_id,
                    "failed",
                    error="Missing required fields",
                )
                error_count += 1
                continue

            result["sourceHash"] = ""
            upsert_enrichment(conn, bill_id, "completed", result)
            success_count += 1
            print(f"  Bill {bill_id}: ✓" f" {result['summaryShort'][:50]}...")
        else:
            status_code = response.get("status_code") if response else "N/A"
            upsert_enrichment(
                conn,
                bill_id,
                "failed",
                error=f"HTTP {status_code}",
            )
            error_count += 1

    print(f"\nResults: {success_count} success, {error_count} errors")


def main():
    import argparse
    import time

    parser = argparse.ArgumentParser(
        description=("Enrich bills with LLM-generated content")
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Number of bills to process" " (default: all)",
    )
    parser.add_argument(
        "--bill-id",
        type=int,
        help="Process a specific bill by ID",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force regeneration of" " existing enrichments",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=3,
        help="Number of parallel workers" " (default: 3)",
    )
    parser.add_argument(
        "--batch",
        action="store_true",
        help="Submit as OpenAI Batch API job" " (50%% cheaper, results within 24h)",
    )
    parser.add_argument(
        "--batch-status",
        type=str,
        metavar="BATCH_ID",
        help="Check status of a batch job",
    )
    parser.add_argument(
        "--batch-results",
        type=str,
        metavar="BATCH_ID",
        help="Retrieve and save results" " from a completed batch job",
    )
    args = parser.parse_args()

    # Check environment variables
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("Error: DATABASE_URL environment variable is required")
        sys.exit(1)

    openai_api_key = os.getenv("OPENAI_API_KEY")
    if not openai_api_key:
        print("Error: OPENAI_API_KEY environment variable is required")
        sys.exit(1)

    # Initialize OpenAI client
    client = openai.OpenAI(api_key=openai_api_key)

    # Handle batch status check (no DB needed)
    if args.batch_status:
        check_batch_status(client, args.batch_status)
        return

    # Initialize DB connection
    conn = psycopg2.connect(database_url)

    # Handle batch results retrieval
    if args.batch_results:
        print("Retrieving batch results...")
        retrieve_batch_results(client, conn, args.batch_results)
        conn.close()
        return

    print("=" * 60)
    print("Enriching Bills with LLM-generated Content")
    print("=" * 60)
    if args.bill_id:
        print(f"Bill ID: {args.bill_id}")
    else:
        print(f"Limit: {args.limit or 'all'}")
    print(f"Force regenerate: {args.force}")
    print(f"Mode: {'batch' if args.batch else 'synchronous'}")
    if not args.batch:
        print(f"Concurrency: {args.concurrency}")
    print("")

    # Get bills to process
    bills = get_bills_to_enrich(
        conn,
        args.limit,
        args.force,
        bill_id=args.bill_id,
    )
    print(f"Found {len(bills)} bills to process")

    # Skip bills that have neither PDF text nor debate records
    if not args.bill_id:
        original_count = len(bills)
        bills = [b for b in bills if b.get("pdf_text") or b["debate_count"] > 0]
        skipped = original_count - len(bills)
        if skipped > 0:
            print(f"Skipped {skipped} bills with no PDF" " text and no debate records")
    print(f"Processing {len(bills)} bills")
    print("")

    # Batch mode: prepare and submit
    if args.batch:
        print("Preparing batch requests...")
        requests = prepare_batch_requests(conn, bills)
        print(f"Prepared {len(requests)} requests")
        if not requests:
            print("No requests to submit.")
            conn.close()
            return
        batch_id = submit_batch(client, requests)
        print(f"\nBatch submitted! ID: {batch_id}")
        print(f"Check status:  pnpm enrich:bills --batch-status {batch_id}")
        print(f"Get results:   pnpm enrich:bills --batch-results {batch_id}")
        conn.close()
        return

    # Thread-safe counter
    lock = threading.Lock()
    results = {"success": 0, "error": 0}

    def process_bill(bill_index: int, bill: Dict[str, Any]) -> bool:
        """Process a single bill - runs in a thread."""
        # Each thread needs its own DB connection and OpenAI client
        thread_conn = psycopg2.connect(database_url)
        thread_client = openai.OpenAI(api_key=openai_api_key)

        bill_num = bill_index + 1
        prefix = f"[Bill {bill_num}/{len(bills)}]"

        if not bill["title"]:
            print(f"{prefix} Skipping: No title available")
            thread_conn.close()
            return False

        try:
            print(f"{prefix} {bill['title']}")

            # Mark as processing
            upsert_enrichment(thread_conn, bill["id"], "processing")

            # Get debate summary for this bill
            debate_summary = get_debate_summary_for_bill(thread_conn, bill["id"])
            if debate_summary:
                pro_count = len(debate_summary.get("pro_arguments", []))
                con_count = len(debate_summary.get("con_arguments", []))
                print(
                    f"{prefix}   Debate summary:"
                    f" {pro_count} pro,"
                    f" {con_count} con"
                )
            else:
                print(f"{prefix}   No debate" " summary available")

            # Generate enrichment content
            result = generate_enrichment(
                thread_client,
                bill["title"],
                bill.get("pdf_text"),
                debate_summary,
            )

            # Build source text hash for change detection
            pdf_excerpt = (bill.get("pdf_text") or "")[:1000]
            source_text = f"{bill['title']}|{pdf_excerpt}"
            result["sourceHash"] = hash_text(source_text)

            # Save to database
            upsert_enrichment(thread_conn, bill["id"], "completed", result)

            print(f"{prefix}   ✓ Enrichment completed")
            short_summary = result["summaryShort"][:50]
            print(f"{prefix}     Short: {short_summary}...")

            with lock:
                results["success"] += 1

            return True

        except Exception as e:
            print(f"{prefix}   ✗ Error: {e}")
            upsert_enrichment(thread_conn, bill["id"], "failed", error=str(e))
            with lock:
                results["error"] += 1
            return False

        finally:
            thread_conn.close()

    # Process bills with concurrency
    if args.concurrency > 1:
        print(f"Processing with {args.concurrency} parallel workers...\n")
        with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
            futures = {
                executor.submit(process_bill, i, bill): bill
                for i, bill in enumerate(bills)
            }
            for future in as_completed(futures):
                # Results are already tracked in the results dict
                pass
    else:
        # Sequential processing
        for i, bill in enumerate(bills):
            process_bill(i, bill)
            time.sleep(DELAY_BETWEEN_REQUESTS)

    print("")
    print("=" * 60)
    print("Completed:" f" {results['success']} success," f" {results['error']} errors")
    print("=" * 60)

    conn.close()


if __name__ == "__main__":
    main()
