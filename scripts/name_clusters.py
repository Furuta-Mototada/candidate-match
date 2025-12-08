#!/usr/bin/env python3
"""
Generate names for bill clusters using an LLM.
Uses the titles of bills in each cluster to generate a descriptive name.
"""

import os
import sys
import json
import psycopg2
from datetime import datetime
from typing import Dict, List, Tuple
from dotenv import load_dotenv

load_dotenv()

try:
    import openai
except ImportError:
    print("openai package not installed. Run: pip install openai")
    sys.exit(1)


def get_cluster_bills(conn, cluster_id: int) -> Dict[int, List[str]]:
    """Get all bills grouped by cluster label."""
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT 
            bca.cluster_label,
            bd.title
        FROM bill_cluster_assignments bca
        JOIN bill_detail bd ON bca.bill_id = bd.bill_id
        WHERE bca.cluster_id = %s
        ORDER BY bca.cluster_label, bca.distance
    """,
        (cluster_id,),
    )

    clusters: Dict[int, List[str]] = {}
    for label, title in cursor.fetchall():
        if label not in clusters:
            clusters[label] = []
        if title:
            clusters[label].append(title)

    cursor.close()
    return clusters


def get_existing_names(conn, cluster_id: int) -> set:
    """Get cluster labels that already have names."""
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT cluster_label FROM bill_cluster_label_names
        WHERE cluster_id = %s
    """,
        (cluster_id,),
    )
    existing = {row[0] for row in cursor.fetchall()}
    cursor.close()
    return existing


def generate_cluster_name(client: openai.OpenAI, titles: List[str]) -> Tuple[str, str]:
    """Use LLM to generate a name for a cluster based on bill titles."""

    # Send all titles
    titles_text = "\n".join(f"- {t}" for t in titles)

    prompt = f"""あなたは日本の国会法案を分析する専門家です。

以下は、機械学習によってグループ化された法案のリストです。これらの法案に共通する具体的なテーマを特定し、このグループに適切な名前を付けてください。

## 重要な指示:
1. 名前は具体的で識別しやすいものにしてください。「法改正関連」のような汎用的な名前は避けてください。
2. 法案の内容から、最も顕著な政策分野や目的を抽出してください。
3. 例: 「地方財政・交付税」「労働者保護・雇用」「防衛・安保法制」「子育て・教育支援」「環境・エネルギー」など

## 法案タイトル一覧 ({len(titles)}件):
{titles_text}

## 回答形式 (JSON):
{{
    "name": "具体的で識別しやすいクラスター名（8文字以内）",
    "description": "共通テーマの説明文。「このクラスター」や「これらの法案」で始めず、内容を直接説明してください。例: 「地方自治体の財政基盤強化と交付税制度の改正に関する法案群。○○や△△などの施策を含む。」"
}}"""

    response = client.chat.completions.create(
        model="gpt-5.1",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        response_format={"type": "json_object"},
    )

    result = json.loads(response.choices[0].message.content)
    return result["name"], result.get("description", "")


def save_cluster_name(conn, cluster_id: int, label: int, name: str, description: str):
    """Save the generated cluster name to the database."""
    cursor = conn.cursor()

    cursor.execute(
        """
        INSERT INTO bill_cluster_label_names 
            (cluster_id, cluster_label, name, description, generated_at)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (cluster_id, cluster_label) 
        DO UPDATE SET name = EXCLUDED.name,
                      description = EXCLUDED.description, 
                      generated_at = EXCLUDED.generated_at
    """,
        (cluster_id, label, name, description, datetime.now()),
    )

    conn.commit()
    cursor.close()


def main():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("Error: DATABASE_URL environment variable not set")
        sys.exit(1)

    openai_api_key = os.getenv("OPENAI_API_KEY")
    if not openai_api_key:
        print("Error: OPENAI_API_KEY environment variable not set")
        sys.exit(1)

    # Parse command line arguments
    if len(sys.argv) < 2:
        print("Usage: python name_clusters.py <cluster_id> [--force]")
        print("  --force: Regenerate names even if they already exist")
        sys.exit(1)

    cluster_id = int(sys.argv[1])
    force = "--force" in sys.argv

    print(f"Generating names for cluster ID: {cluster_id}")
    if force:
        print("Force mode: will regenerate all names")

    # Connect to database
    conn = psycopg2.connect(database_url)

    # Get bills grouped by cluster label
    clusters = get_cluster_bills(conn, cluster_id)

    if not clusters:
        print(f"No bills found for cluster ID {cluster_id}")
        conn.close()
        sys.exit(1)

    print(
        f"Found {len(clusters)} cluster labels with {sum(len(b) for b in clusters.values())} total bills"
    )

    # Get existing names (unless force mode)
    existing = set() if force else get_existing_names(conn, cluster_id)
    if existing:
        print(
            f"Skipping {len(existing)} clusters that already have names (use --force to regenerate)"
        )

    # Initialize OpenAI client
    client = openai.OpenAI(api_key=openai_api_key)

    # Generate names for each cluster
    for label in sorted(clusters.keys()):
        if label in existing:
            continue

        titles = clusters[label]
        print(f"\nCluster {label}: {len(titles)} bills")

        try:
            name, description = generate_cluster_name(client, titles)
            print(f"  Name: {name}")
            print(f"  Description: {description}")

            save_cluster_name(conn, cluster_id, label, name, description)
            print(f"  ✓ Saved to database")

        except Exception as e:
            print(f"  ✗ Error generating name: {e}")

    conn.close()
    print("\n✓ Done!")


if __name__ == "__main__":
    main()
