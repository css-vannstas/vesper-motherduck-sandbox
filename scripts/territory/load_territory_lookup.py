"""Loads territory assignments into MotherDuck"""

import argparse
import csv
from datetime import date
from pathlib import Path

import duckdb


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_csv", type=Path)
    parser.add_argument(
        "--effective-date",
        required=True,
        type=date.fromisoformat,
        metavar="YYYY-MM-DD",
        help="Effective date shown in the source PDF",
    )
    args = parser.parse_args()

    csv_path = args.input_csv.resolve()
    if not csv_path.is_file():
        parser.error(f"File not found: {csv_path}")

    with csv_path.open(newline="", encoding="utf-8-sig") as source:
        expected_rows = sum(1 for _ in csv.DictReader(source))

    if expected_rows == 0:
        parser.error("The lookup CSV has no data rows.")

    table_name = (
        f"css.staging.territory_lookup_pdf_"
        f"{args.effective_date:%Y%m%d}"
    )

    con = duckdb.connect("md:css")
    try:
        con.execute("CREATE SCHEMA IF NOT EXISTS staging")
        con.execute(
            f"""
            CREATE OR REPLACE TABLE {table_name} AS
            SELECT *
            FROM read_csv(
                ?, header = true, all_varchar = true, MD_RUN = LOCAL
            )
            """,
            [str(csv_path)],
        )

        loaded_rows = con.execute(
            f"SELECT count(*) FROM {table_name}"
        ).fetchone()[0]

        if loaded_rows != expected_rows:
            raise ValueError(
                f"CSV has {expected_rows} rows; MotherDuck has {loaded_rows}"    
            )

        print(f"Loaded {loaded_rows} rows into {table_name}")
    finally:
        con.close()

if __name__ == "__main__":
    main()