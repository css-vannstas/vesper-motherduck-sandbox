"""
Parse the Mexico territory table on page 1 into rows containing rep, state, and ABBR.
Write a review file for anything that cannot be confidently interpreted.
"""

import argparse
import csv
import re
from pathlib import Path

import pdfplumber

# Trial boundaries based on the PDF inspected from inspect_territory_pdf.py output
# These describe the horizontal positions on page 1.
TABLE = {
    "mx": {
        "state": (375, 460),
        "abbr": (461, 560),
        }
    }

FIRST_DATA_TOP = 115
ABBR_PATTERN = re.compile(r"[A-Z]{2,5}")

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

def read_mx_table(page, table_name, columns):
    """Return valid assignments and rows that need inspection."""
    left_edge = columns["state"][0]
    right_edge = columns["abbr"][1]

    page_words = page.extract_words(use_text_flow=False)

    rep = None

    heading_words = [
        word for word in page_words
        if left_edge <= word["x0"] < right_edge
        and word["top"] < FIRST_DATA_TOP
    ]

    for heading_row in group_words_into_rows(heading_words):
        heading = text_in_column(heading_row, left_edge, right_edge)
        match = re.fullmatch(
            r"Mexico\s*[-\u2013\u2014]\s*(.+)",
            heading,
            flags=re.IGNORECASE,
            )
        if match:
            rep = match.group(1).strip()
            break

    if rep is None:
        raise ValueError("Could not read the rep from the Mexico table heading.")

    canada_positions = [
        word["top"]
        for word in page_words
        if left_edge <= word["x0"] < right_edge
        and word["top"] >= FIRST_DATA_TOP
        and word["text"].strip().casefold() == "canada"
    ]

    if not canada_positions:
        raise ValueError("Could not find the Canada table heading.")

    stop_top = min(canada_positions)

    table_words = [
        word for word in page_words
        if left_edge <= word["x0"] < right_edge
        and FIRST_DATA_TOP <= word["top"] < stop_top
    ]

    assignments = []
    issues = []

    for row_words in group_words_into_rows(table_words):
        state = text_in_column(row_words, *columns["state"])
        abbr = text_in_column(row_words, *columns["abbr"])
        top = round(row_words[0]["top"],2)

        row = {
            "source_page": page.page_number,
            "source_table": table_name,
            "source_top": top,
            "rep": rep,
            "state": state,
            "abbr": abbr,
        }

        if state and ABBR_PATTERN.fullmatch(abbr):
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
        description="Inspect the MX territory table on page 1."
    )
    parser.add_argument("input_pdf", type=Path)
    args = parser.parse_args()

    input_pdf = args.input_pdf
    if not input_pdf.is_file():
        parser.error(f"File not found: {input_pdf}")

    with pdfplumber.open(input_pdf) as pdf:
        if not pdf.pages:
            parser.error("The PDF has no pages.")

        assignments, issues = read_mx_table(
            pdf.pages[0], "mx", TABLE["mx"]
        )

    fields = [
        "source_page", "source_table", "source_top",
        "rep", "state", "abbr"
    ]
    assignments_path = input_pdf.with_name(f"{input_pdf.stem}_mx_rows.csv")
    issues_path = input_pdf.with_name(f"{input_pdf.stem}_mx_review.csv")

    write_csv(assignments_path, fields, assignments)
    write_csv(issues_path, fields, issues)

    print(f"Mexico assignments: {len(assignments)} -> {assignments_path}")
    print(f"Rows to review: {len(issues)} -> {issues_path}")


if __name__ == "__main__":
    main()