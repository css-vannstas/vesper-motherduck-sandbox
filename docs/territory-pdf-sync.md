# Territory PDF Sync



## Purpose and scope

Turn a human-readable PDF or Excel file into a traceable assignment table for reporting. New files are created upon meaningful staffing / territory changes. This process is intended to preserve historical territory assignments for reporting.


## Inputs

accepts `.xlsx` or `.pdf` files; expected tabs; whether a prior territory assignment exists; whether to create a new territory assignment or update an existing one. Attempt PDF-to-XLSX conversion before parsing, and retain the converted file for review.


## Source inventory

- **Page or Tab 1:** "US, CA, MX"

  - 2 United States tables with 3 columns each: Rep, State, Zipcode containing ranges of 3-digit zip codes.
  - Mexico - Qual table with 2 columns: State, ABBR. The rep the "Qual" part of the "Mexico - Qual" table header.
  - Canada - Qual table with 3 columns: Rep, Province, ABBR.
  - Metadata in field F48 containing update date and notes. Capture the text as source metadata. 
- **Page or Tab 2:** "Overseas Territory"
  - A table for each region with the rep name (example: "Qual") in the header row, and a single column for each country in that region.


## Output grain

1 row per rep per territory assignment: `rep` + `country` + `state/province` + `3-digit zip code`.
<br>

Each row contains the unique territory assignment ID, rep name, geographic fields, start date, end date, and source file reference.
<br>

Each file is a complete snapshot of the territory assignments as of the update date in F48. Compare its normalized assignments with the currently active assignments:

- unchanged geography and rep: no action
- new geography and / or new rep: create a new assignment with the start date from F48
- previously active geography and / or rep no longer present: end the assignment with the end date from F48
- rep changed for a geography: end the previous assignment with the end date from F48, and create a new assignment with the start date from F48.
<br>

Start dates are inclusive; end dates are exclusive. If the end date is missing, the assignment is considered active.

### Initial historical baseline
The first file establishes the earliest assignments known to this process. Its F48 date is recorded as the start date for those assignments, but that does not prove the reps first received their territories on that date. Earlier assignment history requires older source files or another verified source.


## Transformation rules
1. Stack the boxes.
2. Carry a rep down from headings.
3. Expand US zip3 ranges inclusively. Preserve leading zeroes.
4. Standardize country names while retaining the source text.


## Validation

Reconcile source entries to parsed entries; check range expansion, missing reps, conflicting active assignments, and changes from the previous version. Review a sample against the original document.


## Operation

- CLI command to run the process:
- Required parameters:
- Output location:
- Who reviews exceptions:
- How to load into MotherDuck: