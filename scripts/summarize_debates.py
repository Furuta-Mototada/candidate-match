#!/usr/bin/env python3
"""
Summarize debate records into structured summaries using LLM

This script:
1. Reads raw debate speeches from bill_debates table
2. Uses OpenAI to categorize and summarize debates
3. Stores summaries in bill_debate_summary table

The summaries are then used by enrich_bills.py for better enrichment.

Usage:
    pnpm summarize:debates --limit 10
    pnpm summarize:debates --bill-id 1427 --force
    pnpm summarize:debates --concurrency 3  # Process 3 bills in parallel
    pnpm summarize:debates --batch --limit 100
    pnpm summarize:debates --batch-status batch_abc123
    pnpm summarize:debates --batch-results batch_abc123
"""

import os
import sys
import json
import argparse
import tempfile
import time
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
MAX_CONTEXT_CHARS = 300000  # ~75K tokens, fits well in 400K context
MAX_SPEECH_CHARS = 3000  # Allow longer individual speeches
CHUNK_SIZE = 100  # Number of speeches per chunk for hierarchical summarization


def get_bills_with_debates(
    conn, limit: Optional[int], force: bool, bill_id: Optional[int]
) -> List[Dict[str, Any]]:
    """Get bills that have debates and need summarization."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    if bill_id:
        query = """
        SELECT b.id, b.title, COUNT(db.id) as debate_count
        FROM bill b
        INNER JOIN bill_debates db ON b.id = db.bill_id
        WHERE b.id = %s
        GROUP BY b.id, b.title
        """
        cursor.execute(query, (bill_id,))
    else:
        where_clause = (
            "1=1"
            if force
            else """
            NOT EXISTS (
                SELECT 1 FROM bill_debate_summary bds
                WHERE bds.bill_id = b.id AND bds.status = 'completed'
            )
        """
        )
        limit_clause = f"LIMIT {limit}" if limit else ""
        query = f"""
        SELECT b.id, b.title, COUNT(db.id) as debate_count
        FROM bill b
        INNER JOIN bill_debates db ON b.id = db.bill_id
        WHERE {where_clause}
        GROUP BY b.id, b.title
        HAVING COUNT(db.id) > 0
        ORDER BY COUNT(db.id) DESC
        {limit_clause}
        """
        cursor.execute(query)

    bills = cursor.fetchall()
    cursor.close()
    return bills


def get_debates_for_bill(conn, bill_id: int) -> List[Dict[str, Any]]:
    """Get all debate records for a bill."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    query = """
    SELECT
        speech_content,
        speaker_name,
        speaker_position,
        speaker_group,
        speaker_role,
        house,
        meeting_name,
        meeting_date,
        speech_order
    FROM bill_debates
    WHERE bill_id = %s
    ORDER BY meeting_date, speech_order
    """

    cursor.execute(query, (bill_id,))
    debates = cursor.fetchall()
    cursor.close()
    return debates


def format_speech(debate: Dict[str, Any]) -> str:
    """Format a single speech for context."""
    speaker = debate.get("speaker_name", "")
    position = debate.get("speaker_position", "")
    group = debate.get("speaker_group", "")
    role = debate.get("speaker_role", "")
    house = debate.get("house", "")
    content = debate.get("speech_content", "")

    # Build speaker label
    speaker_label = speaker
    if position:
        speaker_label = f"{position} {speaker}"
    if group:
        speaker_label += f" ({group})"
    if role:
        speaker_label += f" [{role}]"

    # Truncate very long speeches but keep more content
    if len(content) > MAX_SPEECH_CHARS:
        content = content[:MAX_SPEECH_CHARS] + "..."

    return f"【{house}・{speaker_label}】\n{content}\n"


def summarize_chunk(
    client: openai.OpenAI,
    bill_title: str,
    chunk_texts: List[str],
    chunk_num: int,
) -> Dict[str, Any]:
    """Summarize a chunk of debates."""
    debates_context = "\n".join(chunk_texts)

    prompt = f"""あなたは国会議事録の分析専門家です。以下の法案に関する国会での議論（パート{chunk_num}）を分析してください。

