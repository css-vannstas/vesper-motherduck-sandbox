# NetSuite Account Raw Ingest

Extracts NetSuite `Account` records via SuiteQL into the shared
`raw.source_record` / `raw.source_load` envelope for the revenue pipeline
POC. This is the **raw layer only** — one row of JSON per source record, no
aggregation, no type normalization, no joins. Staging/marts are separate,
not-yet-built packages that will consume this data.

## Ownership: shared raw database registration

This package additionally declares `resources.shares.raw`, which registers
the shared `netsuite_revenue_poc` database with Blueprints purely so preview
branches get automatic cleanup on branch close. **`raw.source_record` and
`raw.source_load` are a single shared table pair written to by every
`netsuite-*-raw` Flight** (Account, Customer, Employee, Item, Transaction,
TransactionLine, TransactionAccountingLine, TransactionShippingAddress),
distinguished only by the `source_object` column — not one table per source
table. The other `netsuite-*-raw` packages declare no `resources.shares` of
their own and simply render the same database name by convention.

If this package is ever removed or disabled, the cleanup registration goes
with it even though the other 7 packages keep writing into that database
name — re-register `resources.shares.raw` on another `netsuite-*-raw`
package first if `netsuite-account-raw` is retired.

## Known open items (confirm before a real deploy)

- **NetSuite auth**: assumes SuiteQL over NetSuite's REST endpoint with
  Token-Based Auth (TBA), using a consumer key/secret + token id/secret
  issued to the existing css-service-account (the same one behind the
  va_hold pipeline). Secret names (`NETSUITE_ACCOUNT_ID`,
  `NETSUITE_CONSUMER_KEY`, `NETSUITE_CONSUMER_SECRET`, `NETSUITE_TOKEN_ID`,
  `NETSUITE_TOKEN_SECRET`) are a placeholder — confirm the actual
  provisioned names with that pipeline's owner, and confirm how a Blueprints
  `secrets:` entry surfaces as an env var at runtime (not demonstrated
  elsewhere in this repo).
- **Pagination contract**: `fetch_suiteql_rows()` assumes offset-based
  paging via `links[rel="next"]` on the SuiteQL REST response, capped at a
  1000-row page size. Confirm against NetSuite's actual behavior.
- **`source_deleted`**: always `FALSE` in this phase. NetSuite's
  `lastmodifieddate` polling model cannot observe hard deletes; a correct
  implementation needs a separate full-ID reconciliation scan (not built
  here).

Run `make validate` from the repository root before any deploy. Only ever
deploy with `--target preview` for this POC — see the repository's
`CLAUDE.md` for why `prod` requires separate, explicit approval.
