import argparse
import csv
from pathlib import Path

import duckdb


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_csv", type=Path)
    args = parser.parse_args()

    csv_path = args.input_csv.resolve()
    if not csv_path.is_file():
        parser.error(f"File not found: {csv_path}")

    with csv_path.open(newline="", encoding="utf-8-sig") as source:
        expected_rows = sum(1 for _ in csv.DictReader(source))

    con = duckdb.connect("md:css")
    try:
        con.execute("CREATE SCHEMA IF NOT EXISTS staging")
        con.execute(
            """
            CREATE OR REPLACE TABLE staging.territory_lookup_pdf_20260408 AS
            SELECT *
            FROM read_csv(
                ?, header = true, all_varchar = true, MD_RUN = LOCAL
            )
            """,
            [str(csv_path)],
        )

        loaded_rows = con.execute(
            "SELECT count(*) FROM staging.territory_lookup_pdf_20260408"
        ).fetchone()[0]

        if loaded_rows != expected_rows:
            raise ValueError(
                f"CSV has {expected_rows} rows; MotherDuck has {loaded_rows}"    
            )

        print(f"Loaded {loaded_rows} rows into va_hold.staging.territory_lookup_pdf_20260408")
    finally:
        con.close()

if __name__ == "__main__":
    main()