法案名: {bill_title}

===== 議事録 =====
{debates_context}

===== 分析指示 =====
以下のJSON形式で、このパートの議論の要点を整理してください：

{{
  "proArguments": ["賛成派の論点（立場を明示）"],
  "conArguments": ["反対派の論点（立場を明示）"],
  "keyQuestions": ["議員から出された重要な質問"],
  "governmentExplanations": ["政府・担当大臣からの主な説明"],
  "keyPoints": ["その他の重要な議論ポイント"]
}}

注意事項：
- 各カテゴリは0〜5項目
- 該当がなければ空配列
- 具体的な数字や事例を含める
- 必ず有効なJSONで返答すること"""

    response = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        response_format={"type": "json_object"},
    )

    return json.loads(response.choices[0].message.content)


def merge_chunk_summaries(
    client: openai.OpenAI,
    bill_title: str,
    chunk_summaries: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Merge multiple chunk summaries into a final summary."""
    # Combine all points from chunks
    all_pro = []
    all_con = []
    all_questions = []
    all_gov = []
    all_key = []

    for summary in chunk_summaries:
        all_pro.extend(summary.get("proArguments", []))
        all_con.extend(summary.get("conArguments", []))
        all_questions.extend(summary.get("keyQuestions", []))
        all_gov.extend(summary.get("governmentExplanations", []))
        all_key.extend(summary.get("keyPoints", []))

    # Create context for final merge
    merge_context = f"""法案名: {bill_title}

各パートから抽出された議論ポイント:

【賛成派の論点】({len(all_pro)}件)
{chr(10).join(f'- {p}' for p in all_pro)}

【反対派の論点】({len(all_con)}件)
{chr(10).join(f'- {c}' for c in all_con)}

【重要な質問】({len(all_questions)}件)
{chr(10).join(f'- {q}' for q in all_questions)}

【政府の説明】({len(all_gov)}件)
{chr(10).join(f'- {g}' for g in all_gov)}

【その他重要ポイント】({len(all_key)}件)
{chr(10).join(f'- {k}' for k in all_key)}"""

    prompt = f"""あなたは国会議事録の分析専門家です。以下は法案に関する議論を複数パートに分けて分析した結果です。
これらを統合し、重複を除去して最終的な要約を作成してください。

{merge_context}

===== 統合指示 =====
以下のJSON形式で、統合された要約を作成してください：

{{
  "proArguments": [
    "賛成派の論点1（どの立場からのメリットか明示）",
    "賛成派の論点2",
    "賛成派の論点3"
  ],
  "conArguments": [
    "反対派の論点1（どの立場からの懸念か明示）",
    "反対派の論点2",
    "反対派の論点3"
  ],
  "keyQuestions": [
    "議員から出された重要な質問1",
    "議員から出された重要な質問2"
  ],
  "governmentExplanations": [
    "政府・担当大臣からの主な説明1",
    "政府・担当大臣からの主な説明2"
  ],
  "summary": "この法案の議論で最も注目すべき点を100文字程度で要約"
}}

注意事項：
- 重複する論点は統合する
- 各カテゴリは2〜5項目を目安にする
- 最も重要な論点を優先的に選ぶ
- 具体的な数字や事例があれば含める
- 必ず有効なJSONで返答すること"""

    response = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        response_format={"type": "json_object"},
    )

    return json.loads(response.choices[0].message.content)


