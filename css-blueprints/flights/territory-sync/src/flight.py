import os
import re

import duckdb


def main():
    database = os.environ["SOURCE_DATABASE"]
    table = os.environ["SOURCE_TABLE"]

    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", database):
        raise ValueError(f"Invalid database name: {database!r}")

    if not re.fullmatch(r"territory_lookup_[A-Za-z0-9_]+", table):
        raise ValueError(f"Invalid territory lookup table name: {table!r}")

    con = duckdb.connect("md:")

    found = con.execute(
        f"""
        SELECT count(*)
        FROM "{database}".information_schema.tables
        WHERE table_schema = 'staging'
          AND table_name = ?
          AND table_type = 'BASE TABLE'
        """,
        [table],
    ).fetchone()[0]

    if not found:
        raise ValueError(f"Table not found: {database}.staging.{table}")

    row_count = con.execute(
        f'SELECT count(*) FROM "{database}"."staging"."{table}"'
    ).fetchone()[0]

    columns = con.execute(
        f"""
        SELECT column_name, data_type
        FROM "{database}".information_schema.columns
        WHERE table_schema = 'staging'
          AND table_name = ?
        ORDER BY ordinal_position
        """,
        [table],
    ).fetchall()

    print(f"Found {database}.staging.{table}: {row_count} rows")
    for name, data_type in columns:
        print(f"  {name}: {data_type}")

    con.close()


if __name__ == "__main__":
    main()