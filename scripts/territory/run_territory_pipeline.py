"""Prepares CSV files from PDF for review and loading."""

import argparse
import csv
import subprocess
import sys
from datetime import date
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS.parents[1]

PARSERS = {
    "us": "parse_us_territories.py",
    "mx": "parse_mexico_territories.py",
    "ca": "parse_canada_territories.py",
    "overseas": "parse_overseas_territories.py",
}


def run(script_name, *arguments):
    subprocess.run(
        [sys.executable, str(SCRIPTS / script_name), *map(str, arguments)],
        cwd=REPO_ROOT,
        check=True,
    )


def output_path(pdf_path, suffix):
    return pdf_path.with_name(f"{pdf_path.stem}_{suffix}.csv")


def row_count(path):
    if not path.is_file():
        raise FileNotFoundError(f"Expected output is missing: {path}")

    with path.open(newline="", encoding="utf-8-sig") as source:
        return sum(1 for _ in csv.DictReader(source))


def check_parser_reviews(pdf_path):
    problems = []

    for section in PARSERS:
        path = output_path(pdf_path, f"{section}_review")
        count = row_count(path)
        print(f"{section} rows to review: {count} -> {path}")
        if count:
            problems.append(path)

    if problems:
        raise SystemExit(
            "Review the parser issues before building or loading this PDF."
        )


def prepare(pdf_path):
    run("inspect_territory_pdf.py", pdf_path)

    for script_name in PARSERS.values():
        run(script_name, pdf_path)

    check_parser_reviews(pdf_path)
    run("build_territory_lookup.py", pdf_path)

    lookup_path = output_path(pdf_path, "territory_lookup")
    duplicate_review = output_path(pdf_path, "territory_lookup_review")

    print(f"\nLookup rows: {row_count(lookup_path)} -> {lookup_path}")
    print(
        f"Duplicate rows to inspect: {row_count(duplicate_review)}"
        f" -> {duplicate_review}"
    )
    print("Inspect the lookup and duplicate review before running load.")


def load(pdf_path, effective_date):
    check_parser_reviews(pdf_path)

    lookup_path = output_path(pdf_path, "territory_lookup")
    duplicate_review = output_path(pdf_path, "territory_lookup_review")

    print(f"Loading {row_count(lookup_path)} lookup rows.")
    print(f"Duplicate review rows: {row_count(duplicate_review)}")
    run(
        "load_territory_lookup.py",
        lookup_path,
        "--effective-date",
        effective_date.isoformat(),
    )


def main():
    parser = argparse.ArgumentParser()
    subcommands = parser.add_subparsers(dest="step", required=True)

    prepare_parser = subcommands.add_parser("prepare")
    prepare_parser.add_argument("input_pdf", type=Path)

    load_parser = subcommands.add_parser("load")
    load_parser.add_argument("input_pdf", type=Path)
    load_parser.add_argument(
        "--effective-date",
        required=True,
        type=date.fromisoformat,
        metavar="YYYY-MM-DD",
    )

    args = parser.parse_args()
    pdf_path = args.input_pdf.resolve()

    if not pdf_path.is_file():
        parser.error(f"PDF not found: {pdf_path}")

    if args.step == "prepare":
        prepare(pdf_path)
    else:
        load(pdf_path, args.effective_date)


if __name__ == "__main__":
    main()