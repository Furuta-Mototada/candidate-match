#!/usr/bin/env python3
"""
Enrich bills with LLM-generated educational content

Uses OpenAI API to generate:
- Short summary (one-liner)
- Detailed plain-language summary
- Key points (who, what, when)
- Impact tags
- Pros and cons (from debates if available)
- Example scenario
"""

import os
import sys
import json
import hashlib
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

DELAY_BETWEEN_REQUESTS = 1  # 1 second between API calls


def hash_text(text: str) -> str:
    """Generate MD5 hash of text for change detection."""
    return hashlib.md5(text.encode()).hexdigest()


def generate_enrichment(
    client: openai.OpenAI,
    bill_title: str,
    bill_description: Optional[str],
    pdf_text: Optional[str],
    debate_summary: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Generate enrichment content using OpenAI API."""

    # Build context from available sources
    context = f"法案名: {bill_title}\n\n"

    if bill_description:
        context += f"概要: {bill_description}\n\n"

    if pdf_text:
        # Truncate PDF text to avoid token limits
        truncated_pdf = pdf_text[:8000]
        context += f"法案本文 (抜粋):\n{truncated_pdf}\n\n"

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

    prompt = f"""あなたは日本の法律を一般市民にわかりやすく説明する専門家です。以下の法案情報を分析し、指定されたJSON形式で情報を生成してください。

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

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        response_format={"type": "json_object"},
    )

    result = json.loads(response.choices[0].message.content)

    # Validate required fields
    if not result.get("summaryShort") or not result.get("summaryDetailed"):
        raise ValueError("Missing required fields in response")

    return result


def get_bills_to_enrich(
    conn, limit: int, force_regenerate: bool, bill_id: Optional[int] = None
) -> List[Dict[str, Any]]:
    """Get bills that need enrichment."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    # If specific bill_id is provided, fetch only that bill
    if bill_id:
        query = """
        SELECT
            b.id,
            bd.title,
            bd.description,
            bem.text_content as pdf_text,
            be.status,
            (SELECT COUNT(*) FROM bill_debates db WHERE db.bill_id = b.id) as debate_count
        FROM bill b
        INNER JOIN bill_detail bd ON b.id = bd.bill_id
        LEFT JOIN bill_embeddings bem ON b.id = bem.bill_id
        LEFT JOIN bill_enrichment be ON b.id = be.bill_id
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

    query = f"""
    SELECT
        b.id,
        bd.title,
        bd.description,
        bem.text_content as pdf_text,
        be.status,
        (SELECT COUNT(*) FROM bill_debates db WHERE db.bill_id = b.id) as debate_count
    FROM bill b
    INNER JOIN bill_detail bd ON b.id = bd.bill_id
    LEFT JOIN bill_embeddings bem ON b.id = bem.bill_id
    LEFT JOIN bill_enrichment be ON b.id = be.bill_id
    WHERE {where_clause}
    ORDER BY
        (SELECT COUNT(*) FROM bill_debates db WHERE db.bill_id = b.id) DESC,
        bem.text_content IS NOT NULL DESC,
        b.submission_session DESC
    LIMIT %s
    """

    cursor.execute(query, (limit,))
    bills = cursor.fetchall()
    cursor.close()

    return bills


