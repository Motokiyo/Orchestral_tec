#!/usr/bin/env python3
"""
Scrape R&S product reference numbers for timbales.
Reads sitemap TSV, filters timbales (classiques, accessoires, housses-de-timbales),
fetches each product page, extracts reference from itemprop="sku".
"""

import requests
from bs4 import BeautifulSoup
import csv
import time
import sys

# Config
SITEMAP_PATH = "/sessions/blissful-youthful-pascal/mnt/Orchestral-tec/docs/RS_SITEMAP_COMPLET.tsv"
OUTPUT_PATH = "/sessions/blissful-youthful-pascal/mnt/Orchestral-tec/docs/RS_REFS_TIMBALES.tsv"
BASE_URL = "https://www.r-sons.com/fr/instruments-de-percussion/timbales"
DELAY = 0.5  # seconds between requests
PROGRESS_INTERVAL = 20
TIMEOUT = 10

# Headers to avoid being blocked
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
}

# Target categories (skip peaux-de-rechange)
TARGET_CAT3 = {"classiques", "accessoires", "housses-de-timbales"}


def read_sitemap():
    """Read TSV and filter timbales products."""
    products = []
    try:
        with open(SITEMAP_PATH, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter="\t")
            for row in reader:
                if row.get("cat2") == "timbales" and row.get("cat3") in TARGET_CAT3:
                    products.append({
                        "id": row["id"],
                        "cat3": row["cat3"],
                        "slug": row["slug"]
                    })
    except Exception as e:
        print(f"Error reading sitemap: {e}", file=sys.stderr)
        return []

    return products


def extract_reference(html):
    """Extract product reference from itemprop='sku'."""
    soup = BeautifulSoup(html, "html.parser")

    # Primary selector: itemprop="sku"
    elem = soup.find(attrs={"itemprop": "sku"})
    if elem:
        ref = elem.get_text(strip=True)
        if ref:
            return ref

    # Fallback: try other selectors
    selectors = [
        ("span", {"class": "product-reference"}),
        ("span", {"class": "reference"}),
        ("span", {"class": "sku"}),
        ("div", {"class": "product-reference"}),
        ("div", {"class": "sku"}),
    ]

    for tag_name, attrs in selectors:
        elem = soup.find(tag_name, attrs)
        if elem:
            ref = elem.get_text(strip=True)
            if ref:
                return ref

    return None


def scrape_product(product_id, cat3, slug):
    """Fetch product page and extract reference."""
    url = f"{BASE_URL}/{cat3}/{slug}-id{product_id}"

    try:
        response = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        response.raise_for_status()
        ref = extract_reference(response.text)
        return ref, None, url
    except requests.exceptions.Timeout:
        return None, "Timeout", url
    except requests.exceptions.ConnectionError as e:
        return None, f"Connection error: {str(e)[:50]}", url
    except requests.RequestException as e:
        return None, f"HTTP {getattr(e.response, 'status_code', '?')}", url
    except Exception as e:
        return None, str(e)[:50], url


def main():
    print("Reading sitemap...", file=sys.stderr)
    products = read_sitemap()

    if not products:
        print("No timbales products found in target categories.", file=sys.stderr)
        return

    print(f"Found {len(products)} timbales products to scrape.", file=sys.stderr)
    print(f"Target categories: {', '.join(TARGET_CAT3)}", file=sys.stderr)
    print(f"Starting scrape (delay={DELAY}s per request)...\n", file=sys.stderr)

    results = []
    errors = []

    # Scrape each product
    for idx, product in enumerate(products, 1):
        product_id = product["id"]
        cat3 = product["cat3"]
        slug = product["slug"]

        ref, error, url = scrape_product(product_id, cat3, slug)

        if ref:
            results.append({
                "id": product_id,
                "ref": ref,
                "cat3": cat3,
                "slug": slug
            })
        else:
            errors.append({
                "id": product_id,
                "cat3": cat3,
                "slug": slug,
                "error": error,
                "url": url
            })

        # Progress reporting
        if idx % PROGRESS_INTERVAL == 0:
            success_count = len(results)
            error_count = len(errors)
            print(f"Progress: {idx}/{len(products)} | "
                  f"✓ {success_count} refs | "
                  f"✗ {error_count} errors", file=sys.stderr)

        # Rate limiting
        if idx < len(products):
            time.sleep(DELAY)

    # Write results
    try:
        with open(OUTPUT_PATH, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["id", "ref", "cat3", "slug"], delimiter="\t")
            writer.writeheader()
            writer.writerows(results)
        print(f"\n✓ Wrote {len(results)} products to {OUTPUT_PATH}", file=sys.stderr)
    except Exception as e:
        print(f"Error writing output: {e}", file=sys.stderr)
        return

    # Summary
    print(f"\n=== FINAL SUMMARY ===", file=sys.stderr)
    print(f"Total products: {len(products)}", file=sys.stderr)
    print(f"Successfully scraped: {len(results)}", file=sys.stderr)
    print(f"Errors: {len(errors)}", file=sys.stderr)

    if errors:
        print(f"\nFirst 10 errors:", file=sys.stderr)
        for err in errors[:10]:
            print(f"  - ID {err['id']} ({err['cat3']}): {err['error']}", file=sys.stderr)


if __name__ == "__main__":
    main()
