"""NetSuite Account raw ingest: SuiteQL -> shared raw.source_record / raw.source_load.

This is the raw layer only: one row of JSON per NetSuite Account record, no
aggregation, no type normalization, no joins. raw.source_record and
raw.source_load are a SINGLE shared table pair written to by every
netsuite-*-raw Flight in this POC, distinguished only by the source_object
column value — see README.md for the package-ownership note on the shared
raw database registration.

Known open items (see README.md): exact secret names/auth library, and the
SuiteQL REST pagination contract, are working assumptions pending
confirmation against the existing va_hold-feeding NetSuite pipeline.
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import json
import os
import re
import secrets as pysecrets
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any

import duckdb

SOURCE_SYSTEM = "netsuite"
SOURCE_OBJECT = "Account"
NATURAL_KEY_COLUMNS = ("id",)
LASTMODIFIED_COLUMN = "lastmodifieddate"
FIELDS = (
    "acctnumber",
    "balance",
    "displaynamewithhierarchy",
    "id",
    "isinactive",
    "lastmodifieddate",
)

DEFAULT_CONFIG = {
    "database": "netsuite_revenue_poc",
    "schema": "raw",
    "source_object": SOURCE_OBJECT,
    "source_system": SOURCE_SYSTEM,
    "natural_key_columns": ",".join(NATURAL_KEY_COLUMNS),
    "lastmodified_column": LASTMODIFIED_COLUMN,
    "lookback_days": "7",
    "backfill_mode": "false",
    "page_size": "1000",
}

SAFE_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def load_runtime_config() -> dict[str, str]:
    """Accept config from common Flight/env shapes, falling back to defaults."""
    raw = (
        os.getenv("MOTHERDUCK_FLIGHT_CONFIG")
        or os.getenv("FLIGHT_CONFIG")
        or os.getenv("CONFIG")
    )
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {str(k): str(v) for k, v in parsed.items()}


RUNTIME_CONFIG = load_runtime_config()


def setting(name: str) -> str:
    env_keys = (f"NETSUITE_{SOURCE_OBJECT.upper()}_{name.upper()}", name.upper(), name)
    for key in env_keys:
        if os.getenv(key):
            return os.environ[key]

    for key in (name, name.lower(), name.upper()):
        if key in RUNTIME_CONFIG and RUNTIME_CONFIG[key]:
            return RUNTIME_CONFIG[key]

    return DEFAULT_CONFIG[name]


def secret(name: str) -> str:
    """Read a Blueprints `secrets:` entry.

    ASSUMPTION (open item, see README.md): a declared `secrets:` entry
    surfaces as a plain env var matching its declared name. Not yet
    demonstrated elsewhere in this repo — confirm before relying on this.
    """
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Required secret {name!r} is not set")
    return value


def quote_ident(value: str) -> str:
    if not SAFE_IDENTIFIER.match(value):
        raise ValueError(f"Unsafe SQL identifier: {value!r}")
    return f'"{value}"'


# --------------------------------------------------------------------------
# NetSuite SuiteQL client (REST, OAuth 1.0a Token-Based Auth, stdlib only)
# --------------------------------------------------------------------------


def normalize_account_host(account_id: str) -> str:
    return account_id.strip().lower().replace("_", "-")


def build_oauth1_header(
    method: str,
    url: str,
    account_id: str,
    consumer_key: str,
    consumer_secret: str,
    token_id: str,
    token_secret: str,
) -> str:
    oauth_params = {
        "oauth_consumer_key": consumer_key,
        "oauth_token": token_id,
        "oauth_signature_method": "HMAC-SHA256",
        "oauth_timestamp": str(int(time.time())),
        "oauth_nonce": pysecrets.token_hex(16),
        "oauth_version": "1.0",
    }

    parsed = urllib.parse.urlsplit(url)
    base_url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
    query_params = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    all_params = sorted(list(oauth_params.items()) + query_params)
    normalized_params = "&".join(
        f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(v, safe='')}"
        for k, v in all_params
    )
    base_string = "&".join(
        urllib.parse.quote(part, safe="")
        for part in (method.upper(), base_url, normalized_params)
    )
    signing_key = "&".join(
        urllib.parse.quote(part, safe="")
        for part in (consumer_secret, token_secret)
    )
    signature = base64.b64encode(
        hmac.new(signing_key.encode("utf-8"), base_string.encode("utf-8"), hashlib.sha256).digest()
    ).decode("utf-8")

    header_params = dict(oauth_params)
    header_params["oauth_signature"] = signature
    header_items = ", ".join(
        f'{k}="{urllib.parse.quote(v, safe="")}"' for k, v in sorted(header_params.items())
    )
    return f'OAuth realm="{account_id}", {header_items}'


def suiteql_endpoint(account_id: str) -> str:
    host = normalize_account_host(account_id)
    return f"https://{host}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql"


def fetch_suiteql_page(query: str, offset: int, page_size: int) -> dict[str, Any]:
    account_id = secret("NETSUITE_ACCOUNT_ID")
    consumer_key = secret("NETSUITE_CONSUMER_KEY")
    consumer_secret = secret("NETSUITE_CONSUMER_SECRET")
    token_id = secret("NETSUITE_TOKEN_ID")
    token_secret = secret("NETSUITE_TOKEN_SECRET")

    url = f"{suiteql_endpoint(account_id)}?limit={page_size}&offset={offset}"
    body = json.dumps({"q": query}).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "transient",
        "Authorization": build_oauth1_header(
            "POST", url, account_id, consumer_key, consumer_secret, token_id, token_secret
        ),
    }
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")

    retries = 3
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            retryable = exc.code == 429 or 500 <= exc.code < 600
            if not retryable or attempt == retries:
                raise
            time.sleep(attempt * 2)
        except urllib.error.URLError:
            if attempt == retries:
                raise
            time.sleep(attempt * 2)

    raise RuntimeError(f"Failed to fetch SuiteQL page at offset {offset}")


def fetch_suiteql_rows(query: str, page_size: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = fetch_suiteql_page(query, offset, page_size)
        items = page.get("items", [])
        rows.extend(items)
        if page.get("hasMore") and items:
            offset += len(items)
            continue
        break
    return rows


# --------------------------------------------------------------------------
# Query construction
# --------------------------------------------------------------------------


def build_query(backfill_mode: bool, lookback_days: int) -> str:
    field_list = ", ".join(FIELDS)
    if backfill_mode:
        # Account is a slowly-changing dimension: backfill in full, no date bound.
        return f"SELECT {field_list} FROM {SOURCE_OBJECT} ORDER BY id"

    window_start = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=lookback_days)
    window_start_sql = window_start.strftime("%Y-%m-%d %H:%M:%S")
    return (
        f"SELECT {field_list} FROM {SOURCE_OBJECT} "
        f"WHERE {LASTMODIFIED_COLUMN} >= TO_DATE('{window_start_sql}', 'YYYY-MM-DD HH24:MI:SS') "
        f"ORDER BY id"
    )


# --------------------------------------------------------------------------
# Raw envelope: shared source_record / source_load tables
# --------------------------------------------------------------------------


def ensure_raw_envelope(con: duckdb.DuckDBPyConnection, database: str, schema: str) -> None:
    database_ident = quote_ident(database)
    schema_ident = quote_ident(schema)

    con.execute(f"CREATE DATABASE IF NOT EXISTS {database_ident}")
    con.execute(f"USE {database_ident}")
    con.execute(f"CREATE SCHEMA IF NOT EXISTS {schema_ident}")
    con.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {schema_ident}.source_record (
          source_load_id    VARCHAR NOT NULL,
          source_system     VARCHAR NOT NULL,
          source_object     VARCHAR NOT NULL,
          source_record_id  VARCHAR NOT NULL,
          source_updated_at TIMESTAMPTZ,
          extracted_at      TIMESTAMPTZ NOT NULL,
          source_deleted    BOOLEAN NOT NULL DEFAULT FALSE,
          record_hash       VARCHAR NOT NULL,
          raw_record        JSON NOT NULL,
          PRIMARY KEY (source_system, source_object, source_record_id)
        )
        """
    )
    con.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {schema_ident}.source_load (
          source_load_id        VARCHAR NOT NULL PRIMARY KEY,
          source_system         VARCHAR NOT NULL,
          source_object         VARCHAR NOT NULL,
          extract_started_at    TIMESTAMPTZ NOT NULL,
          extract_completed_at  TIMESTAMPTZ,
          loaded_at             TIMESTAMPTZ,
          row_count             BIGINT,
          file_name             VARCHAR,
          load_status           VARCHAR NOT NULL,
          load_error            VARCHAR
        )
        """
    )


def build_source_record_id(row: dict[str, Any]) -> str:
    return ":".join(str(row[col]) for col in NATURAL_KEY_COLUMNS)


def record_hash(row: dict[str, Any]) -> str:
    """Content hash independent of lastmodifieddate, in case NetSuite fails
    to bump that column on some field-level edit path."""
    canonical = json.dumps(row, sort_keys=True, default=str)
    return hashlib.md5(canonical.encode("utf-8")).hexdigest()


def merge_source_records(
    con: duckdb.DuckDBPyConnection,
    schema: str,
    staged_rows: list[tuple],
) -> None:
    schema_ident = quote_ident(schema)

    con.execute(
        """
        CREATE TEMP TABLE incoming_source_record (
          source_load_id VARCHAR, source_system VARCHAR, source_object VARCHAR,
          source_record_id VARCHAR, source_updated_at TIMESTAMPTZ,
          extracted_at TIMESTAMPTZ, source_deleted BOOLEAN,
          record_hash VARCHAR, raw_record JSON
        )
        """
    )
    con.executemany(
        "INSERT INTO incoming_source_record VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        staged_rows,
    )
    con.execute(
        f"""
        DELETE FROM {schema_ident}.source_record AS target
        USING incoming_source_record AS incoming
        WHERE target.source_system = incoming.source_system
          AND target.source_object = incoming.source_object
          AND target.source_record_id = incoming.source_record_id
        """
    )
    con.execute(
        f"""
        INSERT INTO {schema_ident}.source_record
        SELECT * FROM incoming_source_record
        """
    )


def log_source_load(
    con: duckdb.DuckDBPyConnection,
    schema: str,
    source_load_id: str,
    extract_started_at: dt.datetime,
    extract_completed_at: dt.datetime | None,
    loaded_at: dt.datetime | None,
    row_count: int | None,
    file_name: str,
    status: str,
    error: str | None,
) -> None:
    schema_ident = quote_ident(schema)
    con.execute(
        f"INSERT INTO {schema_ident}.source_load VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            source_load_id,
            SOURCE_SYSTEM,
            SOURCE_OBJECT,
            extract_started_at,
            extract_completed_at,
            loaded_at,
            row_count,
            file_name,
            status,
            error,
        ],
    )


def make_source_load_id(extract_started_at: dt.datetime) -> str:
    return f"{SOURCE_OBJECT}_{extract_started_at:%Y%m%dT%H%M%SZ}_{uuid.uuid4().hex[:8]}"


def main() -> None:
    database = setting("database")
    schema = setting("schema")
    lookback_days = int(setting("lookback_days"))
    backfill_mode = setting("backfill_mode").strip().lower() == "true"
    page_size = int(setting("page_size"))

    source_load_id = make_source_load_id(dt.datetime.now(dt.timezone.utc))
    extract_started_at = dt.datetime.now(dt.timezone.utc)

    con = duckdb.connect("md:")
    ensure_raw_envelope(con, database, schema)

    try:
        query = build_query(backfill_mode, lookback_days)
        rows = fetch_suiteql_rows(query, page_size)
        extract_completed_at = dt.datetime.now(dt.timezone.utc)
        extracted_at = extract_completed_at

        staged_rows = [
            (
                source_load_id,
                SOURCE_SYSTEM,
                SOURCE_OBJECT,
                build_source_record_id(row),
                row.get(LASTMODIFIED_COLUMN),
                extracted_at,
                False,
                record_hash(row),
                json.dumps(row, default=str),
            )
            for row in rows
        ]
        merge_source_records(con, schema, staged_rows)

        loaded_at = dt.datetime.now(dt.timezone.utc)
        log_source_load(
            con,
            schema,
            source_load_id,
            extract_started_at,
            extract_completed_at,
            loaded_at,
            len(staged_rows),
            f"suiteql:{SOURCE_OBJECT}:{extract_started_at:%Y%m%dT%H%M%SZ}",
            "success",
            None,
        )
        print(f"Loaded {len(staged_rows)} {SOURCE_OBJECT} rows into {database}.{schema}.source_record")
    except Exception as exc:
        log_source_load(
            con,
            schema,
            source_load_id,
            extract_started_at,
            dt.datetime.now(dt.timezone.utc),
            None,
            None,
            f"suiteql:{SOURCE_OBJECT}:{extract_started_at:%Y%m%dT%H%M%SZ}",
            "failed",
            f"{exc}\n{traceback.format_exc()}",
        )
        raise
    finally:
        con.close()


if __name__ == "__main__":
    main()
