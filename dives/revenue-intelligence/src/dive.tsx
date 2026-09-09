import { useState } from "react";
import { useSQLQuery, useDiveState } from "@motherduck/react-sql-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export const REQUIRED_DATABASES = [{ type: "share", path: "md:_share/css/f5883a16-09c7-4db3-9256-7d1ae853ba7d", alias: "css" }];

const N = (v) => (v != null ? Number(v) : 0);

const TEXT = "#000000";
const MUTED = "#555555";
const PRIMARY = "#FF5000";
const SECONDARY = "#2B2B2B";
const POSITIVE = "#3366CC";
const NEGATIVE = "#FF5000";
const BG = "#FFFFFF";
const PANEL = "#F2F2F2";
const WHITE = "#FFFFFF";

const STATE_TILES = {
    AK: [1, 1], ME: [12, 1],
    WA: [1, 2], ID: [2, 2], MT: [3, 2], ND: [4, 2], MN: [5, 2], WI: [6, 2], MI: [7, 2], NY: [9, 2], VT: [10, 2], NH: [11, 2], MA: [12, 2],
    OR: [1, 3], NV: [2, 3], WY: [3, 3], SD: [4, 3], IA: [5, 3], IL: [6, 3], IN: [7, 3], OH: [8, 3], PA: [9, 3], NJ: [10, 3], CT: [11, 3], RI: [12, 3],
    CA: [1, 4], UT: [2, 4], CO: [3, 4], NE: [4, 4], MO: [5, 4], KY: [6, 4], WV: [7, 4], VA: [8, 4], MD: [9, 4], DE: [10, 4],
    AZ: [2, 5], NM: [3, 5], KS: [4, 5], AR: [5, 5], TN: [6, 5], NC: [8, 5], SC: [9, 5], DC: [10, 5],
    HI: [1, 6], TX: [3, 6], OK: [4, 6], LA: [5, 6], MS: [6, 6], AL: [7, 6], GA: [8, 6],
    FL: [9, 7],
};

function currency(value) {
    const n = N(value);
    const sign = n < 0 ? "-" : "";
    const a = Math.abs(n);
    if (a >= 1000000) return `${sign}$${(a / 1000000).toFixed(1)}M`;
    if (a >= 1000) return `${sign}$${(a / 1000).toFixed(0)}K`;
    return `${sign}$${a.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function exactCurrency(value) {
    const n = N(value);
    const sign = n < 0 ? "-" : "";
    return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedCurrency(value) {
    const n = N(value);
    return `${n >= 0 ? "+" : "-"}${currency(Math.abs(n))}`;
}

function signedPercent(value) {
    if (value == null || Number.isNaN(Number(value))) return "-";
    const n = N(value) * 100;
    return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function percent(value) {
    if (value == null || Number.isNaN(Number(value))) return "-";
    return `${(N(value) * 100).toFixed(1)}%`;
}

function changeColor(value) {
    if (value == null || Number.isNaN(Number(value))) return MUTED;
    return N(value) >= 0 ? POSITIVE : NEGATIVE;
}

function sqlLiteral(value) {
    return `'${String(value).replaceAll("'", "''")}'`;
}

function ErrorText({ query, label }) {
    if (!query.isError) return null;
    return <p className="text-sm mt-2" role="alert" style={{ color: NEGATIVE }}>{label}: {query.error instanceof Error ? query.error.message : String(query.error || "query failed")}</p>;
}

