"""
Inspect text and positions in a territory PDF.

Extracts each word with its page number and bounding-box coordinates,
then writes a CSV beside the input PDF. Use this diagnostic output to
understand the PDF layout before writing table-parsing rules.

This script does not create territory assignments or update MotherDuck.
"""

import argparse
import csv
from pathlib import Path

import pdfplumber


def main():
    # read the pdf filename supplied on the command line
    parser = argparse.ArgumentParser(
        description="List PDF words and their page positions."
    )
    parser.add_argument("input_pdf", type=Path)
    args = parser.parse_args()

    input_pdf = args.input_pdf

    if not input_pdf.is_file():
        parser.error(f"File not found: {input_pdf}")

    # Put the output CSV file in the same directory as the input PDF
    output_csv = input_pdf.with_name(f"{input_pdf.stem}_words.csv")
    row_count = 0

    with pdfplumber.open(input_pdf) as pdf:
        with output_csv.open("w", newline="", encoding="utf-8-sig") as output:
            writer = csv.writer(output)
            writer.writerow(["page", "text", "x0", "top", "x1", "bottom"])

            for page in pdf.pages:
                words = page.extract_words(use_text_flow=False)

                # Make the CSV easier to read by sorting the words by their position on the page
                for word in sorted(words, key=lambda w: (w["top"], w["x0"])):
                    writer.writerow(
                        [
                            page.page_number,
                            word["text"],
                            round(word["x0"], 2),
                            round(word["top"], 2),
                            round(word["x1"], 2),
                            round(word["bottom"], 2),
                        ]
                    )
                    row_count += 1

    print(f"Extracted {row_count} words from {input_pdf} to {output_csv}")

    if row_count == 0:
        print(
            "No words were extracted. This may be because the PDF is scanned or contains images instead of text and may require OCR."
        )

if __name__ == "__main__":
    main()