def summarize_debates(
    client: openai.OpenAI,
    bill_title: str,
    debates: List[Dict[str, Any]],
    prefix: str = "",
) -> Dict[str, Any]:
    """Use LLM to summarize debate records with hierarchical processing."""

    # Format all speeches
    formatted_speeches = [format_speech(d) for d in debates]

    # Calculate total context size
    total_chars = sum(len(s) for s in formatted_speeches)
    print(f"{prefix}   Total: {total_chars:,} chars ({len(debates)} speeches)")

    # If fits in single context, process directly
    if total_chars <= MAX_CONTEXT_CHARS:
        debates_context = "\n".join(formatted_speeches)
        return summarize_single(client, bill_title, debates_context)

    # Hierarchical summarization for large debates
    print(f"{prefix}   Using hierarchical summarization")

    # Split into chunks
    chunks = []
    current_chunk = []
    current_size = 0

    for speech in formatted_speeches:
        if current_size + len(speech) > MAX_CONTEXT_CHARS and current_chunk:
            chunks.append(current_chunk)
            current_chunk = []
            current_size = 0
        current_chunk.append(speech)
        current_size += len(speech)

    if current_chunk:
        chunks.append(current_chunk)

    print(f"{prefix}   Split into {len(chunks)} chunks")

    # Summarize each chunk
    chunk_summaries = []
    for i, chunk in enumerate(chunks):
        print(f"{prefix}   Processing chunk {i + 1}/{len(chunks)}...")
        summary = summarize_chunk(client, bill_title, chunk, i + 1)
        chunk_summaries.append(summary)
        time.sleep(DELAY_BETWEEN_REQUESTS)

    # Merge chunk summaries
    print(f"{prefix}   Merging chunk summaries...")
    return merge_chunk_summaries(client, bill_title, chunk_summaries)


def build_single_summary_prompt(bill_title: str, debates_context: str) -> str:
    """Build the prompt for single-context debate summarization."""
    return f"""あなたは国会議事録の分析専門家です。以下の法案に関する国会での議論を分析し、構造化された要約を作成してください。

法案名: {bill_title}

===== 議事録 =====
{debates_context}

===== 分析指示 =====
以下のJSON形式で、議論の要点を整理してください：

{{
  "proArguments": [
    "賛成派の論点1（どの立場からのメリットか明示）",
    "賛成派の論点2",
    "賛成派の論点3"
  ],
  "conArguments": [
    "反対派の論点1（どの立場からの懸念か明示）",
    "反対派の論点2",
    "反対派の論点3"
  ],
  "keyQuestions": [
    "議員から出された重要な質問1",
    "議員から出された重要な質問2"
  ],
  "governmentExplanations": [
    "政府・担当大臣からの主な説明1",
    "政府・担当大臣からの主な説明2"
  ],
  "summary": "この法案の議論で最も注目すべき点を100文字程度で要約"
}}

注意事項：
- 各カテゴリは2〜5項目を目安にする
- 具体的な数字や事例があれば含める
- 「〇〇の観点からは」のように、どの立場からの意見かを明示する
- 質問が見つからない場合は空配列でよい
- 必ず有効なJSONで返答すること"""


def summarize_single(
    client: openai.OpenAI, bill_title: str, debates_context: str
) -> Dict[str, Any]:
    """Summarize debates that fit in a single context."""
    prompt = build_single_summary_prompt(bill_title, debates_context)

    response = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        response_format={"type": "json_object"},
    )

    return json.loads(response.choices[0].message.content)


