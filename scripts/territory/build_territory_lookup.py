import csv
from pathlib import Path
import argparse


def expand_zip_range(zip_range):
    parts = zip_range.replace("\u2013", "-").split("-")
    start = int(parts[0])
    end = int(parts[-1])

    if start > end:
        raise ValueError(f"ZIP range runs backward: {zip_range}")

    return [f"{number:03d}" for number in range(start, end +1)]


"""United States"""
def read_us_rows(path):
    lookup_rows = []

    with path.open(newline="", encoding="utf-8-sig") as source:
        for row in csv.DictReader(source):
            for zip3 in expand_zip_range(row["zip_range"]):
                lookup_rows.append({
                    "territory_type": "us_zip3",
                    "country_code": "US",
                    "state_province": row["state"],
                    "state_province_code": row["state"],
                    "postal_prefix": zip3,
                    "region": "",
                    "country": "",
                    "rep": row["rep"],
                    })

    return lookup_rows


"""Mexico"""
def read_mx_rows(path):
    lookup_rows = []

    with path.open(newline="", encoding="utf-8-sig") as source:
        for row in csv.DictReader(source):
            lookup_rows.append({
                "territory_type": "mx_state",
                "country_code": "MX",
                "state_province": row["state"],
                "state_province_code": row["abbr"],
                "postal_prefix": "",
                "region": "",
                "country": "",
                "rep": row["rep"],
                })

    return lookup_rows


"""Canada"""
def read_ca_rows(path):
    lookup_rows = []

    with path.open(newline="", encoding="utf-8-sig") as source:
        for row in csv.DictReader(source):
            lookup_rows.append({
                "territory_type": "ca_province_postal",
                "country_code": "CA",
                "state_province": row["province"],
                "state_province_code": "",
                "postal_prefix": row["zip"],
                "region": "",
                "country": "",
                "rep": row["rep"],
            })

    return lookup_rows


"""Overseas"""
def read_overseas_rows(path):
    lookup_rows = []

    with path.open(newline="", encoding="utf-8-sig") as source:
        for row in csv.DictReader(source):
            lookup_rows.append({
                "territory_type": "overseas_country",
                "country_code": "",
                "state_province": "",
                "state_province_code": "",
                "postal_prefix": "",
                "region": row["region"],
                "country": row["country"],
                "rep": row["rep"],
            })

    return lookup_rows



def main():
    parser = argparse.ArgumentParser(
        description="Combine the validated territory CSVs into one lookup."
    )
    parser.add_argument("input_pdf", type=Path)
    args = parser.parse_args()

    pdf_path = args.input_pdf
    source_paths = {
        name: pdf_path.with_name(f"{pdf_path.stem}_{name}_rows.csv")
        for name in ("us", "mx", "ca", "overseas")
    }

    for path in source_paths.values():
        if not path.is_file():
            parser.error(f"Missing source CSV: {path}")

    lookup_rows = (
        read_us_rows(source_paths["us"])
        + read_mx_rows(source_paths["mx"])
        + read_ca_rows(source_paths["ca"])
        + read_overseas_rows(source_paths["overseas"])
    )

    grouped = {}

    for row in lookup_rows:
        territory_type = row["territory_type"]

        if territory_type == "us_zip3":
            key = ("US", row["state_province_code"], row["postal_prefix"])
        elif territory_type == "mx_state":
            key = ("MX", row["state_province_code"])
        elif territory_type == "ca_province_postal":
            key = ("CA", row["state_province"], row["postal_prefix"])
        else:
            key = ("overseas", row["country"].casefold())

        grouped.setdefault(key, []).append(row)

    resolved_rows = []
    review_rows = []
    unresolved_keys = []

    for key, candidates in grouped.items():
        if len(candidates) == 1:
            resolved_rows.append(candidates[0])
            continue

        non_qual = [
            row for row in candidates
            if row["rep"].strip().casefold() != "qual"
        ]

        if len(non_qual) == 1:
            chosen = non_qual[0]
            resolved_rows.append(chosen)
        else:
            chosen = None
            unresolved_keys.append(key)

        for row in candidates:
            review_rows.append({
                **row,
                "match_key": " | ".join(key),
                "resolution": (
                    "selected_non_qual" if row is chosen
                    else "excluded_qual" if chosen is not None
                    else "unresolved"
                ),
            })

    lookup_rows = resolved_rows

    fields = [
        "territory_type", "country_code", "state_province",
        "state_province_code", "postal_prefix", "region",
        "country", "rep",
    ]
    review_path = pdf_path.with_name(
        f"{pdf_path.stem}_territory_lookup_review.csv"
    )

    with review_path.open("w", newline="", encoding="utf-8-sig") as output:
        writer = csv.DictWriter(
            output,
            fieldnames=fields + ["match_key", "resolution"],
        )
        writer.writeheader()
        writer.writerows(review_rows)

    print(f"Duplicate rows to review: {len(review_rows)} -> {review_path}")

    if unresolved_keys:
        raise ValueError(
            f"{len(unresolved_keys)} matching keys have no single non-Qual row"
        )
    output_path = pdf_path.with_name(
        f"{pdf_path.stem}_territory_lookup.csv"
    )

    with output_path.open("w", newline="", encoding="utf-8-sig") as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        writer.writerows(lookup_rows)

    print(f"Territory lookup: {len(lookup_rows)} rows -> {output_path}")


if __name__ == "__main__":
    main()