export default function SalesRepTerritoryDive() {
    const [hoveredState, setHoveredState] = useState("");
    const [tableView, setTableView] = useDiveState("table_view", "territory");
    const [assignmentFilter, setAssignmentFilter] = useDiveState("assignment_filter", "All");
    const [reportingMonth, setReportingMonth] = useDiveState("reporting_month", "");
    const safeReportingMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(reportingMonth)) ? String(reportingMonth) : "";
    const reportingMonthSql = safeReportingMonth ? `DATE '${safeReportingMonth}-01'` : "NULL::DATE";
    const periodComparisonSql = safeReportingMonth ? "=" : "<=";
    const reconciliationPeriodSql = safeReportingMonth
        ? `date_month = DATE '${safeReportingMonth}-01'`
        : `year(date_month)=current_year AND month(date_month)<=cutoff_month`;
    const safeTableView = ["territory", "rep", "state"].includes(tableView) ? tableView : "territory";
    const assignmentParts = String(assignmentFilter).split("|");
    const chartFilterSql = assignmentFilter === "All"
        ? "TRUE"
        : safeTableView === "rep"
            ? `territory_sales_rep = ${sqlLiteral(assignmentFilter)}`
            : safeTableView === "state"
                ? `state = ${sqlLiteral(assignmentFilter)}`
                : `state = ${sqlLiteral(assignmentParts[0] || "")} AND zip3 = ${sqlLiteral(assignmentParts[1] || "")}`;
    const mapFilterSql = chartFilterSql;
    const reconciliationFilterSql = assignmentFilter === "All"
        ? "TRUE"
        : safeTableView === "rep"
            ? `COALESCE(territory_sales_rep, customer_sales_rep) = ${sqlLiteral(assignmentFilter)}`
            : safeTableView === "state"
                ? `state = ${sqlLiteral(assignmentFilter)}`
                : `state = ${sqlLiteral(assignmentParts[0] || "")} AND zip3 = ${sqlLiteral(assignmentParts[1] || "")}`;
    const showZip3Heatmap = safeTableView === "state" && assignmentFilter !== "All";
    const heatmapSegmentSql = showZip3Heatmap ? "zip3" : "state";

    const summaryQuery = useSQLQuery(`
  WITH latest AS (
    SELECT COALESCE(${reportingMonthSql}, MAX(date_month)) AS max_month,
      MAX(mart_refreshed_at) AS last_refresh
    FROM "css"."mart"."rev_intel_sales_rep_territory_customer_item"
  ), bounds AS (
    SELECT EXTRACT(year FROM max_month)::INTEGER AS current_year,
      CASE WHEN ${reportingMonthSql} IS NULL AND max_month = date_trunc('month', current_date)
        THEN EXTRACT(month FROM max_month - INTERVAL 1 MONTH)::INTEGER
        ELSE EXTRACT(month FROM max_month)::INTEGER END AS cutoff_month,
      CASE WHEN ${reportingMonthSql} IS NULL AND max_month = date_trunc('month', current_date)
        THEN max_month - INTERVAL 1 MONTH ELSE max_month END AS cutoff_date,
      last_refresh
    FROM latest
  ), base AS (
    SELECT date_month, amount
    FROM "css"."mart"."rev_intel_sales_rep_territory_customer_item"
    WHERE ${chartFilterSql}
  )
  SELECT current_year, current_year - 1 AS prior_year, current_year - 2 AS two_year,
    strftime(cutoff_date, '%b %Y') AS cutoff_label,
    strftime(cutoff_date, '%Y-%m') AS cutoff_value,
    strftime(last_refresh AT TIME ZONE 'America/Los_Angeles', '%b %d, %Y %I:%M %p PT') AS last_refresh_datetime,
    SUM(amount) FILTER (WHERE year(date_month)=current_year AND month(date_month)${periodComparisonSql}cutoff_month) AS current_ytd,
    SUM(amount) FILTER (WHERE year(date_month)=current_year-1 AND month(date_month)${periodComparisonSql}cutoff_month) AS prior_ytd,
    SUM(amount) FILTER (WHERE year(date_month)=current_year-2 AND month(date_month)${periodComparisonSql}cutoff_month) AS two_year_ytd
  FROM base CROSS JOIN bounds GROUP BY current_year, cutoff_month, cutoff_date, last_refresh
`);

    const orderMetricsQuery = useSQLQuery(`
  WITH latest AS (SELECT COALESCE(${reportingMonthSql}, MAX(date_month)) AS max_month FROM "css"."mart"."rev_intel_sales_rep_territory_customer_item"),
  bounds AS (
    SELECT year(max_month)::INTEGER AS current_year,
      CASE WHEN ${reportingMonthSql} IS NULL AND max_month=date_trunc('month',current_date) THEN month(max_month-INTERVAL 1 MONTH)::INTEGER ELSE month(max_month)::INTEGER END cutoff_month
    FROM latest
  ), orders AS (
    SELECT year(transaction_date_date)::INTEGER sales_year, transaction_id, SUM(revenue_amount) order_revenue
    FROM "css"."mart"."rev_intel_sales_rep_territory_customer_item" CROSS JOIN bounds
    WHERE transaction_type IN ('invoice','cashsale')
      AND year(transaction_date_date) BETWEEN current_year-2 AND current_year
      AND month(transaction_date_date)${periodComparisonSql}cutoff_month
      AND ${chartFilterSql}
    GROUP BY 1,2
  )
  SELECT
    COUNT(*) FILTER (WHERE sales_year=current_year) current_orders,
    COUNT(*) FILTER (WHERE sales_year=current_year-1) prior_orders,
    COUNT(*) FILTER (WHERE sales_year=current_year-2) two_year_orders,
    SUM(order_revenue) FILTER (WHERE sales_year=current_year)/NULLIF(COUNT(*) FILTER (WHERE sales_year=current_year),0) current_aov,
    SUM(order_revenue) FILTER (WHERE sales_year=current_year-1)/NULLIF(COUNT(*) FILTER (WHERE sales_year=current_year-1),0) prior_aov,
    SUM(order_revenue) FILTER (WHERE sales_year=current_year-2)/NULLIF(COUNT(*) FILTER (WHERE sales_year=current_year-2),0) two_year_aov
  FROM orders CROSS JOIN bounds
`);

    const mixQuery = useSQLQuery(`
  WITH latest AS (SELECT COALESCE(${reportingMonthSql}, MAX(date_month)) max_month FROM "css"."mart"."rev_intel_sales_rep_territory_customer_item"),
  bounds AS (
    SELECT year(max_month)::INTEGER current_year,
      CASE WHEN ${reportingMonthSql} IS NULL AND max_month=date_trunc('month',current_date) THEN month(max_month-INTERVAL 1 MONTH)::INTEGER ELSE month(max_month)::INTEGER END cutoff_month
    FROM latest
  )
  SELECT
    SUM(amount) FILTER (WHERE labeltac_segment='Printers') lt_printers,
    SUM(amount) FILTER (WHERE labeltac_segment='Ribbon') lt_ribbon,
    SUM(amount) FILTER (WHERE labeltac_segment='Other LT supplies') lt_other,
    SUM(amount) FILTER (WHERE labeltac_segment='Other') other_css
  FROM "css"."mart"."rev_intel_sales_rep_territory_customer_item" CROSS JOIN bounds
  WHERE year(date_month)=current_year
    AND month(date_month)${periodComparisonSql}cutoff_month
    AND ${chartFilterSql}
`);

    const territoryQuery = useSQLQuery(`
  WITH latest AS (SELECT COALESCE(${reportingMonthSql}, MAX(date_month)) max_month FROM "css"."mart"."rev_intel_sales_rep_territory_customer_item"),
  bounds AS (
    SELECT year(max_month)::INTEGER current_year,
      CASE WHEN ${reportingMonthSql} IS NULL AND max_month=date_trunc('month',current_date) THEN month(max_month-INTERVAL 1 MONTH)::INTEGER ELSE month(max_month)::INTEGER END cutoff_month
    FROM latest
  ), rollup AS (
    SELECT territory_sales_rep territory_rep,state,zip3,
      SUM(amount) FILTER (WHERE year(date_month)=current_year AND month(date_month)${periodComparisonSql}cutoff_month AND account_number='4000') current_4000_revenue,
      SUM(amount) FILTER (WHERE year(date_month)=current_year AND month(date_month)${periodComparisonSql}cutoff_month AND account_number='4002') current_4002_revenue,
      SUM(amount) FILTER (WHERE year(date_month)=current_year AND month(date_month)${periodComparisonSql}cutoff_month) current_revenue,
      SUM(amount) FILTER (WHERE year(date_month)=current_year-1 AND month(date_month)${periodComparisonSql}cutoff_month) prior_revenue,
      SUM(amount) FILTER (WHERE year(date_month)=current_year-2 AND month(date_month)${periodComparisonSql}cutoff_month) two_year_revenue,
      SUM(amount) FILTER (WHERE year(date_month)=current_year AND month(date_month)${periodComparisonSql}cutoff_month AND is_labeltac_printer) current_printer_revenue,
      SUM(amount) FILTER (WHERE year(date_month)=current_year-1 AND month(date_month)${periodComparisonSql}cutoff_month AND is_labeltac_printer) prior_printer_revenue
    FROM "css"."mart"."rev_intel_sales_rep_territory_customer_item" CROSS JOIN bounds
    WHERE territory_sales_rep IS NOT NULL GROUP BY 1,2,3
  ), order_detail AS (
    SELECT territory_sales_rep territory_rep,state,zip3,transaction_id,SUM(revenue_amount) order_revenue
    FROM "css"."mart"."rev_intel_sales_rep_territory_customer_item" CROSS JOIN bounds
    WHERE territory_sales_rep IS NOT NULL AND transaction_type IN ('invoice','cashsale')
      AND year(transaction_date_date)=current_year AND month(transaction_date_date)${periodComparisonSql}cutoff_month
    GROUP BY 1,2,3,4
  ), orders AS (
    SELECT territory_rep,state,zip3,COUNT(*) current_orders,SUM(order_revenue) current_order_revenue,
      SUM(order_revenue)/NULLIF(COUNT(*),0) current_aov
    FROM order_detail GROUP BY 1,2,3
  )
  SELECT r.*,
    COALESCE(o.current_orders,0) current_orders,COALESCE(o.current_order_revenue,0) current_order_revenue,COALESCE(o.current_aov,0) current_aov,
    (r.current_printer_revenue-r.prior_printer_revenue)/NULLIF(r.prior_printer_revenue,0) printer_yoy_change,
    r.current_printer_revenue-r.prior_printer_revenue printer_dollar_change,
    (r.current_revenue-r.prior_revenue)/NULLIF(r.prior_revenue,0) yoy_change,
    (r.current_revenue-r.two_year_revenue)/NULLIF(r.two_year_revenue,0) change_vs_two_year
  FROM rollup r LEFT JOIN orders o USING (territory_rep,state,zip3)
  WHERE r.current_revenue IS NOT NULL OR r.prior_revenue IS NOT NULL OR r.two_year_revenue IS NOT NULL
  ORDER BY r.current_revenue DESC NULLS LAST,r.territory_rep,r.state,r.zip3
`);

    const trendQuery = useSQLQuery(`
  WITH latest AS (
    SELECT COALESCE(${reportingMonthSql}, MAX(date_month)) AS max_month
    FROM "css"."mart"."rev_intel_sales_rep_territory_customer_item"
  ), bounds AS (
    SELECT year(max_month)::INTEGER AS current_year,
      CASE WHEN ${reportingMonthSql} IS NULL AND max_month=date_trunc('month',current_date)
        THEN month(max_month-INTERVAL 1 MONTH)::INTEGER
        ELSE month(max_month)::INTEGER END AS cutoff_month
    FROM latest
  ), months AS (
    SELECT range::INTEGER AS month_num FROM range(1, 13)
  ), monthly AS (
    SELECT month(date_month)::INTEGER AS month_num,
      SUM(amount) FILTER (
        WHERE year(date_month)=current_year AND month(date_month)<=cutoff_month
      ) AS current_revenue,
      SUM(amount) FILTER (
        WHERE year(date_month)=current_year-1
      ) AS prior_revenue
    FROM "css"."mart"."rev_intel_sales_rep_territory_customer_item" CROSS JOIN bounds
    WHERE ${chartFilterSql}
      AND year(date_month) BETWEEN current_year-1 AND current_year
    GROUP BY 1
  ), order_detail AS (
    SELECT year(transaction_date_date)::INTEGER AS sales_year,
      month(transaction_date_date)::INTEGER AS month_num,
      transaction_id,
      SUM(revenue_amount) AS order_revenue
    FROM "css"."mart"."rev_intel_sales_rep_territory_customer_item" CROSS JOIN bounds
    WHERE ${chartFilterSql}
      AND transaction_type IN ('invoice','cashsale')
      AND year(transaction_date_date) BETWEEN current_year-1 AND current_year
    GROUP BY 1,2,3
  ), order_metrics AS (
    SELECT sales_year,month_num,
      COUNT(*) AS order_count,
      SUM(order_revenue)/NULLIF(COUNT(*),0) AS aov
    FROM order_detail
    GROUP BY 1,2
  )
  SELECT months.month_num,
    strftime(make_date(2000, months.month_num, 1), '%b') AS month_label,
    bounds.current_year,
    bounds.current_year - 1 AS prior_year,
    bounds.cutoff_month,
    CASE WHEN months.month_num<=bounds.cutoff_month THEN monthly.current_revenue ELSE NULL END AS current_revenue,
    monthly.prior_revenue,
    CASE WHEN months.month_num<=bounds.cutoff_month THEN co.order_count ELSE NULL END AS current_orders,
    CASE WHEN months.month_num<=bounds.cutoff_month THEN co.aov ELSE NULL END AS current_aov,
    po.order_count AS prior_orders,
    po.aov AS prior_aov
  FROM months CROSS JOIN bounds
  LEFT JOIN monthly USING (month_num)
  LEFT JOIN order_metrics co ON co.month_num=months.month_num AND co.sales_year=bounds.current_year
  LEFT JOIN order_metrics po ON po.month_num=months.month_num AND po.sales_year=bounds.current_year-1
  ORDER BY months.month_num
`);

    const mapQuery = useSQLQuery(`
  WITH latest AS (SELECT COALESCE(${reportingMonthSql}, MAX(date_month)) max_month FROM "css"."mart"."rev_intel_sales_rep_territory_customer_item"),
  bounds AS (
    SELECT year(max_month)::INTEGER current_year,
      CASE WHEN ${reportingMonthSql} IS NULL AND max_month=date_trunc('month',current_date) THEN month(max_month-INTERVAL 1 MONTH)::INTEGER ELSE month(max_month)::INTEGER END cutoff_month
    FROM latest
  ), segment_revenue AS (
    SELECT ${heatmapSegmentSql} AS map_segment,
      SUM(amount) FILTER (WHERE year(date_month)=current_year AND month(date_month)${periodComparisonSql}cutoff_month) current_revenue,
      SUM(amount) FILTER (WHERE year(date_month)=current_year-1 AND month(date_month)${periodComparisonSql}cutoff_month) prior_revenue
    FROM "css"."mart"."rev_intel_sales_rep_territory_customer_item" CROSS JOIN bounds
    WHERE ${mapFilterSql}
      AND ${heatmapSegmentSql} IS NOT NULL
    GROUP BY 1
  ), current_transactions AS (
    SELECT ${heatmapSegmentSql} AS map_segment,transaction_id,SUM(revenue_amount) order_revenue
    FROM "css"."mart"."rev_intel_sales_rep_territory_customer_item" CROSS JOIN bounds
    WHERE transaction_type IN ('invoice','cashsale')
      AND year(transaction_date_date)=current_year
      AND month(transaction_date_date)${periodComparisonSql}cutoff_month
      AND ${mapFilterSql}
      AND ${heatmapSegmentSql} IS NOT NULL
    GROUP BY 1,2
  ), segment_orders AS (
    SELECT map_segment,COUNT(*) current_orders,SUM(order_revenue)/NULLIF(COUNT(*),0) current_aov
    FROM current_transactions GROUP BY 1
  ), transactions AS (
    SELECT ${heatmapSegmentSql} AS map_segment,transaction_id,
      MAX(transaction_date_date) transaction_date,MAX(customer_name) customer_name,
      MAX(territory_sales_rep) sales_rep,SUM(revenue_amount) transaction_revenue
    FROM "css"."mart"."rev_intel_sales_rep_territory_customer_item" CROSS JOIN bounds
    WHERE year(transaction_date_date)=current_year
      AND month(transaction_date_date)${periodComparisonSql}cutoff_month
      AND ${mapFilterSql}
      AND ${heatmapSegmentSql} IS NOT NULL
    GROUP BY 1,2
  ), ranked AS (
    SELECT *,ROW_NUMBER() OVER (PARTITION BY map_segment ORDER BY transaction_revenue DESC,transaction_id) rn FROM transactions
  )
  SELECT s.map_segment,s.current_revenue,s.prior_revenue,
    COALESCE(o.current_orders,0) current_orders,COALESCE(o.current_aov,0) current_aov,
    strftime(t.transaction_date,'%b %d, %Y') top_transaction_date,
    t.customer_name top_customer_name,t.sales_rep top_sales_rep,t.transaction_revenue top_transaction_revenue
  FROM segment_revenue s
  LEFT JOIN segment_orders o USING (map_segment)
  LEFT JOIN ranked t ON t.map_segment=s.map_segment AND t.rn=1
  ORDER BY s.current_revenue DESC NULLS LAST
`);

    const reconciliationQuery = useSQLQuery(`
  WITH expected_accounts(account_number, account_label) AS (
    VALUES
      ('4000', 'Sales Revenue'),
      ('4001', 'Shipping and Handling'),
      ('4002', 'Sales Discounts'),
      ('4007', 'Foreign Exchange Gain or Loss')
  ), latest AS (
    SELECT COALESCE(${reportingMonthSql}, MAX(date_month)) max_month
    FROM "css"."mart"."rev_intel_revenue_account_reconciliation"
  ), bounds AS (
    SELECT year(max_month)::INTEGER current_year,
      CASE WHEN ${reportingMonthSql} IS NULL AND max_month=date_trunc('month',current_date)
        THEN month(max_month-INTERVAL 1 MONTH)::INTEGER
        ELSE month(max_month)::INTEGER END cutoff_month
    FROM latest
  ), totals AS (
    SELECT account_number,
      SUM(amount) total_revenue,
      SUM(amount) FILTER (WHERE territory_sales_rep IS NOT NULL) assigned_revenue,
      SUM(amount) FILTER (WHERE territory_sales_rep IS NULL) unassigned_revenue
    FROM "css"."mart"."rev_intel_revenue_account_reconciliation" CROSS JOIN bounds
    WHERE ${reconciliationPeriodSql}
      AND ${reconciliationFilterSql}
    GROUP BY account_number
  )
  SELECT a.account_number, a.account_label,
    COALESCE(t.total_revenue, 0) total_revenue,
    COALESCE(t.assigned_revenue, 0) assigned_revenue,
    COALESCE(t.unassigned_revenue, 0) unassigned_revenue
  FROM expected_accounts a
  LEFT JOIN totals t USING (account_number)
  ORDER BY a.account_number
`);

    const reconciliationReasonQuery = useSQLQuery(`
  WITH latest AS (SELECT COALESCE(${reportingMonthSql}, MAX(date_month)) max_month FROM "css"."mart"."rev_intel_revenue_account_reconciliation"),
  bounds AS (
    SELECT year(max_month)::INTEGER current_year,
      CASE WHEN ${reportingMonthSql} IS NULL AND max_month=date_trunc('month',current_date) THEN month(max_month-INTERVAL 1 MONTH)::INTEGER ELSE month(max_month)::INTEGER END cutoff_month
    FROM latest
  )
  SELECT assignment_status reason, COUNT(*) line_count, SUM(amount) revenue
  FROM "css"."mart"."rev_intel_revenue_account_reconciliation" CROSS JOIN bounds
  WHERE ${reconciliationPeriodSql}
    AND territory_sales_rep IS NULL
    AND ${reconciliationFilterSql}
  GROUP BY 1 ORDER BY ABS(SUM(amount)) DESC
`);

    const reconciliationExceptionQuery = useSQLQuery(`
  WITH latest AS (SELECT COALESCE(${reportingMonthSql}, MAX(date_month)) max_month FROM "css"."mart"."rev_intel_revenue_account_reconciliation"),
  bounds AS (
    SELECT year(max_month)::INTEGER current_year,
      CASE WHEN ${reportingMonthSql} IS NULL AND max_month=date_trunc('month',current_date) THEN month(max_month-INTERVAL 1 MONTH)::INTEGER ELSE month(max_month)::INTEGER END cutoff_month
    FROM latest
  )
  SELECT COALESCE(state,'No state') state, COALESCE(zip3,'No ZIP3') zip3,
    COALESCE(customer_sales_rep,'No customer sales rep') customer_sales_rep,
    assignment_status reason, COUNT(*) line_count, SUM(amount) revenue
  FROM "css"."mart"."rev_intel_revenue_account_reconciliation" CROSS JOIN bounds
  WHERE ${reconciliationPeriodSql}
    AND territory_sales_rep IS NULL
    AND ${reconciliationFilterSql}
  GROUP BY ALL ORDER BY ABS(SUM(amount)) DESC
  LIMIT 100
`);

    const summaryRows = Array.isArray(summaryQuery.data) ? summaryQuery.data : [];
    const orderMetricRows = Array.isArray(orderMetricsQuery.data) ? orderMetricsQuery.data : [];
    const mixRows = Array.isArray(mixQuery.data) ? mixQuery.data : [];
    const territoryRows = Array.isArray(territoryQuery.data) ? territoryQuery.data : [];
    const trendRows = Array.isArray(trendQuery.data) ? trendQuery.data : [];
    const mapRows = Array.isArray(mapQuery.data) ? mapQuery.data : [];
    const reconciliationRows = Array.isArray(reconciliationQuery.data) ? reconciliationQuery.data : [];
    const reconciliationReasonRows = Array.isArray(reconciliationReasonQuery.data) ? reconciliationReasonQuery.data : [];
    const reconciliationExceptionRows = Array.isArray(reconciliationExceptionQuery.data) ? reconciliationExceptionQuery.data : [];
    const reconciliationTotal = reconciliationRows.reduce((sum, row) => sum + N(row.total_revenue), 0);
    const reconciliationAssigned = reconciliationRows.reduce((sum, row) => sum + N(row.assigned_revenue), 0);
    const reconciliationUnassigned = reconciliationRows.reduce((sum, row) => sum + N(row.unassigned_revenue), 0);
    const reconciliationVariance = reconciliationTotal - reconciliationAssigned - reconciliationUnassigned;
    const reconciliationAssignedPct = reconciliationTotal === 0 ? 0 : reconciliationAssigned / reconciliationTotal;
    const reconciliationUnassignedPct = reconciliationTotal === 0 ? 0 : reconciliationUnassigned / reconciliationTotal;
    const maxReconciliationReason = Math.max(0, ...reconciliationReasonRows.map((row) => Math.abs(N(row.revenue))));
    const repOptions = [...new Set(territoryRows.map((row) => String(row.territory_rep || "")).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value }));
    const stateOptions = [...new Set(territoryRows.map((row) => String(row.state || "")).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value }));
    const territoryOptions = [...new Map(
        territoryRows
            .filter((row) => row.state && row.zip3)
            .map((row) => {
                const state = String(row.state);
                const zip = String(row.zip3);
                return [`${state}|${zip}`, { value: `${state}|${zip}`, label: `${state} · ${zip}` }];
            })
    ).values()].sort((a, b) => a.label.localeCompare(b.label));
    const filterOptions = safeTableView === "rep" ? repOptions : safeTableView === "state" ? stateOptions : territoryOptions;
    const activeAssignmentFilter = assignmentFilter === "All" || filterOptions.some((option) => option.value === assignmentFilter)
        ? assignmentFilter
        : "All";
    const trendChartData = (() => {
        let currentRtd = 0;
        let priorRtd = 0;
        return trendRows.map((row) => {
            const currentMonthComplete = N(row.month_num) <= N(row.cutoff_month);
            const currentMonthlyRevenue = currentMonthComplete ? N(row.current_revenue) : null;
            const priorMonthlyRevenue = N(row.prior_revenue);
            if (currentMonthComplete) currentRtd += N(row.current_revenue);
            priorRtd += priorMonthlyRevenue;
            return {
                month: String(row.month_label || ""),
                currentRevenue: currentMonthlyRevenue,
                priorRevenue: row.prior_revenue == null ? null : priorMonthlyRevenue,
                currentRtd: currentMonthComplete ? currentRtd : null,
                priorRtd,
                currentOrders: row.current_orders == null ? null : N(row.current_orders),
                priorOrders: row.prior_orders == null ? null : N(row.prior_orders),
                currentAov: row.current_aov == null ? null : N(row.current_aov),
                priorAov: row.prior_aov == null ? null : N(row.prior_aov),
            };
        });
    })();
    const summary = summaryRows[0] || {};
    const orderMetrics = orderMetricRows[0] || {};
    const mix = mixRows[0] || {};

    const currentYear = String(summary.current_year || "2026");
    const priorYear = String(summary.prior_year || "2025");
    const twoYear = String(summary.two_year || "2024");
    const current = N(summary.current_ytd);
    const prior = N(summary.prior_ytd);
    const older = N(summary.two_year_ytd);
    const yoy = prior === 0 ? null : (current - prior) / prior;
    const twoYearChange = older === 0 ? null : (current - older) / older;
    const currentOrders = N(orderMetrics.current_orders);
    const priorOrders = N(orderMetrics.prior_orders);
    const twoYearOrders = N(orderMetrics.two_year_orders);
    const currentAov = N(orderMetrics.current_aov);
    const priorAov = N(orderMetrics.prior_aov);
    const twoYearAov = N(orderMetrics.two_year_aov);
    const orderChange = priorOrders === 0 ? null : (currentOrders - priorOrders) / priorOrders;
    const orderTwoYearChange = twoYearOrders === 0 ? null : (currentOrders - twoYearOrders) / twoYearOrders;
    const aovChange = priorAov === 0 ? null : (currentAov - priorAov) / priorAov;
    const aovTwoYearChange = twoYearAov === 0 ? null : (currentAov - twoYearAov) / twoYearAov;
    const mixSlices = [
        { label: "LT printers", value: Math.max(0, N(mix.lt_printers)), color: PRIMARY },
        { label: "LT ribbon", value: Math.max(0, N(mix.lt_ribbon)), color: POSITIVE },
        { label: "LT other supplies", value: Math.max(0, N(mix.lt_other)), color: SECONDARY },
        { label: "Other CSS", value: Math.max(0, N(mix.other_css)), color: "#C9C9C9" },
    ];
    const mixTotal = mixSlices.reduce((sum, slice) => sum + slice.value, 0);
    const ltMixShare = mixTotal === 0 ? null : mixSlices.slice(0, 3).reduce((sum, slice) => sum + slice.value, 0) / mixTotal;
    let mixAngle = 0;
    const mixStops = mixSlices.map((slice) => {
        const start = mixAngle;
        mixAngle += mixTotal === 0 ? 0 : (slice.value / mixTotal) * 360;
        return `${slice.color} ${start}deg ${mixAngle}deg`;
    });
    const mixGradient = mixTotal > 0 ? `conic-gradient(${mixStops.join(", ")})` : PANEL;

    const stateRevenue = {};
    mapRows.forEach((row) => {
        const currentRevenue = N(row.current_revenue);
        const priorRevenue = N(row.prior_revenue);
        stateRevenue[String(row.map_segment || "")] = {
            current: currentRevenue,
            prior: priorRevenue,
            yoy: priorRevenue === 0 ? null : (currentRevenue - priorRevenue) / priorRevenue,
            change: currentRevenue - priorRevenue,
            currentOrders: N(row.current_orders),
            currentAov: N(row.current_aov),
            topTransactionDate: String(row.top_transaction_date || ""),
            topCustomerName: String(row.top_customer_name || "Unknown customer"),
            topSalesRep: String(row.top_sales_rep || "Unassigned"),
            topTransactionRevenue: N(row.top_transaction_revenue),
        };
    });
    const maxStateRevenue = Math.max(0, ...Object.values(stateRevenue).map((d) => N(d.current)));
    const maxDecline = Math.max(0, ...Object.values(stateRevenue).map((d) => d.yoy != null && N(d.yoy) < 0 ? Math.abs(N(d.yoy)) : 0));

    const filteredTerritoryRows = activeAssignmentFilter === "All"
        ? territoryRows
        : territoryRows.filter((row) => {
            if (safeTableView === "rep") return String(row.territory_rep || "") === activeAssignmentFilter;
            if (safeTableView === "state") return String(row.state || "") === activeAssignmentFilter;
            return String(row.state || "") === String(assignmentParts[0] || "")
                && String(row.zip3 || "") === String(assignmentParts[1] || "");
        });

    const buildRepPerformance = (rows) => Object.values(rows.reduce((groups, row) => {
        const rep = String(row.territory_rep || "Unassigned");
        if (!groups[rep]) groups[rep] = {
            rep, current_revenue: 0, prior_revenue: 0,
            current_orders: 0, current_order_revenue: 0,
            current_printer_revenue: 0, prior_printer_revenue: 0,
        };
        groups[rep].current_revenue += N(row.current_revenue);
        groups[rep].prior_revenue += N(row.prior_revenue);
        groups[rep].current_orders += N(row.current_orders);
        groups[rep].current_order_revenue += N(row.current_order_revenue);
        groups[rep].current_printer_revenue += N(row.current_printer_revenue);
        groups[rep].prior_printer_revenue += N(row.prior_printer_revenue);
        return groups;
    }, {})).map((row) => ({
        ...row,
        revenue_growth: N(row.current_revenue) - N(row.prior_revenue),
        revenue_growth_pct: N(row.prior_revenue) === 0 ? null : (N(row.current_revenue) - N(row.prior_revenue)) / N(row.prior_revenue),
        current_aov: N(row.current_orders) === 0 ? 0 : N(row.current_order_revenue) / N(row.current_orders),
        printer_growth: N(row.current_printer_revenue) - N(row.prior_printer_revenue),
        printer_growth_pct: N(row.prior_printer_revenue) === 0 ? null : (N(row.current_printer_revenue) - N(row.prior_printer_revenue)) / N(row.prior_printer_revenue),
    }));
    const globalRepPerformance = buildRepPerformance(territoryRows);
    const scopedRepPerformance = buildRepPerformance(filteredTerritoryRows);
    const topRevenue = (rows) => rows
        .filter((row) => N(row.current_revenue) > 0)
        .sort((a, b) => N(b.current_revenue) - N(a.current_revenue))[0] || null;
    const topGrowth = (rows) => rows
        .filter((row) => N(row.prior_revenue) > 0)
        .sort((a, b) => N(b.revenue_growth_pct) - N(a.revenue_growth_pct))[0] || null;
    const topAov = (rows) => rows
        .filter((row) => N(row.current_orders) > 0)
        .sort((a, b) => N(b.current_aov) - N(a.current_aov))[0] || null;
    const topPrinterGrowth = (rows) => rows
        .filter((row) => N(row.prior_printer_revenue) > 0)
        .sort((a, b) => N(b.printer_growth_pct) - N(a.printer_growth_pct))[0] || null;
    const globalRevenueLeader = topRevenue(globalRepPerformance);
    const globalGrowthLeader = topGrowth(globalRepPerformance);
    const globalAovLeader = topAov(globalRepPerformance);
    const globalPrinterGrowthLeader = topPrinterGrowth(globalRepPerformance);
    const scopedRevenueLeader = topRevenue(scopedRepPerformance);
    const scopedGrowthLeader = topGrowth(scopedRepPerformance);
    const scopedAovLeader = topAov(scopedRepPerformance);
    const scopedPrinterGrowthLeader = topPrinterGrowth(scopedRepPerformance);
    const isRepOneOnOne = safeTableView === "rep" && activeAssignmentFilter !== "All";
    const protectLeader = (globalLeader, scopedLeader) => isRepOneOnOne
        ? (globalLeader?.rep === activeAssignmentFilter ? scopedLeader : null)
        : scopedLeader;
    const revenueLeader = protectLeader(globalRevenueLeader, scopedRevenueLeader);
    const growthLeader = protectLeader(globalGrowthLeader, scopedGrowthLeader);
    const aovLeader = protectLeader(globalAovLeader, scopedAovLeader);
    const printerGrowthLeader = protectLeader(globalPrinterGrowthLeader, scopedPrinterGrowthLeader);
    const showLeaderSection = !isRepOneOnOne || Boolean(revenueLeader || growthLeader || aovLeader || printerGrowthLeader);

    const tableRows = safeTableView === "territory"
        ? filteredTerritoryRows
        : Object.values(filteredTerritoryRows.reduce((groups, row) => {
            const label = safeTableView === "rep" ? String(row.territory_rep || "Unassigned") : String(row.state || "Unknown");
            if (!groups[label]) groups[label] = { label, current_4000_revenue: 0, current_4002_revenue: 0, current_revenue: 0, prior_revenue: 0, two_year_revenue: 0, current_orders: 0, current_order_revenue: 0, current_printer_revenue: 0, prior_printer_revenue: 0 };
            groups[label].current_4000_revenue += N(row.current_4000_revenue);
            groups[label].current_4002_revenue += N(row.current_4002_revenue);
            groups[label].current_revenue += N(row.current_revenue);
            groups[label].prior_revenue += N(row.prior_revenue);
            groups[label].two_year_revenue += N(row.two_year_revenue);
            groups[label].current_orders += N(row.current_orders);
            groups[label].current_order_revenue += N(row.current_order_revenue);
            groups[label].current_printer_revenue += N(row.current_printer_revenue);
            groups[label].prior_printer_revenue += N(row.prior_printer_revenue);
            return groups;
        }, {})).map((row) => ({
            ...row,
            current_aov: N(row.current_orders) === 0 ? 0 : N(row.current_order_revenue) / N(row.current_orders),
            printer_yoy_change: N(row.prior_printer_revenue) === 0 ? null : (N(row.current_printer_revenue) - N(row.prior_printer_revenue)) / N(row.prior_printer_revenue),
            printer_dollar_change: N(row.current_printer_revenue) - N(row.prior_printer_revenue),
            yoy_change: N(row.prior_revenue) === 0 ? null : (N(row.current_revenue) - N(row.prior_revenue)) / N(row.prior_revenue),
            change_vs_two_year: N(row.two_year_revenue) === 0 ? null : (N(row.current_revenue) - N(row.two_year_revenue)) / N(row.two_year_revenue),
        })).sort((a, b) => N(b.current_revenue) - N(a.current_revenue));

    const tableTotals = tableRows.reduce((totals, row) => {
        totals.current_4000_revenue += N(row.current_4000_revenue);
        totals.current_4002_revenue += N(row.current_4002_revenue);
        totals.current_revenue += N(row.current_revenue);
        totals.prior_revenue += N(row.prior_revenue);
        totals.two_year_revenue += N(row.two_year_revenue);
        totals.current_orders += N(row.current_orders);
        totals.current_order_revenue += N(row.current_order_revenue);
        totals.current_printer_revenue += N(row.current_printer_revenue);
        totals.prior_printer_revenue += N(row.prior_printer_revenue);
        return totals;
    }, {
        current_4000_revenue: 0, current_4002_revenue: 0, current_revenue: 0,
        prior_revenue: 0, two_year_revenue: 0, current_orders: 0,
        current_order_revenue: 0, current_printer_revenue: 0, prior_printer_revenue: 0,
    });
    tableTotals.current_aov = tableTotals.current_orders === 0 ? 0 : tableTotals.current_order_revenue / tableTotals.current_orders;
    tableTotals.printer_yoy_change = tableTotals.prior_printer_revenue === 0 ? null : (tableTotals.current_printer_revenue - tableTotals.prior_printer_revenue) / tableTotals.prior_printer_revenue;
    tableTotals.printer_dollar_change = tableTotals.current_printer_revenue - tableTotals.prior_printer_revenue;
    tableTotals.yoy_change = tableTotals.prior_revenue === 0 ? null : (tableTotals.current_revenue - tableTotals.prior_revenue) / tableTotals.prior_revenue;
    tableTotals.change_vs_two_year = tableTotals.two_year_revenue === 0 ? null : (tableTotals.current_revenue - tableTotals.two_year_revenue) / tableTotals.two_year_revenue;

    return (
        <div className="p-6" style={{ background: BG, color: TEXT, fontFamily: "Roboto, 'Helvetica Neue', Arial, sans-serif" }}>
            <header className="mb-6" style={{ background: SECONDARY, borderTop: `8px solid ${PRIMARY}`, padding: "18px 20px" }}>
                <div className="flex items-center gap-3">
                    <span className="font-bold" style={{ background: PRIMARY, color: WHITE, display: "inline-block", lineHeight: 1, padding: "5px 8px" }}>CSS</span>
                    <span className="font-bold text-lg" style={{ color: WHITE }}>REVENUE INTELLIGENCE</span>
                </div>
                <div className="flex flex-wrap items-end justify-between gap-5">
                    <div style={{ flex: "1 1 420px", minWidth: 280 }}>
                        <p className="text-sm" style={{ color: "#E6E6E6", marginTop: 2 }}>
                            {summaryQuery.isLoading ? "Loading aligned period" : safeReportingMonth ? `${summary.cutoff_label || "Selected month"}, compared with the same month in ${priorYear} and ${twoYear}` : `${currentYear} through ${summary.cutoff_label || "latest complete month"}, compared with the same months in ${priorYear} and ${twoYear}`}
                        </p>
                        <p className="text-xs mt-1" style={{ color: "#BFBFBF" }}>
                            Last data refresh: {summary.last_refresh_datetime || (summaryQuery.isLoading ? "Loading…" : "Unavailable")}
                        </p>
                        <ErrorText query={summaryQuery} label="Summary query" />
                    </div>
                    <div className="flex flex-wrap items-end justify-end gap-3" style={{ marginLeft: "auto" }}>
                        <div>
                            <p className="text-xs font-semibold mb-1" style={{ color: "#D9D9D9" }}>Filter dashboard by</p>
                            <div className="flex gap-1" aria-label="Sales assignment filter type">
                                {[
                                    ["rep", "Sales rep"],
                                    ["state", "State"],
                                    ["territory", "State + ZIP3"],
                                ].map(([key, label]) => (
                                    <button
                                        key={key}
                                        type="button"
                                        className="px-3 py-2 text-xs font-semibold"
                                        onClick={() => {
                                            setTableView(key);
                                            setAssignmentFilter("All");
                                        }}
                                        style={{
                                            background: safeTableView === key ? PRIMARY : WHITE,
                                            color: safeTableView === key ? WHITE : SECONDARY,
                                            border: `1px solid ${safeTableView === key ? PRIMARY : "#B5B5B5"}`,
                                            borderRadius: 3,
                                            height: 38,
                                            boxSizing: "border-box",
                                        }}
                                    >{label}</button>
                                ))}
                            </div>
                        </div>
                        <label className="text-xs font-semibold" style={{ color: "#D9D9D9", minWidth: 240 }}>
                            {safeTableView === "rep" ? "Sales rep" : safeTableView === "state" ? "State" : "State + ZIP3"}
                            <select
                                className="block w-full mt-1 px-3 py-2 text-sm"
                                value={activeAssignmentFilter}
                                onChange={(event) => setAssignmentFilter(event.target.value)}
                                style={{ background: WHITE, color: SECONDARY, border: "1px solid #B5B5B5", borderRadius: 3, height: 38, boxSizing: "border-box" }}
                            >
                                <option value="All">All {safeTableView === "rep" ? "sales reps" : safeTableView === "state" ? "states" : "state + ZIP3 combinations"}</option>
                                {filterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                        </label>
                        <div style={{ minWidth: 190 }}>
                            <label className="text-xs font-semibold" style={{ color: "#D9D9D9" }}>
                                Reporting month
                                <input
                                    type="month"
                                    min="2024-01"
                                    className="block w-full mt-1 px-3 py-2 text-sm"
                                    value={safeReportingMonth || String(summary.cutoff_value || "")}
                                    onChange={(event) => setReportingMonth(event.target.value)}
                                    style={{ background: WHITE, color: SECONDARY, border: "1px solid #B5B5B5", borderRadius: 3, height: 38, boxSizing: "border-box" }}
                                />
                            </label>
                        </div>
                    </div>
                </div>
            </header>

            <section className="grid grid-cols-4 gap-6 mb-7">
                <div>
                    {summaryQuery.isLoading ? (
                        <div className="h-12 w-40 bg-gray-200 animate-pulse rounded" />
                    ) : (
                        <p className="text-5xl font-bold" style={{ color: TEXT }}>{currency(current)}</p>
                    )}
                    <p className="text-sm mt-2" style={{ color: MUTED }}>{safeReportingMonth ? `${summary.cutoff_label || "Selected month"} net revenue` : `${currentYear} net revenue through ${summary.cutoff_label || "cutoff"}`}</p>
                    {!summaryQuery.isLoading && (
                        <div className="mt-1 text-xs">
                            <p style={{ color: changeColor(yoy) }}>{signedPercent(yoy)} | {signedCurrency(current - prior)} vs {priorYear}</p>
                            <p style={{ color: MUTED }}>{signedPercent(twoYearChange)} | {signedCurrency(current - older)} vs {twoYear}</p>
                        </div>
                    )}
                </div>
                <div>
                    {orderMetricsQuery.isLoading ? (
                        <div className="h-12 w-32 bg-gray-200 animate-pulse rounded" />
                    ) : (
                        <p className="text-5xl font-bold" style={{ color: TEXT }}>{Math.round(currentOrders).toLocaleString()}</p>
                    )}
                    <p className="text-sm mt-2" style={{ color: MUTED }}>{currentYear} orders</p>
                    {!orderMetricsQuery.isLoading && (
                        <div className="mt-1 text-xs">
                            <p style={{ color: changeColor(orderChange) }}>{signedPercent(orderChange)} vs {priorYear}</p>
                            <p style={{ color: MUTED }}>{signedPercent(orderTwoYearChange)} vs {twoYear}</p>
                        </div>
                    )}
                </div>
                <div>
                    {orderMetricsQuery.isLoading ? (
                        <div className="h-12 w-32 bg-gray-200 animate-pulse rounded" />
                    ) : (
                        <p className="text-5xl font-bold" style={{ color: TEXT }}>{currency(currentAov)}</p>
                    )}
                    <p className="text-sm mt-2" style={{ color: MUTED }}>Average order value</p>
                    {!orderMetricsQuery.isLoading && (
                        <div className="mt-1 text-xs">
                            <p style={{ color: changeColor(aovChange) }}>{signedPercent(aovChange)} vs {priorYear}</p>
                            <p style={{ color: MUTED }}>{signedPercent(aovTwoYearChange)} vs {twoYear}</p>
                        </div>
                    )}
                </div>
                <div>
                    <p className="text-sm font-semibold" style={{ color: TEXT }}>{currentYear} revenue mix</p>
                    {mixQuery.isLoading ? (
                        <div className="h-24 mt-2 animate-pulse rounded" style={{ background: PANEL }} />
                    ) : (
                        <div className="flex items-center gap-3 mt-2">
                            <div
                                className="flex items-center justify-center"
                                style={{ width: 92, height: 92, minWidth: 92, borderRadius: "50%", background: mixGradient }}
                                aria-label={`${currentYear} LabelTac revenue mix`}
                            >
                                <div className="flex flex-col items-center justify-center" style={{ width: 52, height: 52, borderRadius: "50%", background: WHITE }}>
                                    <span className="text-sm font-bold">{percent(ltMixShare)}</span>
                                    <span style={{ fontSize: 9, color: MUTED }}>total LT</span>
                                </div>
                            </div>
                            <div className="space-y-1" style={{ minWidth: 0 }}>
                                {mixSlices.map((slice) => (
                                    <div key={slice.label} className="flex items-center gap-1 text-xs" style={{ whiteSpace: "nowrap" }}>
                                        <i style={{ display: "inline-block", width: 8, height: 8, background: slice.color, flex: "0 0 auto" }} />
                                        <span style={{ color: MUTED }}>{slice.label}</span>
                                        <span className="font-semibold">{percent(mixTotal === 0 ? null : slice.value / mixTotal)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    <ErrorText query={mixQuery} label="Revenue mix query" />
                </div>
                <ErrorText query={orderMetricsQuery} label="Order metrics query" />
            </section>

            <div className="mb-7" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 20, alignItems: "stretch" }}>
                <section style={{ border: `1px solid ${PANEL}`, borderTop: `5px solid ${PRIMARY}`, padding: "18px 18px 12px", height: "100%" }}>
                    <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                        <div>
                            <h2 className="text-base font-semibold" style={{ color: TEXT }}>Monthly revenue: {currentYear} vs {priorYear}</h2>
                            <p className="text-xs mt-1" style={{ color: MUTED }}>
                                {activeAssignmentFilter === "All"
                                    ? "All CSS sales assignments"
                                    : `${safeTableView === "rep" ? "Sales rep" : safeTableView === "state" ? "State" : "State + ZIP3"}: ${filterOptions.find((option) => option.value === activeAssignmentFilter)?.label || activeAssignmentFilter}`}
                                {" · "}{`${currentYear} runs through ${summary.cutoff_label || "the reporting month"}; ${priorYear} shows the full calendar year`}
                            </p>
                        </div>
                        <div className="flex items-center gap-4 text-xs" style={{ color: MUTED }}>
                            <span className="flex items-center gap-2"><i style={{ display: "inline-block", width: 24, height: 3, background: PRIMARY }} />{currentYear}</span>
                            <span className="flex items-center gap-2"><i style={{ display: "inline-block", width: 24, borderTop: `3px dashed ${POSITIVE}` }} />{priorYear}</span>
                        </div>
                    </div>
                    {trendQuery.isLoading ? (
                        <div className="animate-pulse rounded" style={{ height: 250, background: PANEL }} />
                    ) : (
                        <div style={{ width: "100%", height: 250 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={trendChartData} margin={{ top: 10, right: 18, left: 8, bottom: 0 }}>
                                    <CartesianGrid stroke="#E6E6E6" vertical={false} />
                                    <XAxis dataKey="month" tick={{ fill: MUTED, fontSize: 11 }} axisLine={{ stroke: "#B5B5B5" }} tickLine={false} />
                                    <YAxis
                                        tick={{ fill: MUTED, fontSize: 11 }}
                                        axisLine={false}
                                        tickLine={false}
                                        width={62}
                                        tickFormatter={(value) => currency(value)}
                                    />
                                    <Tooltip
                                        content={({ active, payload, label }) => {
                                            const point = payload?.[0]?.payload;
                                            if (!active || !point) return null;
                                            return (
                                                <div style={{ minWidth: 290, padding: "10px 12px", background: WHITE, border: `1px solid ${SECONDARY}`, borderTop: `3px solid ${PRIMARY}`, color: TEXT, boxShadow: "0 4px 14px rgba(0,0,0,0.16)" }}>
                                                    <p className="text-sm font-bold mb-2">{label}</p>
                                                    {[
                                                        { year: currentYear, revenue: point.currentRevenue, rtd: point.currentRtd, orders: point.currentOrders, aov: point.currentAov, color: PRIMARY },
                                                        { year: priorYear, revenue: point.priorRevenue, rtd: point.priorRtd, orders: point.priorOrders, aov: point.priorAov, color: POSITIVE },
                                                    ].map((item) => (
                                                        <div key={item.year} className="py-2" style={{ borderTop: "1px solid #E6E6E6" }}>
                                                            <p className="text-xs font-bold" style={{ color: item.color }}>{item.year}</p>
                                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginTop: 4 }}>
                                                                <div><p style={{ fontSize: 10, color: MUTED }}>Revenue</p><p className="text-xs font-semibold">{item.revenue == null ? "—" : currency(item.revenue)}</p></div>
                                                                <div><p style={{ fontSize: 10, color: MUTED }}>RTD</p><p className="text-xs font-semibold">{item.rtd == null ? "—" : currency(item.rtd)}</p></div>
                                                                <div><p style={{ fontSize: 10, color: MUTED }}>Orders</p><p className="text-xs font-semibold">{item.orders == null ? "—" : Math.round(N(item.orders)).toLocaleString()}</p></div>
                                                                <div><p style={{ fontSize: 10, color: MUTED }}>AOV</p><p className="text-xs font-semibold">{item.aov == null ? "—" : currency(item.aov)}</p></div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            );
                                        }}
                                    />
                                    <Line type="linear" dataKey="currentRevenue" stroke={PRIMARY} strokeWidth={3} dot={{ r: 3, fill: PRIMARY }} activeDot={{ r: 5 }} connectNulls={false} />
                                    <Line type="linear" dataKey="priorRevenue" stroke={POSITIVE} strokeWidth={3} strokeDasharray="7 5" dot={{ r: 3, fill: POSITIVE }} activeDot={{ r: 5 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                    <ErrorText query={trendQuery} label="Revenue trend query" />
                </section>
                <section style={{ border: `1px solid ${PANEL}`, borderTop: `5px solid ${POSITIVE}`, padding: "18px", height: "100%" }}>
                    <div className="flex items-end justify-between mb-3">
                        <div>
                            <h2 className="text-base font-semibold" style={{ color: TEXT }}>
                                {showZip3Heatmap ? `ZIP3 revenue heatmap · ${activeAssignmentFilter}` : "U.S. revenue heatmap"}
                            </h2>
                            <p className="text-xs mt-1" style={{ color: MUTED }}>
                                {showZip3Heatmap
                                    ? `ZIP3 segments within ${activeAssignmentFilter} · blue is flat or growing; orange indicates YoY decline`
                                    : "Blue shows flat or growing states by revenue | orange intensity shows YoY decline severity"}
                            </p>
                        </div>
                        <div className="flex items-center gap-3 text-xs" style={{ color: MUTED }}>
                            <span className="flex items-center gap-1"><i style={{ display: "inline-block", width: 12, height: 12, background: "#3366CC" }} />Flat / growth</span>
                            <span className="flex items-center gap-1"><i style={{ display: "inline-block", width: 12, height: 12, background: PRIMARY }} />YoY decline</span>
                        </div>
                    </div>
                    {mapQuery.isLoading ? (
                        <div className="animate-pulse rounded" style={{ height: 220, background: PANEL }} />
                    ) : showZip3Heatmap ? (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(64px, 1fr))", gap: 5, padding: "4px 0" }}>
                            {Object.entries(stateRevenue)
                                .sort((a, b) => N(b[1].current) - N(a[1].current))
                                .map(([zip3, zipData]) => {
                                    const revenue = N(zipData.current);
                                    const ratio = maxStateRevenue > 0 ? revenue / maxStateRevenue : 0;
                                    const isDeclining = zipData.yoy != null && N(zipData.yoy) < 0;
                                    const declineRatio = isDeclining && maxDecline > 0 ? Math.abs(N(zipData.yoy)) / maxDecline : 0;
                                    const intensity = isDeclining
                                        ? 0.25 + 0.75 * Math.sqrt(declineRatio)
                                        : revenue > 0 ? 0.18 + 0.82 * Math.sqrt(ratio) : 0;
                                    const tileColor = isDeclining ? `rgba(255,80,0,${intensity})` : `rgba(51,102,204,${intensity})`;
                                    return (
                                        <div
                                            key={zip3}
                                            className="flex items-center justify-center text-xs font-bold"
                                            onMouseEnter={() => setHoveredState(zip3)}
                                            onMouseLeave={() => setHoveredState("")}
                                            style={{ minHeight: 36, background: revenue > 0 ? tileColor : PANEL, color: intensity > 0.52 ? WHITE : SECONDARY, borderRadius: 2, position: "relative", cursor: "default" }}
                                        >
                                            {zip3}
                                            {hoveredState === zip3 && (
                                                <div style={{ position: "absolute", left: "50%", bottom: "calc(100% + 6px)", transform: "translateX(-50%)", zIndex: 20, minWidth: 220, padding: "9px 10px", background: SECONDARY, color: WHITE, borderTop: `3px solid ${PRIMARY}`, boxShadow: "0 4px 14px rgba(0,0,0,0.22)", textAlign: "left", pointerEvents: "none" }}>
                                                    <p className="text-sm font-bold">ZIP3 {zip3} · {activeAssignmentFilter}</p>
                                                    <p className="text-xs mt-1">{currentYear}: {currency(zipData.current)}</p>
                                                    <p className="text-xs">{currentYear}: {Math.round(N(zipData.currentOrders)).toLocaleString()} orders | {currency(zipData.currentAov)} AOV</p>
                                                    <p className="text-xs">{priorYear}: {currency(zipData.prior)}</p>
                                                    <p className="text-xs mt-1" style={{ color: N(zipData.change) >= 0 ? "#9FC5FF" : "#FF9B7A" }}>{signedPercent(zipData.yoy)} | {signedCurrency(zipData.change)} vs {priorYear}</p>
                                                    <div className="mt-2 pt-2" style={{ borderTop: "1px solid #666666" }}>
                                                        <p className="text-xs font-bold">{safeReportingMonth ? `Largest transaction in ${summary.cutoff_label || "selected month"}` : `Largest transaction through ${summary.cutoff_label || "cutoff"}`}</p>
                                                        <p className="text-xs mt-1">{zipData.topTransactionDate || "Date unavailable"}</p>
                                                        <p className="text-xs" style={{ whiteSpace: "normal" }}>{zipData.topCustomerName}</p>
                                                        <p className="text-xs">{currency(zipData.topTransactionRevenue)} | {zipData.topSalesRep}</p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                        </div>
                    ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gridTemplateRows: "repeat(7, 30px)", gap: 3, padding: "4px 0" }}>
                            {Object.entries(STATE_TILES).map(([state, pos]) => {
                                const stateData = stateRevenue[state] || {
                                    current: 0, prior: 0, yoy: null, change: 0,
                                    currentOrders: 0, currentAov: 0,
                                    topTransactionDate: "", topCustomerName: "Unknown customer",
                                    topSalesRep: "Unassigned", topTransactionRevenue: 0,
                                };
                                const revenue = N(stateData.current);
                                const ratio = maxStateRevenue > 0 ? revenue / maxStateRevenue : 0;
                                const isDeclining = stateData.yoy != null && N(stateData.yoy) < 0;
                                const declineRatio = isDeclining && maxDecline > 0 ? Math.abs(N(stateData.yoy)) / maxDecline : 0;
                                const intensity = isDeclining ? 0.25 + 0.75 * Math.sqrt(declineRatio) : revenue > 0 ? 0.18 + 0.82 * Math.sqrt(ratio) : 0;
                                const tileColor = isDeclining ? `rgba(255,80,0,${intensity})` : `rgba(51,102,204,${intensity})`;
                                return (
                                    <div
                                        key={state}
                                        className="flex items-center justify-center text-xs font-bold"
                                        onMouseEnter={() => setHoveredState(state)}
                                        onMouseLeave={() => setHoveredState("")}
                                        style={{ gridColumn: pos[0], gridRow: pos[1], background: revenue > 0 ? tileColor : PANEL, color: intensity > 0.52 ? WHITE : SECONDARY, borderRadius: 2, position: "relative", cursor: "default" }}
                                    >
                                        {state}
                                        {hoveredState === state && (
                                            <div style={{ position: "absolute", left: "50%", bottom: "calc(100% + 6px)", transform: "translateX(-50%)", zIndex: 20, minWidth: 220, padding: "9px 10px", background: SECONDARY, color: WHITE, borderTop: `3px solid ${PRIMARY}`, boxShadow: "0 4px 14px rgba(0,0,0,0.22)", textAlign: "left", pointerEvents: "none" }}>
                                                <p className="text-sm font-bold">{state}</p>
                                                <p className="text-xs mt-1">{currentYear}: {currency(stateData.current)}</p>
                                                <p className="text-xs">{currentYear}: {Math.round(N(stateData.currentOrders)).toLocaleString()} orders | {currency(stateData.currentAov)} AOV</p>
                                                <p className="text-xs">{priorYear}: {currency(stateData.prior)}</p>
                                                <p className="text-xs mt-1" style={{ color: N(stateData.change) >= 0 ? "#9FC5FF" : "#FF9B7A" }}>{signedPercent(stateData.yoy)} | {signedCurrency(stateData.change)} vs {priorYear}</p>
                                                <div className="mt-2 pt-2" style={{ borderTop: "1px solid #666666" }}>
                                                    <p className="text-xs font-bold">Largest transaction since 2024</p>
                                                    <p className="text-xs mt-1">{stateData.topTransactionDate || "Date unavailable"}</p>
                                                    <p className="text-xs" style={{ whiteSpace: "normal" }}>{stateData.topCustomerName}</p>
                                                    <p className="text-xs">{currency(stateData.topTransactionRevenue)} | {stateData.topSalesRep}</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <ErrorText query={mapQuery} label={showZip3Heatmap ? "ZIP3 map query" : "Map query"} />
                </section>
            </div>

            {showLeaderSection && (
                <section className="mb-7" style={{ background: SECONDARY, color: WHITE, borderTop: `5px solid ${PRIMARY}` }}>
                    {territoryQuery.isLoading ? (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
                            {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-24 animate-pulse" style={{ background: i === 1 ? "#333333" : "#3A3A3A", borderLeft: i > 1 ? "1px solid #555555" : "none" }} />)}
                        </div>
                    ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
                            <div className="px-4 py-4 flex flex-col justify-start">
                                <p className="text-xs font-bold uppercase" style={{ color: "#D9D9D9", letterSpacing: "0.08em" }}>Revenue by sales assignment</p>
                                <p className="text-xs mt-2" style={{ color: "#BFBFBF" }}>{safeReportingMonth ? `Assigned territories for ${summary.cutoff_label || "selected month"}` : `Assigned territories through ${summary.cutoff_label || "cutoff"}`}</p>
                            </div>
                            <div className="px-4 py-4" style={{ borderLeft: "1px solid #555555", minWidth: 0 }}>
                                <p className="text-xs font-semibold uppercase" style={{ color: "#BFBFBF" }}>Revenue leader</p>
                                <p className="text-xl font-bold mt-1" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{revenueLeader ? revenueLeader.rep : (isRepOneOnOne ? "Not held" : "-")}</p>
                                <p className="text-lg font-bold mt-1" style={{ color: PRIMARY }}>{revenueLeader ? currency(revenueLeader.current_revenue) : ""}</p>
                                <p className="text-xs mt-1" style={{ color: "#D9D9D9" }}>{revenueLeader ? `${percent(current === 0 ? null : N(revenueLeader.current_revenue) / current)} of total revenue` : (isRepOneOnOne ? "No unrelated leader shown" : "No qualifying rep")}</p>
                            </div>
                            <div className="px-4 py-4" style={{ borderLeft: "1px solid #555555", minWidth: 0 }}>
                                <p className="text-xs font-semibold uppercase" style={{ color: "#BFBFBF" }}>Growth leader</p>
                                <p className="text-xl font-bold mt-1" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{growthLeader ? growthLeader.rep : (isRepOneOnOne ? "Not held" : "-")}</p>
                                <p className="text-lg font-bold mt-1" style={{ color: growthLeader ? (N(growthLeader.revenue_growth_pct) >= 0 ? "#9FC5FF" : PRIMARY) : "#BFBFBF" }}>{growthLeader ? signedPercent(growthLeader.revenue_growth_pct) : ""}</p>
                                <p className="text-xs mt-1" style={{ color: "#D9D9D9" }}>{growthLeader ? `${signedCurrency(growthLeader.revenue_growth)} vs ${priorYear}` : (isRepOneOnOne ? "No unrelated leader shown" : "No qualifying rep")}</p>
                            </div>
                            <div className="px-4 py-4" style={{ borderLeft: "1px solid #555555", minWidth: 0 }}>
                                <p className="text-xs font-semibold uppercase" style={{ color: "#BFBFBF" }}>AOV leader</p>
                                <p className="text-xl font-bold mt-1" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{aovLeader ? aovLeader.rep : (isRepOneOnOne ? "Not held" : "-")}</p>
                                <p className="text-lg font-bold mt-1" style={{ color: PRIMARY }}>{aovLeader ? currency(aovLeader.current_aov) : ""}</p>
                                <p className="text-xs mt-1" style={{ color: "#D9D9D9" }}>{aovLeader ? `${Math.round(N(aovLeader.current_orders)).toLocaleString()} orders` : (isRepOneOnOne ? "No unrelated leader shown" : "No qualifying rep")}</p>
                            </div>
                            <div className="px-4 py-4" style={{ borderLeft: "1px solid #555555", minWidth: 0 }}>
                                <p className="text-xs font-semibold uppercase" style={{ color: "#BFBFBF" }}>LT printer growth leader</p>
                                <p className="text-xl font-bold mt-1" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{printerGrowthLeader ? printerGrowthLeader.rep : (isRepOneOnOne ? "Not held" : "-")}</p>
                                <p className="text-lg font-bold mt-1" style={{ color: printerGrowthLeader ? (N(printerGrowthLeader.printer_growth_pct) >= 0 ? "#9FC5FF" : PRIMARY) : "#BFBFBF" }}>{printerGrowthLeader ? signedPercent(printerGrowthLeader.printer_growth_pct) : ""}</p>
                                <p className="text-xs mt-1" style={{ color: "#D9D9D9" }}>{printerGrowthLeader ? `${signedCurrency(printerGrowthLeader.printer_growth)} vs ${priorYear}` : (isRepOneOnOne ? "No unrelated leader shown" : "No qualifying rep")}</p>
                            </div>
                        </div>
                    )}
                </section>
            )}

            <section className="mb-7">
                {territoryQuery.isLoading ? (
                    <div className="animate-pulse space-y-2">
                        {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-9 bg-gray-200 rounded" />)}
                    </div>
                ) : (
                    <div style={{ maxHeight: 320, overflowY: "auto", borderBottom: `1px solid ${PANEL}` }}>
                        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                            <thead style={{ position: "sticky", top: 0, zIndex: 2, background: WHITE }}>
                                <tr style={{ borderBottom: `2px solid ${SECONDARY}` }}>
                                    {(safeTableView === "territory"
                                        ? ["Sales rep", "State", "ZIP3", "Revenue", "Discounts", currentYear, `% of ${currentYear} total`, `${currentYear} orders`, `${currentYear} AOV`, `${currentYear} LT printers`, `${priorYear} LT printers`, "LT printer YoY change", priorYear, twoYear, `% vs ${priorYear}`, `% vs ${twoYear}`]
                                        : [safeTableView === "rep" ? "Sales rep" : "State", "Revenue", "Discounts", currentYear, `% of ${currentYear} total`, `${currentYear} orders`, `${currentYear} AOV`, `${currentYear} LT printers`, `${priorYear} LT printers`, "LT printer YoY change", priorYear, twoYear, `% vs ${priorYear}`, `% vs ${twoYear}`]
                                    ).map((label) => (
                                        <th
                                            key={label}
                                            className="py-2 text-left text-xs font-semibold"
                                            style={{
                                                color: MUTED,
                                                whiteSpace: "nowrap",
                                                paddingLeft: safeTableView === "territory" && label === "ZIP3" ? 4 : safeTableView === "territory" && label === "Revenue" ? 20 : 8,
                                                paddingRight: safeTableView === "territory" && label === "State" ? 4 : 8,
                                                width: safeTableView === "territory" && (label === "State" || label === "ZIP3") ? 1 : undefined,
                                            }}
                                        >{label}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {tableRows.map((row) => (
                                    <tr key={safeTableView === "territory" ? `${row.territory_rep}-${row.state}-${row.zip3}` : String(row.label)} style={{ borderBottom: `1px solid ${PANEL}` }}>
                                        {safeTableView === "territory" ? (
                                            <>
                                                <td className="py-2 px-2 font-semibold" style={{ whiteSpace: "nowrap" }}>{String(row.territory_rep || "Unassigned")}</td>
                                                <td className="py-2" style={{ paddingLeft: 8, paddingRight: 4, width: 1, whiteSpace: "nowrap" }}>{String(row.state || "-")}</td>
                                                <td className="py-2" style={{ paddingLeft: 4, paddingRight: 8, width: 1, whiteSpace: "nowrap" }}>{String(row.zip3 || "-")}</td>
                                            </>
                                        ) : (
                                            <td className="py-2 px-2 font-semibold" style={{ whiteSpace: "nowrap" }}>{String(row.label || "Unknown")}</td>
                                        )}
                                        <td className="py-2" style={{ whiteSpace: "nowrap", paddingLeft: safeTableView === "territory" ? 20 : 8, paddingRight: 8 }}>{currency(row.current_4000_revenue)}</td>
                                        <td className="py-2 px-2" style={{ whiteSpace: "nowrap" }}>{currency(row.current_4002_revenue)}</td>
                                        <td className="py-2 px-2 font-semibold" style={{ whiteSpace: "nowrap" }}>{currency(row.current_revenue)}</td>
                                        <td className="py-2 px-2 font-semibold" style={{ whiteSpace: "nowrap" }}>{percent(current === 0 ? null : N(row.current_revenue) / current)}</td>
                                        <td className="py-2 px-2" style={{ whiteSpace: "nowrap" }}>{Math.round(N(row.current_orders)).toLocaleString()}</td>
                                        <td className="py-2 px-2" style={{ whiteSpace: "nowrap" }}>{currency(row.current_aov)}</td>
                                        <td className="py-2 px-2" style={{ whiteSpace: "nowrap" }}>{currency(row.current_printer_revenue)}</td>
                                        <td className="py-2 px-2" style={{ whiteSpace: "nowrap" }}>{currency(row.prior_printer_revenue)}</td>
                                        <td className="py-2 px-2 font-semibold" style={{ color: changeColor(row.printer_yoy_change), whiteSpace: "nowrap" }}>{signedPercent(row.printer_yoy_change)} | {signedCurrency(row.printer_dollar_change)}</td>
                                        <td className="py-2 px-2" style={{ whiteSpace: "nowrap" }}>{currency(row.prior_revenue)}</td>
                                        <td className="py-2 px-2" style={{ whiteSpace: "nowrap" }}>{currency(row.two_year_revenue)}</td>
                                        <td className="py-2 px-2 font-semibold" style={{ color: changeColor(row.yoy_change), whiteSpace: "nowrap" }}>{signedPercent(row.yoy_change)}</td>
                                        <td className="py-2 px-2 font-semibold" style={{ color: changeColor(row.change_vs_two_year), whiteSpace: "nowrap" }}>{signedPercent(row.change_vs_two_year)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot style={{ position: "sticky", bottom: 0, zIndex: 3, background: SECONDARY, color: WHITE }}>
                                <tr style={{ borderTop: `3px solid ${PRIMARY}` }}>
                                    <td colSpan={safeTableView === "territory" ? 3 : 1} className="py-2 px-2 font-bold" style={{ whiteSpace: "nowrap" }}>Totals</td>
                                    <td className="py-2 px-2 font-semibold" style={{ whiteSpace: "nowrap" }}>{currency(tableTotals.current_4000_revenue)}</td>
                                    <td className="py-2 px-2 font-semibold" style={{ whiteSpace: "nowrap" }}>{currency(tableTotals.current_4002_revenue)}</td>
                                    <td className="py-2 px-2 font-bold" style={{ whiteSpace: "nowrap" }}>{currency(tableTotals.current_revenue)}</td>
                                    <td className="py-2 px-2 font-bold" style={{ whiteSpace: "nowrap" }}>{percent(current === 0 ? null : tableTotals.current_revenue / current)}</td>
                                    <td className="py-2 px-2" style={{ whiteSpace: "nowrap" }}>{Math.round(tableTotals.current_orders).toLocaleString()}</td>
                                    <td className="py-2 px-2" style={{ whiteSpace: "nowrap" }}>{currency(tableTotals.current_aov)}</td>
                                    <td className="py-2 px-2" style={{ whiteSpace: "nowrap" }}>{currency(tableTotals.current_printer_revenue)}</td>
                                    <td className="py-2 px-2" style={{ whiteSpace: "nowrap" }}>{currency(tableTotals.prior_printer_revenue)}</td>
                                    <td className="py-2 px-2 font-semibold" style={{ color: tableTotals.printer_yoy_change == null || N(tableTotals.printer_yoy_change) >= 0 ? "#9FC5FF" : "#FF9B7A", whiteSpace: "nowrap" }}>{signedPercent(tableTotals.printer_yoy_change)} | {signedCurrency(tableTotals.printer_dollar_change)}</td>
                                    <td className="py-2 px-2" style={{ whiteSpace: "nowrap" }}>{currency(tableTotals.prior_revenue)}</td>
                                    <td className="py-2 px-2" style={{ whiteSpace: "nowrap" }}>{currency(tableTotals.two_year_revenue)}</td>
                                    <td className="py-2 px-2 font-semibold" style={{ color: tableTotals.yoy_change == null || N(tableTotals.yoy_change) >= 0 ? "#9FC5FF" : "#FF9B7A", whiteSpace: "nowrap" }}>{signedPercent(tableTotals.yoy_change)}</td>
                                    <td className="py-2 px-2 font-semibold" style={{ color: tableTotals.change_vs_two_year == null || N(tableTotals.change_vs_two_year) >= 0 ? "#9FC5FF" : "#FF9B7A", whiteSpace: "nowrap" }}>{signedPercent(tableTotals.change_vs_two_year)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
                <p className="text-xs mt-2" style={{ color: MUTED }}>{tableRows.length.toLocaleString()} {safeTableView === "territory" ? "territory combinations" : safeTableView === "rep" ? "sales reps" : "states"}</p>
                <ErrorText query={territoryQuery} label="Territory query" />
            </section>



            <section className="mt-8 pt-6" style={{ borderTop: `5px solid ${SECONDARY}` }}>
                <div className="flex items-end justify-between gap-4 mb-4">
                    <div>
                        <p className="text-xs font-bold uppercase" style={{ color: PRIMARY, letterSpacing: "0.08em" }}>CFO control</p>
                        <h2 className="text-lg font-bold mt-1" style={{ color: TEXT }}>Revenue coverage & reconciliation</h2>
                        <p className="text-xs mt-1" style={{ color: MUTED }}>
                            Accounts 4000, 4001, 4002 and 4007 · assigned plus unassigned must equal the complete revenue-account total
                        </p>
                    </div>
                    <div className="text-right">
                        <p className="text-xs font-bold" style={{ color: PRIMARY }}>
                            Period: {safeReportingMonth ? (summary.cutoff_label || "Selected month") : `${currentYear} YTD through ${summary.cutoff_label || "latest complete month"}`}
                        </p>
                        <p className="text-xs mt-1" style={{ color: MUTED }}>
                            Month/year and sales-assignment filters applied<br />Topline sales KPIs above remain 4000 + 4002
                        </p>
                    </div>
                </div>

                {reconciliationQuery.isLoading ? (
                    <div className="animate-pulse rounded" style={{ height: 220, background: PANEL }} />
                ) : (
                    <>
                        <div className="grid grid-cols-4 gap-3 mb-4">
                            {[
                                { label: "Revenue accounts total", value: reconciliationTotal, color: TEXT, note: null },
                                { label: "Assigned", value: reconciliationAssigned, color: POSITIVE, note: `${percent(reconciliationAssignedPct)} of total` },
                                { label: "Unassigned", value: reconciliationUnassigned, color: PRIMARY, note: `${percent(reconciliationUnassignedPct)} of total` },
                                { label: "Variance", value: reconciliationVariance, color: Math.abs(reconciliationVariance) < 0.01 ? POSITIVE : NEGATIVE, note: null },
                            ].map((item) => (
                                <div key={item.label} className="p-3" style={{ background: PANEL, borderTop: `3px solid ${item.color}` }}>
                                    <p className="text-xs font-semibold" style={{ color: MUTED }}>{item.label}</p>
                                    <div className="flex items-baseline gap-2 mt-1">
                                        <p className="text-xl font-bold" style={{ color: item.color }}>{currency(item.value)}</p>
                                        {item.note && <p className="text-xs font-semibold" style={{ color: MUTED }}>{item.note}</p>}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="grid grid-cols-2 gap-5 mb-5">
                            <div>
                                <h3 className="text-sm font-bold mb-2">Account reconciliation · {safeReportingMonth ? (summary.cutoff_label || "Selected month") : `${currentYear} YTD`}</h3>
                                <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                                    <thead><tr style={{ borderBottom: `2px solid ${SECONDARY}` }}>
                                        <th className="py-2 text-left">Account</th><th className="py-2 text-right">Total</th>
                                        <th className="py-2 text-right">Assigned</th><th className="py-2 text-right">Unassigned</th>
                                    </tr></thead>
                                    <tbody>
                                        {reconciliationRows.map((row) => (
                                            <tr key={row.account_number} style={{ borderBottom: `1px solid ${PANEL}` }}>
                                                <td className="py-2 pr-2"><span className="font-bold">{row.account_number}</span> · {row.account_label}</td>
                                                <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{exactCurrency(row.total_revenue)}</td>
                                                <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{exactCurrency(row.assigned_revenue)}</td>
                                                <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{exactCurrency(row.unassigned_revenue)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div>
                                <h3 className="text-sm font-bold mb-2">Why revenue is unassigned</h3>
                                <div className="space-y-3">
                                    {reconciliationReasonRows.map((row) => {
                                        const width = maxReconciliationReason === 0 ? 0 : Math.abs(N(row.revenue)) / maxReconciliationReason * 100;
                                        return (
                                            <div key={row.reason}>
                                                <div className="flex justify-between gap-3 text-xs mb-1">
                                                    <span>{row.reason}</span>
                                                    <span className="font-bold">{currency(row.revenue)} · {Math.round(N(row.line_count)).toLocaleString()} lines</span>
                                                </div>
                                                <div style={{ height: 9, background: PANEL }}>
                                                    <div style={{ height: "100%", width: `${width}%`, background: PRIMARY }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <div>
                            <div className="flex items-end justify-between mb-2">
                                <h3 className="text-sm font-bold">Largest unassigned territory exceptions</h3>
                                <p className="text-xs" style={{ color: MUTED }}>Top 100 state + ZIP3 + customer-rep combinations</p>
                            </div>
                            <div style={{ maxHeight: 260, overflowY: "auto", borderBottom: `1px solid ${PANEL}` }}>
                                <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                                    <thead style={{ position: "sticky", top: 0, zIndex: 2, background: WHITE }}>
                                        <tr style={{ borderBottom: `2px solid ${SECONDARY}` }}>
                                            {["State", "ZIP3", "Customer sales rep", "Reason", "Lines", "Revenue", "% of unassigned"].map((label) => (
                                                <th key={label} className="py-2 text-left font-semibold" style={{ color: MUTED, whiteSpace: "nowrap", width: label === "State" || label === "ZIP3" ? 1 : undefined, paddingLeft: label === "ZIP3" ? 4 : 8, paddingRight: label === "State" ? 4 : 8 }}>{label}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {reconciliationExceptionRows.map((row, index) => (
                                            <tr key={`${row.state}-${row.zip3}-${row.customer_sales_rep}-${index}`} style={{ borderBottom: `1px solid ${PANEL}` }}>
                                                <td className="py-2" style={{ width: 1, whiteSpace: "nowrap", paddingLeft: 8, paddingRight: 4 }}>{row.state}</td>
                                                <td className="py-2" style={{ width: 1, whiteSpace: "nowrap", paddingLeft: 4, paddingRight: 8 }}>{row.zip3}</td>
                                                <td className="py-2 px-2 font-semibold">{row.customer_sales_rep}</td>
                                                <td className="py-2 px-2">{row.reason}</td>
                                                <td className="py-2 px-2">{Math.round(N(row.line_count)).toLocaleString()}</td>
                                                <td className="py-2 px-2 font-semibold">{currency(row.revenue)}</td>
                                                <td className="py-2 px-2">{percent(reconciliationUnassigned === 0 ? null : N(row.revenue) / reconciliationUnassigned)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}
                <ErrorText query={reconciliationQuery} label="Reconciliation query" />
                <ErrorText query={reconciliationReasonQuery} label="Reconciliation reason query" />
                <ErrorText query={reconciliationExceptionQuery} label="Reconciliation exception query" />
            </section>

            <footer className="mt-8 pt-4 text-xs" style={{ color: MUTED, borderTop: `1px solid ${PANEL}` }}>
                Data originates in NetSuite and can be verified through <strong>Reports → Financial → Trial Balance</strong> using the matching time period and the <strong>Creative Safety Supply</strong> subsidiary.
            </footer>
        </div>
    );
}