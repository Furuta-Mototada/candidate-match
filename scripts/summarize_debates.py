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
"""

import os
import sys
import json
import argparse
import time
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

DELAY_BETWEEN_REQUESTS = 1


def get_bills_with_debates(
    conn, limit: int, force: bool, bill_id: Optional[int]
) -> List[Dict[str, Any]]:
    """Get bills that have debates and need summarization."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    if bill_id:
        query = """
        SELECT b.id, bd.title, COUNT(db.id) as debate_count
        FROM bill b
        INNER JOIN bill_detail bd ON b.id = bd.bill_id
        INNER JOIN bill_debates db ON b.id = db.bill_id
        WHERE b.id = %s
        GROUP BY b.id, bd.title
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
        query = f"""
        SELECT b.id, bd.title, COUNT(db.id) as debate_count
        FROM bill b
        INNER JOIN bill_detail bd ON b.id = bd.bill_id
        INNER JOIN bill_debates db ON b.id = db.bill_id
        WHERE {where_clause}
        GROUP BY b.id, bd.title
        HAVING COUNT(db.id) > 0
        ORDER BY COUNT(db.id) DESC
        LIMIT %s
        """
        cursor.execute(query, (limit,))

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


def summarize_debates(
    client: openai.OpenAI, bill_title: str, debates: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """Use LLM to summarize debate records."""

    # Build debate context (truncate to avoid token limits)
    # Japanese text: ~1 token per character
    # gpt-4.1 has higher rate limits, but we still cap for cost efficiency
    debate_texts = []
    total_chars = 0
    max_chars = 30000  # Limit context size

    for debate in debates:
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

        # Truncate long speeches more aggressively
        if len(content) > 1000:
            content = content[:1000] + "..."

        text = f"【{house}・{speaker_label}】\n{content}\n"

        if total_chars + len(text) > max_chars:
            break

        debate_texts.append(text)
        total_chars += len(text)

    debates_context = "\n".join(debate_texts)

    prompt = f"""あなたは国会議事録の分析専門家です。以下の法案に関する国会での議論を分析し、構造化された要約を作成してください。

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

    response = client.chat.completions.create(
        model="gpt-5.1",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        response_format={"type": "json_object"},
    )

    result = json.loads(response.choices[0].message.content)
    return result


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
                    result.get("governmentExplanations", []), ensure_ascii=False
                ),
                debate_count,
                status,
                "gpt-5.1",
                error,
            ),
        )
    else:
        query = """
        INSERT INTO bill_debate_summary (bill_id, debate_count, status, error_message, created_at, updated_at)
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


def main():
    parser = argparse.ArgumentParser(description="Summarize debate records using LLM")
    parser.add_argument(
        "--limit", type=int, default=10, help="Number of bills to process"
    )
    parser.add_argument("--force", action="store_true", help="Force regeneration")
    parser.add_argument("--bill-id", type=int, help="Process specific bill")
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("Error: DATABASE_URL environment variable is required")
        sys.exit(1)

    openai_api_key = os.getenv("OPENAI_API_KEY")
    if not openai_api_key:
        print("Error: OPENAI_API_KEY environment variable is required")
        sys.exit(1)

    conn = psycopg2.connect(database_url)
    client = openai.OpenAI(api_key=openai_api_key)

    print("=" * 60)
    print("Summarizing Debate Records")
    print("=" * 60)
    print(f"Limit: {args.limit}")
    print(f"Force: {args.force}")
    if args.bill_id:
        print(f"Bill ID: {args.bill_id}")
    print()

    bills = get_bills_with_debates(conn, args.limit, args.force, args.bill_id)
    print(f"Found {len(bills)} bills with debates to process\n")

    success_count = 0
    error_count = 0

    for i, bill in enumerate(bills):
        print(f"[{i+1}/{len(bills)}] {bill['title']}")
        print(f"  Debate count: {bill['debate_count']}")

        try:
            # Mark as processing
            upsert_debate_summary(conn, bill["id"], bill["debate_count"], "processing")

            # Get all debates
            debates = get_debates_for_bill(conn, bill["id"])
            print(f"  Loaded {len(debates)} speeches")

            # Summarize using LLM
            result = summarize_debates(client, bill["title"], debates)

            # Save to database
            upsert_debate_summary(
                conn, bill["id"], bill["debate_count"], "completed", result
            )

            print("  ✓ Summary completed")
            print(f"    Pro: {len(result.get('proArguments', []))} points")
            print(f"    Con: {len(result.get('conArguments', []))} points")
            success_count += 1

            time.sleep(DELAY_BETWEEN_REQUESTS)

        except Exception as e:
            print(f"  ✗ Error: {e}")
            upsert_debate_summary(
                conn, bill["id"], bill["debate_count"], "failed", error=str(e)
            )
            error_count += 1

    print()
    print("=" * 60)
    print(f"Completed: {success_count} success, {error_count} errors")
    print("=" * 60)

    conn.close()


if __name__ == "__main__":
    main()
