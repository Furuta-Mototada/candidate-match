#!/usr/bin/env python3
"""
Generate embeddings for bills by:
1. Fetching bill PDFs from sangiin.go.jp
2. Extracting text content
3. Generating embeddings using sentence-transformers
4. Storing in database
"""

import os
import json
import re
import sys
from typing import List, Dict, Optional
import requests
from io import BytesIO
import psycopg2
from psycopg2.extras import execute_values
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

try:
    import PyPDF2
except ImportError:
    print("PyPDF2 not installed. Run: pip install PyPDF2")
    sys.exit(1)

try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    print("sentence-transformers not installed. Run: pip install sentence-transformers")
    sys.exit(1)


class BillEmbeddingGenerator:
    def __init__(
        self,
        database_url: str,
        model_name: str = "paraphrase-multilingual-mpnet-base-v2",
    ):
        """
        Initialize the generator with database connection and embedding model.

        Args:
            database_url: PostgreSQL connection string
            model_name: Sentence-transformers model name (default: multilingual model for Japanese)
        """
        self.conn = psycopg2.connect(database_url)
        self.model_name = model_name
        print(f"Loading embedding model: {model_name}...")
        self.model = SentenceTransformer(model_name)
        print(
            f"Model loaded successfully. Embedding dimension: {self.model.get_sentence_embedding_dimension()}"
        )

    def get_bills_without_embeddings(self, limit: Optional[int] = None) -> List[Dict]:
        """Fetch bills that don't have embeddings yet."""
        cursor = self.conn.cursor()

        query = """
        SELECT 
            b.id,
            b.type,
            b.submission_session,
            b.number,
            bd.title,
            bd.description
        FROM bill b
        LEFT JOIN bill_detail bd ON b.id = bd.bill_id
        LEFT JOIN bill_embeddings be ON b.id = be.bill_id
        WHERE be.bill_id IS NULL
            AND bd.title IS NOT NULL
        ORDER BY b.submission_session DESC, b.number
        """

        if limit:
            query += f" LIMIT {limit}"

        cursor.execute(query)
        columns = [desc[0] for desc in cursor.description]
        bills = [dict(zip(columns, row)) for row in cursor.fetchall()]
        cursor.close()

        return bills

    def scrape_pdf_url(
        self, bill_type: str, session: int, number: int
    ) -> Optional[str]:
        """
        Scrape the actual PDF URL from the sangiin.go.jp gian page.
        This is more reliable than trying to construct the URL pattern.
        """
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            print(
                "  Warning: BeautifulSoup not installed. Install with: pip install beautifulsoup4"
            )
            return None

        # Fetch the main gian page for this session
        gian_url = (
            f"https://www.sangiin.go.jp/japanese/joho1/kousei/gian/{session}/gian.htm"
        )

        try:
            response = requests.get(gian_url, timeout=30)
            response.raise_for_status()

            soup = BeautifulSoup(response.content, "html.parser")

            # Find the section for this bill type
            type_headers = {
                "閣法": "法律案（内閣提出）",
                "衆法": "法律案（衆法）",
                "参法": "法律案（参法）",
            }

            if bill_type not in type_headers:
                return None

            # Find the h2 header for this bill type
            h2 = soup.find(
                "h2", string=lambda text: text and type_headers[bill_type] in text
            )
            if not h2:
                return None

            # Find the table after the h2
            table = h2.find_next("table")
            if not table:
                return None

            # Find the row with our bill number
            for row in table.find_all("tr"):
                cells = row.find_all("td")
                if len(cells) >= 3:
                    # First cell should contain the bill number
                    try:
                        row_number = int(cells[1].get_text(strip=True))
                        if row_number == number:
                            # Look for the PDF link in this row (提出法律案)
                            for cell in cells:
                                link = cell.find("a", href=lambda h: h and "pdf/t" in h)
                                if link:
                                    pdf_path = link.get("href")
                                    # Resolve relative URL
                                    if pdf_path.startswith("./"):
                                        pdf_path = pdf_path[2:]
                                    full_url = f"https://www.sangiin.go.jp/japanese/joho1/kousei/gian/{session}/{pdf_path}"
                                    return full_url
                    except (ValueError, AttributeError):
                        continue

            return None

        except requests.exceptions.RequestException as e:
            print(f"  Error fetching gian page: {e}")
            return None

    def extract_pdf_text(self, pdf_url: str) -> Optional[str]:
        """Download PDF and extract text content."""
        try:
            response = requests.get(pdf_url, timeout=30)
            response.raise_for_status()

            pdf_file = BytesIO(response.content)
            pdf_reader = PyPDF2.PdfReader(pdf_file)

            text_content = []
            for page in pdf_reader.pages:
                text = page.extract_text()
                if text:
                    text_content.append(text)

            full_text = "\n".join(text_content)

            # Clean up text
            full_text = re.sub(r"\s+", " ", full_text)  # Normalize whitespace
            full_text = full_text.strip()

            return full_text if full_text else None

        except requests.exceptions.RequestException as e:
            print(f"  Error downloading PDF from {pdf_url}: {e}")
            return None
        except Exception as e:
            print(f"  Error extracting text from PDF: {e}")
            return None

    def create_bill_document(self, bill: Dict, pdf_text: Optional[str]) -> str:
        """
        Create a document string for embedding from bill information.
        Combines: title, description, and PDF text content.
        """
        parts = []

        # Add bill type and number as context
        parts.append(f"法案種別: {bill['type']}")
        parts.append(f"提出回次: {bill['submission_session']} 番号: {bill['number']}")

        # Add title
        if bill.get("title"):
            parts.append(f"件名: {bill['title']}")

        # Add description
        if bill.get("description"):
            parts.append(f"説明: {bill['description']}")

        # Add PDF text content
        if pdf_text:
            parts.append(
                f"本文: {pdf_text[:5000]}"
            )  # Limit to first 5000 chars to avoid too long texts

        document = "\n\n".join(parts)
        return document

    def generate_and_store_embedding(self, bill: Dict) -> bool:
        """Generate embedding for a bill and store in database."""
        bill_id = bill["id"]
        bill_type = bill["type"]
        session = bill["submission_session"]
        number = bill["number"]

        print(f"\nProcessing bill {bill_id}: {bill_type}-{session}-{number}")
        print(f"  Title: {bill.get('title', 'N/A')[:80]}...")

        # Scrape PDF URL from the website
        pdf_url = self.scrape_pdf_url(bill_type, session, number)

        if pdf_url:
            print(f"  PDF URL: {pdf_url}")
        else:
            print(f"  Warning: Could not find PDF URL for this bill")

        # Extract PDF text if URL was found
        pdf_text = None
        if pdf_url:
            pdf_text = self.extract_pdf_text(pdf_url)
            if pdf_text:
                print(f"  Extracted {len(pdf_text)} characters from PDF")
            else:
                print(f"  Warning: Could not extract text from PDF")

        if not pdf_text:
            print(f"  Using title and description only")

        # Create document for embedding
        document = self.create_bill_document(bill, pdf_text)
        print(f"  Document length: {len(document)} characters")

        # Generate embedding
        print(f"  Generating embedding...")
        embedding = self.model.encode(document)
        embedding_json = json.dumps(embedding.tolist())

        # Store in database
        cursor = self.conn.cursor()
        try:
            cursor.execute(
                """
                INSERT INTO bill_embeddings (bill_id, pdf_url, text_content, embedding, embedding_model, created_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (bill_id) DO UPDATE
                SET pdf_url = EXCLUDED.pdf_url,
                    text_content = EXCLUDED.text_content,
                    embedding = EXCLUDED.embedding,
                    embedding_model = EXCLUDED.embedding_model,
                    created_at = EXCLUDED.created_at
            """,
                (
                    bill_id,
                    pdf_url,
                    pdf_text,
                    embedding_json,
                    self.model_name,
                    datetime.now(),
                ),
            )

            self.conn.commit()
            print(f"  ✓ Embedding stored successfully")
            return True

        except Exception as e:
            self.conn.rollback()
            print(f"  Error storing embedding: {e}")
            return False
        finally:
            cursor.close()

    def process_all_bills(self, limit: Optional[int] = None):
        """Process all bills without embeddings."""
        bills = self.get_bills_without_embeddings(limit)

        if not bills:
            print("No bills found that need embeddings.")
            return

        print(f"\nFound {len(bills)} bills without embeddings")

        success_count = 0
        for i, bill in enumerate(bills, 1):
            print(f"\n[{i}/{len(bills)}]", end=" ")
            if self.generate_and_store_embedding(bill):
                success_count += 1

        print(f"\n\n=== Summary ===")
        print(f"Total bills processed: {len(bills)}")
        print(f"Successfully generated embeddings: {success_count}")
        print(f"Failed: {len(bills) - success_count}")

    def close(self):
        """Close database connection."""
        if self.conn:
            self.conn.close()


def main():
    # Get database URL from environment
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("Error: DATABASE_URL environment variable not set")
        sys.exit(1)

    # Parse command line arguments
    limit = None
    if len(sys.argv) > 1:
        try:
            limit = int(sys.argv[1])
            print(f"Processing limit: {limit} bills")
        except ValueError:
            print(f"Invalid limit value: {sys.argv[1]}")
            sys.exit(1)

    # Initialize generator
    generator = BillEmbeddingGenerator(database_url)

    try:
        generator.process_all_bills(limit)
    finally:
        generator.close()


if __name__ == "__main__":
    main()