def upsert_debate_summary(
    conn,
    bill_id: int,
    debate_count: int,
    status: str,
    result: Optional[Dict] = None,
    error: Optional[str] = None,
):
    """Insert or update debate summary record."""
    cursor = conn.cursor()

    if result:
        query = """
        INSERT INTO bill_debate_summary (
            bill_id,
            pro_arguments_summary,
            con_arguments_summary,
            key_questions,
            government_explanations,
            debate_count,
            status,
            llm_model,
            error_message,
            created_at,
            updated_at
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW()
        )
        ON CONFLICT (bill_id) DO UPDATE SET
            pro_arguments_summary = EXCLUDED.pro_arguments_summary,
            con_arguments_summary = EXCLUDED.con_arguments_summary,
            key_questions = EXCLUDED.key_questions,
            government_explanations = EXCLUDED.government_explanations,
            debate_count = EXCLUDED.debate_count,
            status = EXCLUDED.status,
            llm_model = EXCLUDED.llm_model,
            error_message = EXCLUDED.error_message,
            updated_at = NOW()
        """
        cursor.execute(
            query,
            (
                bill_id,
                json.dumps(result.get("proArguments", []), ensure_ascii=False),
                json.dumps(result.get("conArguments", []), ensure_ascii=False),
                json.dumps(result.get("keyQuestions", []), ensure_ascii=False),
                json.dumps(
                    result.get("governmentExplanations", []),
                    ensure_ascii=False,
                ),
                debate_count,
                status,
                LLM_MODEL,
                error,
            ),
        )
    else:
        query = """
        INSERT INTO bill_debate_summary
            (bill_id, debate_count, status,
             error_message, created_at, updated_at)
        VALUES (%s, %s, %s, %s, NOW(), NOW())
        ON CONFLICT (bill_id) DO UPDATE SET
            debate_count = EXCLUDED.debate_count,
            status = EXCLUDED.status,
            error_message = EXCLUDED.error_message,
            updated_at = NOW()
        """
        cursor.execute(query, (bill_id, debate_count, status, error))

    conn.commit()
    cursor.close()


