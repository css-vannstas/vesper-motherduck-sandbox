"""
Parse the two US territory tables on page 1 into rows containing rep, state, and zip_range.
Write a review file for anything that cannot be confidently interpreted.
"""

import argparse
import csv
import re
from pathlib import Path

import pdfplumber

# Trial boundaries based on the PDF inspected from inspect_territory_pdf.py output
# These describe the horizontal positions on page 1.
TABLES = {
    "left_us": {
        "rep": (30, 100),
        "state": (100, 135),
        "zip": (135, 195),
        },
    "right_us": {
        "rep": (195, 265),
        "state": (265, 305),
        "zip": (305, 365),
        },
    }

FIRST_DATA_TOP = 115
STATE_PATTERN = re.compile(r"[A-Z]{2}")
ZIP_PATTERN = re.compile(r"[0-9]{3}(?:[-\u2013][0-9]{3})?")


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
    """Join words whose left edge falls within one column."""
    column_words = [
        word for word in row_words
        if left <= word["x0"] < right
    ]
    column_words.sort(key=lambda word: word["x0"])
    return " ".join(word["text"] for word in column_words).strip()


def read_us_table(page, table_name, columns):
    """Return valid assignments and rows that need inspection."""
    left_edge = columns["rep"][0]
    right_edge = columns["zip"][1]

    page_words = page.extract_words(use_text_flow=False)

    if table_name == "right_us":
        notes_positions = [
            word["top"]
            for word in page_words
            if word["top"] >= FIRST_DATA_TOP
            and word["text"].upper().startswith("NOTES")
        ]

        if not notes_positions:
            raise ValueError("Could not find the UPDATE NOTES heading on page 1.")

        stop_top = min(notes_positions)
    else:
        stop_top = float("inf")

    table_words = [
        word for word in page_words
        if left_edge <= word["x0"] < right_edge
        and FIRST_DATA_TOP <= word["top"] < stop_top
    ]

    assignments = []
    issues = []

    for row_words in group_words_into_rows(table_words):
        rep = text_in_column(row_words, *columns["rep"])
        state = text_in_column(row_words, *columns["state"])
        zip_range = text_in_column(row_words, *columns["zip"])
        top = round(row_words[0]["top"], 2)

        if rep and STATE_PATTERN.fullmatch(state) and ZIP_PATTERN.fullmatch(zip_range):
            assignments.append({
                "source_page": page.page_number,
                "source_table": table_name,
                "source_top": top,
                "rep": rep,
                "state": state,
                "zip_range": zip_range,
            })
        else:
            issues.append({
                "source_page": page.page_number,
                "source_table": table_name,
                "source_top": top,
                "rep": rep,
                "state": state,
                "zip_range": zip_range,
            })

    return assignments, issues


def write_csv(path, fieldnames, rows):
    with path.open("w", newline="", encoding="utf-8-sig") as output:
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

def expand_zip_range(zip_range):
    parts = zip_range.replace("\u2013", "-").split("-")
    start = int(parts[0])
    end = int(parts[-1])

    if start > end:
        raise ValueError(f"ZIP range runs backward: {zip_range}")

    return [f"{number:03d}" for number in range(start, end + 1)]

def main():
    parser = argparse.ArgumentParser(
        description="Inspect the US territory tables on page 1."    
    )
    parser.add_argument("input_pdf", type=Path)
    args = parser.parse_args()

    input_pdf = args.input_pdf
    if not input_pdf.is_file():
        parser.error(f"File not found: {input_pdf}")

    assignments = []
    issues = []

    with pdfplumber.open(input_pdf) as pdf:
        if not pdf.pages:
            parser.error("The PDF has no pages.")

        first_page = pdf.pages[0]

        for table_name, columns in TABLES.items():
            table_assignments, table_issues = read_us_table(
                first_page, table_name, columns
            )
            assignments.extend(table_assignments)
            issues.extend(table_issues)

    expanded_assignments = []

    for assignment in assignments:
        for zip3 in expand_zip_range(assignment["zip_range"]):
            expanded_row = assignment.copy()
            expanded_row["zip3"] = zip3
            expanded_assignments.append(expanded_row)
            
    fields = [
        "source_page", "source_table", "source_top",
        "rep", "state", "zip_range"
    ]

    assignments_path = input_pdf.with_name(f"{input_pdf.stem}_us_rows.csv")
    issues_path = input_pdf.with_name(f"{input_pdf.stem}_us_review.csv")

    write_csv(assignments_path, fields, assignments)
    write_csv(issues_path, fields, issues)
    zip3_path = input_pdf.with_name(f"{input_pdf.stem}_us_zip3.csv")
    write_csv(zip3_path, fields + ["zip3"], expanded_assignments)

    print(f"Expanded ZIP3 rows: {len(expanded_assignments)} _. {zip3_path}")
    print(f"US assignments: {len(assignments)} -> {assignments_path}")
    print(f"Rows to review: {len(issues)} -> {issues_path}")

if __name__ == "__main__":
    main()