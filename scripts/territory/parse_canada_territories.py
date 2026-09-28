"""
Step 5: Execute: Parse the CA territory tables on page 1 into rows containing rep, province, and zip.
Write a review file for anything that cannot be confidently interpreted.

Input: "YYYY-MM-DD-TERRITORY-CURRENT-CONDENSED_territory_lookup.csv"

Output: 
  "YYYY-MM-DD-TERRITORY-CURRENT-CONDENSED_ca_review.csv"
  "YYYY-MM-DD-TERRITORY-CURRENT-CONDENSED_ca_rows.csv",
    which is a dependency of "run_territory_pipeline.py" and "load_territory_lookup.py"
"""

import argparse
import csv
import re
from pathlib import Path

import pdfplumber

# Trial boundaries based on the PDF inspected from inspect_territory_pdf.py output
# These describe the horizontal positions on page 1.
TABLE = {
    "ca": {
        "rep": (375,460),
        "province": (461, 560),
        "zip": (565, 585),
        }    
}

FIRST_DATA_TOP = 500
ZIP_PATTERN = re.compile(r"[A-Z]")


def group_words_into_rows(words, tolerance=2):
    """Group words that appear at roughly the same page height."""
    rows = []

    for word in sorted(words, key=lambda item: (item["top"], item["x0"])):
        if not rows or abs(word["top"] - rows[-1][0]["top"]) > tolerance:
            rows.append([word])
        else:
            rows[-1].append(word)

    return rows


def text_in_column(row_words, left, right):
    """"Join words whose left edge falls within one column."""
    column_words = [
        word for word in row_words
        if left <= word["x0"] < right
    ]
    column_words.sort(key=lambda word: word["x0"])
    return " ".join(word["text"] for word in column_words).strip()


def read_ca_table(page, table_name, columns):
    """Return valid assignments and rows that need inspection."""
    left_edge = columns["rep"][0]
    right_edge = columns["zip"][1]
    page_words = page.extract_words(use_text_flow=False)

    canada_positions = [
        word["top"] for word in page_words
        if left_edge <= word["x0"] < right_edge
        and word["text"].strip().casefold() == "canada"
    ]
    if not canada_positions:
        raise ValueError("Could not find the Canada heading.")

    canada_top = min(canada_positions)

    zip_headers = [
        word for word in page_words
        if columns["zip"][0] <= word["x0"] < columns["zip"][1]
        and word["top"] > canada_top
        and word["text"].strip().casefold() == "zip"
    ]
    if not zip_headers:
        raise ValueError("Could not find the Canada Zip column header.")

    data_starts_after = min(word["bottom"] for word in zip_headers)

    table_words = [
        word for word in page_words
        if left_edge <= word["x0"] < right_edge
        and word["top"] > data_starts_after
    ]

    assignments = []
    issues = []

    for row_words in group_words_into_rows(table_words):
        rep = text_in_column(row_words, *columns["rep"])
        province = text_in_column(row_words, *columns["province"])
        zip_code = text_in_column(row_words, *columns["zip"])
        top = round(row_words[0]["top"], 2)

        row = {
            "source_page": page.page_number,
            "source_table": table_name,
            "source_top": top,
            "rep": rep,
            "province": province,
            "zip": zip_code,
        }

        if rep and province and ZIP_PATTERN.fullmatch(zip_code):
            assignments.append(row)
        else:
            issues.append(row)

    return assignments, issues


def write_csv(path, fieldnames, rows):
    with path.open("w", newline="", encoding="utf-8-sig") as output:
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(
        description="Inspect the CA territory table on page 1."
    )
    parser.add_argument("input_pdf", type=Path)
    args = parser.parse_args()

    input_pdf = args.input_pdf
    if not input_pdf.is_file():
        parser.error(f"File not found: {input_pdf}")

    with pdfplumber.open(input_pdf) as pdf:
        if not pdf.pages:
            parser.error("The PDF has no pages.")

        assignments, issues = read_ca_table(
            pdf.pages[0], "ca", TABLE["ca"]
        )

    fields = [
        "source_page", "source_table", "source_top",
        "rep", "province", "zip"
    ]
    assignments_path = input_pdf.with_name(f"{input_pdf.stem}_ca_rows.csv")
    issues_path = input_pdf.with_name(f"{input_pdf.stem}_ca_review.csv")

    write_csv(assignments_path, fields, assignments)
    write_csv(issues_path, fields, issues)

    print(f"Canada assignments: {len(assignments)} -> {assignments_path}")
    print(f"Rows to review: {len(issues)} -> {issues_path}")


if __name__ == "__main__":
    main()