"""
Split an Amazon search-term raw CSV (date × campaign × target_value × search_term)
into two pre-aggregated CSVs — one grouped by (date × target_value), one by
(date × search_term). Each row's metrics are summed within the group.

Why: uploading the raw 12M-row file creates a Postgres table too large for
interactive dashboards. The aggregates collapse to ~100K–~5M rows each, which
the dashboard queries orders of magnitude faster without losing any number shown.

Usage:
    pip install duckdb
    python scripts/split_report_csv.py <input.csv> <out_by_target.csv> <out_by_search.csv>

The script auto-detects the real header names in the source file. If your column
names differ from the defaults below, edit the CONFIG block.
"""

from __future__ import annotations
import sys
import duckdb

# ---- CONFIG: adjust if your source CSV uses different header names -----------
DATE_COL = "Date"
CAMPAIGN_COL = "Campaign name"
CAMPAIGN_ID_COL = "Campaign ID"
TARGET_COL = "Target value"
SEARCH_TERM_COL = "Matched target"  # Amazon labels the search-term column this way
CURRENCY_COL = "Budget currency"
METRIC_COLS = ["Impressions", "Clicks", "Total cost", "Sales"]
# -----------------------------------------------------------------------------


def main(src: str, out_target: str, out_search: str) -> None:
    con = duckdb.connect()

    # Verify headers before heavy work.
    info = con.execute(
        f"DESCRIBE SELECT * FROM read_csv_auto('{src.replace(chr(39), chr(39)*2)}', SAMPLE_SIZE=2048)"
    ).fetchall()
    headers = {row[0] for row in info}
    required = {DATE_COL, CAMPAIGN_COL, TARGET_COL, SEARCH_TERM_COL, *METRIC_COLS}
    missing = required - headers
    if missing:
        print(f"ERROR: CSV is missing expected columns: {sorted(missing)}", file=sys.stderr)
        print(f"Found headers: {sorted(headers)}", file=sys.stderr)
        print("Edit the CONFIG block at the top of this script to match.", file=sys.stderr)
        sys.exit(2)

    opt_cols = [c for c in (CAMPAIGN_ID_COL, CURRENCY_COL) if c in headers]

    metric_sum_sql = ",\n         ".join(
        [f'SUM("{m}")::DOUBLE AS "{m}"' for m in METRIC_COLS]
    )

    def build_sql(group_col: str, extra_passthrough: list[str]) -> str:
        # Passthrough columns (campaign_id, currency) — use MAX as a cheap
        # "any value" aggregation since they're constant within the group
        # in practice.
        passthrough = ",\n         ".join(
            [f'MAX("{c}") AS "{c}"' for c in extra_passthrough]
        )
        passthrough_prefix = passthrough + "," if passthrough else ""
        return f"""
            SELECT "{DATE_COL}",
                   "{CAMPAIGN_COL}",
                   "{group_col}",
                   {passthrough_prefix}
                   {metric_sum_sql}
            FROM read_csv_auto('{src.replace(chr(39), chr(39)*2)}')
            WHERE "{DATE_COL}" IS NOT NULL AND "{group_col}" IS NOT NULL
            GROUP BY "{DATE_COL}", "{CAMPAIGN_COL}", "{group_col}"
        """

    print(f"[1/2] Aggregating by date × campaign × {TARGET_COL} → {out_target}")
    con.execute(
        f"COPY ({build_sql(TARGET_COL, opt_cols)}) TO '{out_target}' (HEADER, DELIMITER ',')"
    )
    print(f"      → wrote {out_target}")

    print(f"[2/2] Aggregating by date × campaign × {SEARCH_TERM_COL} → {out_search}")
    con.execute(
        f"COPY ({build_sql(SEARCH_TERM_COL, opt_cols)}) TO '{out_search}' (HEADER, DELIMITER ',')"
    )
    print(f"      → wrote {out_search}")

    # Quick row-count summary.
    tgt_rows = con.execute(f"SELECT COUNT(*) FROM read_csv_auto('{out_target}')").fetchone()[0]
    srch_rows = con.execute(f"SELECT COUNT(*) FROM read_csv_auto('{out_search}')").fetchone()[0]
    print("")
    print(f"Done. by_target: {tgt_rows:,} rows · by_search: {srch_rows:,} rows")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__.strip())
        sys.exit(1)
    main(sys.argv[1], sys.argv[2], sys.argv[3])