def prepare_batch_requests(
    conn,
    bills: List[Dict[str, Any]],
) -> tuple[List[Dict[str, Any]], List[int]]:
    """Prepare batch API requests for bills that fit single context.
    Returns (requests, skipped_bill_ids)."""
    requests = []
    skipped_ids = []

    for bill in bills:
        debates = get_debates_for_bill(conn, bill["id"])
        if not debates:
            continue

        formatted_speeches = [format_speech(d) for d in debates]
        total_chars = sum(len(s) for s in formatted_speeches)

        # Batch mode only supports single-context bills
        if total_chars > MAX_CONTEXT_CHARS:
            skipped_ids.append(bill["id"])
            continue

        debates_context = "\n".join(formatted_speeches)
        prompt = build_single_summary_prompt(bill["title"], debates_context)

        request_line = {
            "custom_id": f"debate-{bill['id']}",
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

    return requests, skipped_ids


def submit_batch(
    client: openai.OpenAI,
    requests: List[Dict[str, Any]],
) -> str:
    """Write JSONL, upload, and submit a batch job. Returns batch ID."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
        for req in requests:
            f.write(json.dumps(req, ensure_ascii=False) + "\n")
        jsonl_path = f.name

    print(f"Wrote {len(requests)} requests to {jsonl_path}")

    with open(jsonl_path, "rb") as f:
        file_obj = client.files.create(file=f, purpose="batch")
    print(f"Uploaded file: {file_obj.id}")

    batch = client.batches.create(
        input_file_id=file_obj.id,
        endpoint="/v1/chat/completions",
        completion_window="24h",
        metadata={"script": "summarize_debates", "model": LLM_MODEL},
    )
    print(f"Batch created: {batch.id}")
    print(f"Status: {batch.status}")

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

    content = client.files.content(batch.output_file_id)
    results_text = content.text

    success_count = 0
    error_count = 0

    for line in results_text.strip().split("\n"):
        if not line:
            continue
        result_obj = json.loads(line)
        custom_id = result_obj["custom_id"]
        bill_id = int(custom_id.replace("debate-", ""))

        response = result_obj.get("response")
        error = result_obj.get("error")

        if error:
            print(f"  Bill {bill_id}: Error - {error}")
            upsert_debate_summary(
                conn,
                bill_id,
                0,
                "failed",
                error=json.dumps(error, ensure_ascii=False),
            )
            error_count += 1
            continue

        if response and response.get("status_code") == 200:
            body = response["body"]
            content_str = body["choices"][0]["message"]["content"]
            result = json.loads(content_str)

            # Get debate count for this bill
            debates = get_debates_for_bill(conn, bill_id)
            debate_count = len(debates)

            upsert_debate_summary(
                conn,
                bill_id,
                debate_count,
                "completed",
                result,
            )
            success_count += 1
            pro_count = len(result.get("proArguments", []))
            con_count = len(result.get("conArguments", []))
            print(f"  Bill {bill_id}: ✓" f" {pro_count} pro, {con_count} con")
        else:
            status_code = response.get("status_code") if response else "N/A"
            upsert_debate_summary(
                conn,
                bill_id,
                0,
                "failed",
                error=f"HTTP {status_code}",
            )
            error_count += 1

    print(f"\nResults: {success_count} success, {error_count} errors")


def main():
    parser = argparse.ArgumentParser(description="Summarize debate records using LLM")
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Number of bills to process (default: all)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force regeneration",
    )
    parser.add_argument("--bill-id", type=int, help="Process specific bill")
    parser.add_argument(
        "--concurrency",
        type=int,
        default=3,
        help="Number of parallel workers (default: 3)",
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
    print("Summarizing Debate Records")
    print("=" * 60)
    print(f"Limit: {args.limit or 'all'}")
    print(f"Force: {args.force}")
    print(f"Mode: {'batch' if args.batch else 'synchronous'}")
    if not args.batch:
        print(f"Concurrency: {args.concurrency}")
    if args.bill_id:
        print(f"Bill ID: {args.bill_id}")
    print()

    bills = get_bills_with_debates(conn, args.limit, args.force, args.bill_id)
    print(f"Found {len(bills)} bills with debates to process\n")

    # Batch mode: prepare and submit
    if args.batch:
        print("Preparing batch requests...")
        requests, skipped = prepare_batch_requests(conn, bills)
        if skipped:
            print(
                f"Skipped {len(skipped)} bills requiring"
                " hierarchical summarization"
                " (too large for single context)"
            )
            print("Run these without --batch:" f" --bill-id for IDs: {skipped}")
        print(f"Prepared {len(requests)} requests")
        if not requests:
            print("No requests to submit.")
            conn.close()
            return
        batch_id = submit_batch(client, requests)
        print(f"\nBatch submitted! ID: {batch_id}")
        print(f"Check status:  pnpm summarize:debates" f" --batch-status {batch_id}")
        print(f"Get results:   pnpm summarize:debates" f" --batch-results {batch_id}")
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

        try:
            print(f"{prefix} {bill['title']}")
            print(f"{prefix}   Debate count: {bill['debate_count']}")

            # Mark as processing
            upsert_debate_summary(
                thread_conn, bill["id"], bill["debate_count"], "processing"
            )

            # Get all debates
            debates = get_debates_for_bill(thread_conn, bill["id"])
            print(f"{prefix}   Loaded {len(debates)} speeches")

            # Summarize using LLM
            result = summarize_debates(
                thread_client,
                bill["title"],
                debates,
                prefix,
            )

            # Save to database
            upsert_debate_summary(
                thread_conn,
                bill["id"],
                bill["debate_count"],
                "completed",
                result,
            )

            print(f"{prefix}   ✓ Summary completed")
            print(
                f"{prefix}     Pro:" f" {len(result.get('proArguments', []))}" " points"
            )
            print(
                f"{prefix}     Con:" f" {len(result.get('conArguments', []))}" " points"
            )

            with lock:
                results["success"] += 1

            return True

        except Exception as e:
            print(f"{prefix}   ✗ Error: {e}")
            upsert_debate_summary(
                thread_conn,
                bill["id"],
                bill["debate_count"],
                "failed",
                error=str(e),
            )
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

    print()
    print("=" * 60)
    print(f"Completed: {results['success']} success," f" {results['error']} errors")
    print("=" * 60)

    conn.close()


if __name__ == "__main__":
    main()
