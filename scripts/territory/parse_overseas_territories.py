"""
Parse the Overseas territory tables on page 2 into rows containing rep, region, and country.
Write a review file for anything that cannot be confidently interpreted.
"""

import argparse
import csv
import re
from pathlib import Path

import pdfplumber

# Horizontal text lanes on page 2; check against the inspected word positions.
LANES = {
    "left": (30,155),
    "middle-left": (155, 315),
    "middle-right": (315, 455),
    "right": (455, 600),
    }


def group_words_into_rows(words, tolerance=2):
    """Group words that appear at roughly the same page height."""
    rows = []

    for word in sorted(words, key=lambda item: (item["top"], item["x0"])):
        if not rows or abs(word["top"] - rows[-1][0]["top"]) > tolerance:
            rows.append([word])
        else:
            rows[-1].append(word)

    return rows


def rows_in_lane(page, left, right):
    """Return page 2 words grouped into rows within one text lane."""
    lane_words = [
        word for word in page.extract_words(use_text_flow=False)
        if left <= word["x0"] < right
        and word["top"] >= 65
    ]
    return group_words_into_rows(lane_words)


def heading_parts(row_words):
    """Return (region, rep) for a heading, or None for a country row."""
    text = " ".join(word["text"] for word in row_words)
    match = re.fullmatch(r"(.+?)\s+[-\u2013\u2014]\s+(.+)", text)

    if match:
        return match.group(1).strip(), match.group(2).strip()

    return None


def read_lane(page, lane_name, boundaries):
    assignments = []
    issues = []
    region = None
    rep = None

    for row_words in rows_in_lane(page, *boundaries):
        parts = heading_parts(row_words)

        if parts:
            region, rep = parts
            continue

        row = {
            "source_page": page.page_number,
            "source_lane": lane_name,
            "source_top": round(row_words[0]["top"], 2),
            "rep": rep,
            "region": region,
            "country": " ".join(word["text"] for word in row_words),
        }

        if region and rep and row["country"]:
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
    parser = argparse.ArgumentParser()
    parser.add_argument("input_pdf", type=Path)
    args = parser.parse_args()

    with pdfplumber.open(args.input_pdf) as pdf:
        if len(pdf.pages) < 2:
            parser.error("The PDF has no page 2.")

        assignments = []
        issues = []

        for lane_name, boundaries in LANES.items():
            lane_assignments, lane_issues = read_lane(
                pdf.pages[1], lane_name, boundaries    
            )
            assignments.extend(lane_assignments)
            issues.extend(lane_issues)

        fields = [
            "source_page", "source_lane", "source_top",
            "rep", "region", "country"
        ]
        assignments_path = args.input_pdf.with_name(
            f"{args.input_pdf.stem}_overseas_rows.csv"
        )
        issues_path = args.input_pdf.with_name(
            f"{args.input_pdf.stem}_overseas_review.csv"    
        )

        write_csv(assignments_path, fields, assignments)
        write_csv(issues_path, fields, issues)

        print(f"Overseas countries: {len(assignments)} -> {assignments_path}")
        print(f"Rows to review: {len(issues)} -> {issues_path}")


if __name__ == "__main__":
    main()