def get_debate_summary_for_bill(conn, bill_id: int) -> Optional[Dict[str, Any]]:
    """Get debate summary for a specific bill from bill_debate_summary table."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    query = """
    SELECT
        pro_arguments_summary,
        con_arguments_summary,
        key_questions,
        government_explanations,
        debate_count
    FROM bill_debate_summary
    WHERE bill_id = %s AND status = 'completed'
    """

    cursor.execute(query, (bill_id,))
    result = cursor.fetchone()
    cursor.close()

    if not result:
        return None

    # Parse JSON fields
    try:
        return {
            "pro_arguments": json.loads(result["pro_arguments_summary"] or "[]"),
            "con_arguments": json.loads(result["con_arguments_summary"] or "[]"),
            "key_questions": json.loads(result["key_questions"] or "[]"),
            "gov_explanations": json.loads(result["government_explanations"] or "[]"),
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
            bill_id, summary_short, summary_detailed, key_points,
            impact_tags, pros_and_cons, example_scenario,
            status, llm_model, source_text_hash, error_message,
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
                json.dumps(result.get("keyPoints", []), ensure_ascii=False),
                json.dumps(result.get("impactTags", []), ensure_ascii=False),
                json.dumps(result.get("prosAndCons", {}), ensure_ascii=False),
                result.get("exampleScenario"),
                status,
                "gpt-4o",
                result.get("sourceHash"),
                error,
            ),
        )
    else:
        query = """
        INSERT INTO bill_enrichment (bill_id, status, error_message, created_at, updated_at)
        VALUES (%s, %s, %s, NOW(), NOW())
        ON CONFLICT (bill_id) DO UPDATE SET
            status = EXCLUDED.status,
            error_message = EXCLUDED.error_message,
            updated_at = NOW()
        """
        cursor.execute(query, (bill_id, status, error))

    conn.commit()
    cursor.close()


def main():
    import argparse
    import time

    parser = argparse.ArgumentParser(
        description="Enrich bills with LLM-generated content"
    )
    parser.add_argument(
        "--limit", type=int, default=10, help="Number of bills to process"
    )
    parser.add_argument("--bill-id", type=int, help="Process a specific bill by ID")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force regeneration of existing enrichments",
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

    # Initialize connections
    conn = psycopg2.connect(database_url)
    client = openai.OpenAI(api_key=openai_api_key)

    print("=" * 60)
    print("Enriching Bills with LLM-generated Content")
    print("=" * 60)
    if args.bill_id:
        print(f"Bill ID: {args.bill_id}")
    else:
        print(f"Limit: {args.limit} bills")
    print(f"Force regenerate: {args.force}")
    print("")

    # Get bills to process
    bills = get_bills_to_enrich(conn, args.limit, args.force, bill_id=args.bill_id)
    print(f"Found {len(bills)} bills to process")
    print("")

    success_count = 0
    error_count = 0

    for i, bill in enumerate(bills):
        print(f"[{i + 1}/{len(bills)}] Processing: {bill['title']}")

        if not bill["title"]:
            print("  Skipping: No title available")
            continue

        try:
            # Mark as processing
            upsert_enrichment(conn, bill["id"], "processing")

            # Get debate summary for this bill (from bill_debate_summary table)
            debate_summary = get_debate_summary_for_bill(conn, bill["id"])
            if debate_summary:
                print(
                    f"  Found debate summary with {len(debate_summary.get('pro_arguments', []))} pro, {len(debate_summary.get('con_arguments', []))} con arguments"
                )
            else:
                print("  No debate summary available")

            # Generate enrichment content
            result = generate_enrichment(
                client,
                bill["title"],
                bill.get("description"),
                bill.get("pdf_text"),
                debate_summary,
            )

            # Build source text hash for change detection
            source_text = f"{bill['title']}|{bill.get('description', '')}|{(bill.get('pdf_text') or '')[:1000]}"
            result["sourceHash"] = hash_text(source_text)

            # Save to database
            upsert_enrichment(conn, bill["id"], "completed", result)

            print("  ✓ Enrichment completed")
            print(f"    Short: {result['summaryShort'][:50]}...")
            success_count += 1

            time.sleep(DELAY_BETWEEN_REQUESTS)

        except Exception as e:
            print(f"  ✗ Error: {e}")
            upsert_enrichment(conn, bill["id"], "failed", error=str(e))
            error_count += 1

    print("")
    print("=" * 60)
    print(f"Completed: {success_count} success, {error_count} errors")
    print("=" * 60)

    conn.close()


if __name__ == "__main__":
    main()
