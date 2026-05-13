/**
 * 브랜드 한 개에 대한 Sponsored Products 분석용 데이터 스냅샷을 만든다.
 * Gemini 에게 던질 입력의 구조화된 부분 — 모든 숫자는 여기서 사실에 기반해
 * 계산되고, LLM 은 해석/조언만 담당한다.
 *
 * 스냅샷에는 다음이 들어간다:
 *  - 브랜드 전체 일간/기간 총합 (current vs 비교 버킷들)
 *  - 캠페인별 current 성과 + 이전 시기 대비 변화량 (ROAS, 비용, 매출)
 *  - 현재 기간에 비용은 많이 썼는데 매출이 안 나는 "위험 키워드"
 *  - 매출/ROAS 가 좋은데 노출/클릭이 적은 "기회 키워드"
 *  - (옵션) 단일 캠페인 드릴다운: 그 캠페인의 키워드별 디테일
 */

import { execQueryLong } from "@/lib/db/exec";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { q, sqlLit } from "@/lib/reports/sql";

export type KeywordType = "search_term" | "target_value";

export interface PeriodSummary {
  from: string;
  to: string;
  days: number;
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  roas: number | null;
  acos: number | null;
  ctr: number | null;
  cvr_proxy: number | null; // sales/clicks (실제 conversion 데이터가 없어 매출/클릭으로 대체)
}

export interface CampaignDelta {
  campaign_name: string;
  current: PeriodSummary;
  prev_same_length: PeriodSummary | null;
  prev_all_time_daily_avg: PeriodSummary | null;
  roas_change_vs_prev: number | null;
  cost_change_pct_vs_prev: number | null;
  sales_change_pct_vs_prev: number | null;
}

export interface KeywordRow {
  campaign_name: string;
  keyword: string;
  keyword_type: KeywordType;
  match_type?: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  roas: number | null;
}

/** 월 단위 시계열 한 점. 누적 모드에서 LLM 에게 장기 추세를 보여주기 위해 사용. */
export interface MonthlyPoint {
  month: string; // YYYY-MM
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  roas: number | null;
}

export interface BrandSnapshot {
  brand: string;
  as_of: string;
  /** "vs_prev" = 직전 동일 길이 기간 비교, "vs_alltime" = 누적 데이터 + 장기 추세 분석. */
  comparison_mode: "vs_prev" | "vs_alltime";
  current: PeriodSummary;
  prev_same_length: PeriodSummary | null;
  prev_30d: PeriodSummary | null;
  all_time: PeriodSummary | null;
  /** 누적 모드일 때만 채워진다 — 최근 12 개월(또는 데이터 있는 만큼)의 월별 추이. */
  monthly_trend?: MonthlyPoint[];
  campaigns: CampaignDelta[];
  /** 현재 기간에 비용 큰데 ROAS 가 낮아 손실을 일으키는 키워드 top N. */
  risk_keywords: KeywordRow[];
  /** 현재 기간에 ROAS 가 높은데 노출이 상대적으로 적은 기회 키워드 top N. */
  opportunity_keywords: KeywordRow[];
  /** 캠페인 드릴다운 모드일 때만 채워진다 — 해당 캠페인의 모든 키워드 (cost desc). */
  drilldown_keywords?: KeywordRow[];
  /** 데이터 부족 등의 경고. */
  warnings: string[];
}

interface BrandReportTypes {
  searchTable: string | null;
  targetTable: string | null;
}

/** 브랜드 하위의 sp_search_term / sp_target_keyword 테이블 이름을 찾는다. */
async function resolveTablesForBrand(brand: string): Promise<BrandReportTypes> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("report_types")
    .select("kind, table_name")
    .eq("brand", brand);
  if (error) throw new Error(error.message);
  let searchTable: string | null = null;
  let targetTable: string | null = null;
  for (const r of data ?? []) {
    if (r.kind === "sp_search_term") searchTable = r.table_name as string;
    else if (r.kind === "sp_target_keyword") targetTable = r.table_name as string;
  }
  return { searchTable, targetTable };
}

function safeNum(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function periodSummaryFromRow(
  r: { impressions: unknown; clicks: unknown; cost: unknown; sales: unknown },
  from: string,
  to: string,
  days: number,
): PeriodSummary {
  const impressions = safeNum(r.impressions);
  const clicks = safeNum(r.clicks);
  const cost = safeNum(r.cost);
  const sales = safeNum(r.sales);
  return {
    from,
    to,
    days,
    impressions,
    clicks,
    cost,
    sales,
    roas: cost > 0 ? sales / cost : null,
    acos: sales > 0 ? cost / sales : null,
    ctr: impressions > 0 ? clicks / impressions : null,
    cvr_proxy: clicks > 0 ? sales / clicks : null,
  };
}

function dayDiff(a: string, b: string): number {
  const da = Date.parse(a + "T00:00:00Z");
  const db = Date.parse(b + "T00:00:00Z");
  if (!Number.isFinite(da) || !Number.isFinite(db)) return 0;
  return Math.max(0, Math.round((db - da) / 86_400_000)) + 1;
}

function addDays(d: string, delta: number): string {
  const t = Date.parse(d + "T00:00:00Z");
  if (!Number.isFinite(t)) return d;
  const out = new Date(t + delta * 86_400_000);
  return out.toISOString().slice(0, 10);
}

/** 단일 테이블에서 한 기간 동안의 합계만 뽑는 SQL. */
function aggSql(
  table: string,
  from: string,
  to: string,
  campaignFilter?: string,
): string {
  const where: string[] = [
    `date >= ${sqlLit(from)}::date`,
    `date <= ${sqlLit(to)}::date`,
  ];
  if (campaignFilter) {
    where.push(`campaign_name = ${sqlLit(campaignFilter)}`);
  }
  return `select
    coalesce(sum(impressions), 0)::bigint as impressions,
    coalesce(sum(clicks), 0)::bigint as clicks,
    coalesce(sum(total_cost), 0)::numeric as cost,
    coalesce(sum(sales), 0)::numeric as sales
  from public.${q(table)}
  where ${where.join(" and ")}`;
}

/** 캠페인별 한 기간 동안의 합계. */
function aggByCampaignSql(table: string, from: string, to: string): string {
  return `select
    campaign_name,
    coalesce(sum(impressions), 0)::bigint as impressions,
    coalesce(sum(clicks), 0)::bigint as clicks,
    coalesce(sum(total_cost), 0)::numeric as cost,
    coalesce(sum(sales), 0)::numeric as sales
  from public.${q(table)}
  where date >= ${sqlLit(from)}::date and date <= ${sqlLit(to)}::date
  group by campaign_name`;
}

/** 월 단위 시계열 SQL. brand 모드면 전체 합산, campaign 모드면 그 캠페인만. */
function monthlyTrendSql(
  table: string,
  upToInclusive: string,
  monthsBack: number,
  campaignFilter?: string,
): string {
  const where: string[] = [
    `date >= (date_trunc('month', ${sqlLit(upToInclusive)}::date) - interval '${monthsBack - 1} months')`,
    `date <= ${sqlLit(upToInclusive)}::date + interval '1 day' - interval '1 second'`,
  ];
  if (campaignFilter) {
    where.push(`campaign_name = ${sqlLit(campaignFilter)}`);
  }
  return `select
    to_char(date, 'YYYY-MM') as month,
    coalesce(sum(impressions), 0)::bigint as impressions,
    coalesce(sum(clicks), 0)::bigint as clicks,
    coalesce(sum(total_cost), 0)::numeric as cost,
    coalesce(sum(sales), 0)::numeric as sales
  from public.${q(table)}
  where ${where.join(" and ")}
  group by 1
  order by 1`;
}

/** 키워드 단위 합계 (search_term 또는 target_value). */
function aggByKeywordSql(
  table: string,
  keywordCol: KeywordType,
  from: string,
  to: string,
  campaignFilter?: string,
  matchTypeCol?: string,
): string {
  const where: string[] = [
    `date >= ${sqlLit(from)}::date`,
    `date <= ${sqlLit(to)}::date`,
    `${q(keywordCol)} is not null`,
  ];
  if (campaignFilter) {
    where.push(`campaign_name = ${sqlLit(campaignFilter)}`);
  }
  const extraSelect = matchTypeCol ? `, ${q(matchTypeCol)} as match_type` : "";
  const extraGroup = matchTypeCol ? `, ${q(matchTypeCol)}` : "";
  return `select
    campaign_name,
    ${q(keywordCol)} as keyword,
    coalesce(sum(impressions), 0)::bigint as impressions,
    coalesce(sum(clicks), 0)::bigint as clicks,
    coalesce(sum(total_cost), 0)::numeric as cost,
    coalesce(sum(sales), 0)::numeric as sales${extraSelect}
  from public.${q(table)}
  where ${where.join(" and ")}
  group by campaign_name, ${q(keywordCol)}${extraGroup}`;
}

interface AggRowFlat {
  impressions: number | string;
  clicks: number | string;
  cost: number | string;
  sales: number | string;
}
interface CampaignAggRow extends AggRowFlat {
  campaign_name: string;
}
interface KeywordAggRow extends AggRowFlat {
  campaign_name: string;
  keyword: string;
  match_type?: string | null;
}

/** 두 테이블(search/target)을 합쳐서 한 기간의 총합을 만든다.
 *  campaignFilter 가 들어오면 해당 캠페인 한정으로만 집계 — drilldown 용. */
async function combinedAgg(
  tables: BrandReportTypes,
  from: string,
  to: string,
  campaignFilter?: string,
): Promise<{ impressions: number; clicks: number; cost: number; sales: number }> {
  const out = { impressions: 0, clicks: 0, cost: 0, sales: 0 };
  for (const table of [tables.searchTable]) {
    if (!table) continue;
    try {
      const rows = await execQueryLong<AggRowFlat>(
        aggSql(table, from, to, campaignFilter),
      );
      const r = rows[0];
      if (r) {
        out.impressions += safeNum(r.impressions);
        out.clicks += safeNum(r.clicks);
        out.cost += safeNum(r.cost);
        out.sales += safeNum(r.sales);
        return out; // search term 테이블이 있으면 충분
      }
    } catch {
      // fall through to target table
    }
  }
  // search 가 없으면 target 테이블만으로
  if (tables.targetTable) {
    try {
      const rows = await execQueryLong<AggRowFlat>(
        aggSql(tables.targetTable, from, to, campaignFilter),
      );
      const r = rows[0];
      if (r) {
        out.impressions += safeNum(r.impressions);
        out.clicks += safeNum(r.clicks);
        out.cost += safeNum(r.cost);
        out.sales += safeNum(r.sales);
      }
    } catch {
      // ignore
    }
  }
  return out;
}

async function tableDateBounds(
  table: string,
): Promise<{ min: string | null; max: string | null }> {
  try {
    const rows = await execQueryLong<{ min: string | null; max: string | null }>(
      `select min(date)::text as min, max(date)::text as max from public.${q(table)}`,
    );
    return {
      min: rows[0]?.min ? rows[0].min.slice(0, 10) : null,
      max: rows[0]?.max ? rows[0].max.slice(0, 10) : null,
    };
  } catch {
    return { min: null, max: null };
  }
}

interface BuildOptions {
  brand: string;
  /** YYYY-MM-DD. 미지정 시 데이터의 최신 7일을 자동으로 잡는다. */
  currentFrom?: string | null;
  currentTo?: string | null;
  /** 분석 범위. campaign 일 때 drilldown_keywords 가 채워진다. */
  scope: "brand" | "campaign";
  campaign?: string | null;
  /** 키워드 리스트의 최대 길이. 기본 30. */
  topN?: number;
  /** "vs_prev" (기본) = 직전 동일 길이 비교 중심. "vs_alltime" = 누적 평균 +
   *  월별 추세 중심. 누적 모드일 때만 monthly_trend 를 집계해서 넘긴다. */
  comparisonMode?: "vs_prev" | "vs_alltime";
}

export async function buildBrandSnapshot(
  opts: BuildOptions,
): Promise<BrandSnapshot> {
  const warnings: string[] = [];
  const tables = await resolveTablesForBrand(opts.brand);
  const primaryTable = tables.searchTable ?? tables.targetTable;
  if (!primaryTable) {
    throw new Error(
      `브랜드 "${opts.brand}" 에 sp_search_term / sp_target_keyword 레포트가 없습니다. 먼저 업로드해주세요.`,
    );
  }

  const bounds = await tableDateBounds(primaryTable);
  if (!bounds.max || !bounds.min) {
    throw new Error("데이터가 비어 있어 분석할 수 없습니다.");
  }

  // 기간 확정.
  let currentTo = opts.currentTo ?? bounds.max;
  let currentFrom = opts.currentFrom ?? addDays(currentTo, -6);
  if (currentFrom > currentTo) [currentFrom, currentTo] = [currentTo, currentFrom];
  if (currentTo > bounds.max) currentTo = bounds.max;
  if (currentFrom < bounds.min) currentFrom = bounds.min;

  const currentDays = dayDiff(currentFrom, currentTo);
  const prevTo = addDays(currentFrom, -1);
  const prevFrom = addDays(prevTo, -(currentDays - 1));
  const hasPrev = prevFrom >= bounds.min;

  const last30To = prevTo;
  const last30From = addDays(last30To, -29);
  const hasLast30 = last30From >= bounds.min && hasPrev;

  const allTimeFrom = bounds.min;
  const allTimeTo = prevTo > bounds.min ? prevTo : bounds.min;

  // drilldown 모드면 모든 totals/campaign agg/키워드 집계를 해당 캠페인 한정으로 좁힌다.
  // 이렇게 해야 LLM 이 "이 캠페인만" 의 시기 비교/손실/기회를 보고 분석한다.
  const cf = opts.scope === "campaign" ? (opts.campaign ?? undefined) : undefined;

  // 병렬로 4 개 기간 + 캠페인별 current + (search/target) 키워드 집계.
  const [
    curAgg,
    prevAgg,
    last30Agg,
    allTimeAgg,
    curCampaigns,
    prevCampaigns,
    allTimeCampaigns,
    searchKws,
    targetKws,
  ] = await Promise.all([
    combinedAgg(tables, currentFrom, currentTo, cf),
    hasPrev ? combinedAgg(tables, prevFrom, prevTo, cf) : Promise.resolve(null),
    hasLast30
      ? combinedAgg(tables, last30From, last30To, cf)
      : Promise.resolve(null),
    combinedAgg(tables, allTimeFrom, allTimeTo, cf),
    // drilldown 모드에서는 campaigns 리스트가 의미 없다 (1 개 캠페인만 보고 있음).
    // brand 모드에서만 가져온다.
    primaryTable && opts.scope === "brand"
      ? execQueryLong<CampaignAggRow>(
          aggByCampaignSql(primaryTable, currentFrom, currentTo),
        )
      : Promise.resolve([] as CampaignAggRow[]),
    primaryTable && opts.scope === "brand" && hasPrev
      ? execQueryLong<CampaignAggRow>(
          aggByCampaignSql(primaryTable, prevFrom, prevTo),
        )
      : Promise.resolve([] as CampaignAggRow[]),
    primaryTable && opts.scope === "brand"
      ? execQueryLong<CampaignAggRow>(
          aggByCampaignSql(primaryTable, allTimeFrom, allTimeTo),
        )
      : Promise.resolve([] as CampaignAggRow[]),
    tables.searchTable
      ? execQueryLong<KeywordAggRow>(
          aggByKeywordSql(
            tables.searchTable,
            "search_term",
            currentFrom,
            currentTo,
            opts.campaign ?? undefined,
          ),
        )
      : Promise.resolve([] as KeywordAggRow[]),
    tables.targetTable
      ? execQueryLong<KeywordAggRow>(
          aggByKeywordSql(
            tables.targetTable,
            "target_value",
            currentFrom,
            currentTo,
            opts.campaign ?? undefined,
            "target_match_type",
          ),
        )
      : Promise.resolve([] as KeywordAggRow[]),
  ]);

  if (!hasPrev) warnings.push("이전 동일 길이 기간 데이터가 부족해 비교를 생략했습니다.");
  if (!hasLast30) warnings.push("최근 30일 평균 비교가 가능한 만큼의 데이터가 없습니다.");

  const current = periodSummaryFromRow(
    curAgg,
    currentFrom,
    currentTo,
    currentDays,
  );
  const prev = prevAgg
    ? periodSummaryFromRow(prevAgg, prevFrom, prevTo, currentDays)
    : null;
  const last30 = last30Agg
    ? periodSummaryFromRow(last30Agg, last30From, last30To, 30)
    : null;
  const allTimeDays = dayDiff(allTimeFrom, allTimeTo);
  const allTime = allTimeAgg
    ? periodSummaryFromRow(allTimeAgg, allTimeFrom, allTimeTo, allTimeDays)
    : null;

  // 캠페인별 변화.
  const prevByCampaign = new Map<string, CampaignAggRow>();
  for (const r of prevCampaigns) prevByCampaign.set(r.campaign_name, r);
  const allTimeByCampaign = new Map<string, CampaignAggRow>();
  for (const r of allTimeCampaigns) allTimeByCampaign.set(r.campaign_name, r);

  const campaigns: CampaignDelta[] = curCampaigns
    .map((r) => {
      const curSum = periodSummaryFromRow(r, currentFrom, currentTo, currentDays);
      const prevRow = prevByCampaign.get(r.campaign_name);
      const prevSum = prevRow
        ? periodSummaryFromRow(prevRow, prevFrom, prevTo, currentDays)
        : null;
      const allRow = allTimeByCampaign.get(r.campaign_name);
      const allSum = allRow
        ? periodSummaryFromRow(allRow, allTimeFrom, allTimeTo, allTimeDays)
        : null;
      const allDailyAvg: PeriodSummary | null = allSum
        ? {
            ...allSum,
            impressions: allSum.impressions / Math.max(1, allTimeDays),
            clicks: allSum.clicks / Math.max(1, allTimeDays),
            cost: allSum.cost / Math.max(1, allTimeDays),
            sales: allSum.sales / Math.max(1, allTimeDays),
          }
        : null;
      const roasChange =
        prevSum && prevSum.roas != null && curSum.roas != null
          ? curSum.roas - prevSum.roas
          : null;
      const costChangePct =
        prevSum && prevSum.cost > 0
          ? (curSum.cost - prevSum.cost) / prevSum.cost
          : null;
      const salesChangePct =
        prevSum && prevSum.sales > 0
          ? (curSum.sales - prevSum.sales) / prevSum.sales
          : null;
      return {
        campaign_name: r.campaign_name,
        current: curSum,
        prev_same_length: prevSum,
        prev_all_time_daily_avg: allDailyAvg,
        roas_change_vs_prev: roasChange,
        cost_change_pct_vs_prev: costChangePct,
        sales_change_pct_vs_prev: salesChangePct,
      };
    })
    // 비용이 큰 캠페인을 먼저 살펴봐야 영향이 크다.
    .sort((a, b) => b.current.cost - a.current.cost);

  // 키워드 후보 만들기 (search + target 통합).
  const keywordPool: KeywordRow[] = [
    ...searchKws.map(
      (r): KeywordRow => ({
        campaign_name: r.campaign_name,
        keyword: r.keyword,
        keyword_type: "search_term",
        impressions: safeNum(r.impressions),
        clicks: safeNum(r.clicks),
        cost: safeNum(r.cost),
        sales: safeNum(r.sales),
        roas: safeNum(r.cost) > 0 ? safeNum(r.sales) / safeNum(r.cost) : null,
      }),
    ),
    ...targetKws.map(
      (r): KeywordRow => ({
        campaign_name: r.campaign_name,
        keyword: r.keyword,
        keyword_type: "target_value",
        match_type: r.match_type ?? null,
        impressions: safeNum(r.impressions),
        clicks: safeNum(r.clicks),
        cost: safeNum(r.cost),
        sales: safeNum(r.sales),
        roas: safeNum(r.cost) > 0 ? safeNum(r.sales) / safeNum(r.cost) : null,
      }),
    ),
  ];

  // drilldown 모드에서는 캠페인 한 개만 보므로 키워드를 더 넉넉히 보여준다.
  const topN =
    opts.scope === "campaign"
      ? Math.max(20, Math.min(opts.topN ?? 60, 150))
      : Math.max(10, Math.min(opts.topN ?? 30, 100));

  // 위험 키워드: 비용이 큰데 ROAS 가 낮음. 일정 cost threshold 미만은 무시.
  const costThreshold = Math.max(
    5,
    keywordPool.reduce((s, k) => s + k.cost, 0) / Math.max(1, keywordPool.length),
  );
  const risk_keywords = [...keywordPool]
    .filter((k) => k.cost >= costThreshold)
    .sort((a, b) => {
      // ROAS 가 null 이면 가장 위험.
      const ra = a.roas == null ? -1 : a.roas;
      const rb = b.roas == null ? -1 : b.roas;
      if (ra !== rb) return ra - rb;
      return b.cost - a.cost;
    })
    .slice(0, topN);

  // 기회 키워드: ROAS 가 평균보다 훨씬 좋은데 노출/클릭이 적음.
  const avgRoas = (() => {
    const filtered = keywordPool.filter((k) => k.roas != null && k.cost >= 1);
    if (!filtered.length) return null;
    const s = filtered.reduce((acc, k) => acc + (k.roas ?? 0), 0);
    return s / filtered.length;
  })();
  const impPctileLow = (() => {
    const imps = keywordPool.map((k) => k.impressions).sort((a, b) => a - b);
    if (!imps.length) return 0;
    return imps[Math.floor(imps.length * 0.6)] ?? 0;
  })();
  const opportunity_keywords = [...keywordPool]
    .filter(
      (k) =>
        k.roas != null &&
        avgRoas != null &&
        k.roas >= Math.max(2, avgRoas * 1.5) &&
        k.impressions <= impPctileLow &&
        k.cost >= 1,
    )
    .sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))
    .slice(0, topN);

  const comparisonMode = opts.comparisonMode ?? "vs_prev";

  // 누적 모드에서는 추가로 월별 시계열을 가져온다 (최근 12 개월, 또는 데이터 있는 만큼).
  // 데이터 소스는 primaryTable. campaign 드릴다운이면 그 캠페인 한정.
  let monthly_trend: MonthlyPoint[] | undefined;
  if (comparisonMode === "vs_alltime" && primaryTable) {
    try {
      const rows = await execQueryLong<{
        month: string;
        impressions: number | string;
        clicks: number | string;
        cost: number | string;
        sales: number | string;
      }>(monthlyTrendSql(primaryTable, currentTo, 12, cf));
      monthly_trend = rows.map((r) => {
        const cost = safeNum(r.cost);
        const sales = safeNum(r.sales);
        return {
          month: r.month,
          impressions: safeNum(r.impressions),
          clicks: safeNum(r.clicks),
          cost,
          sales,
          roas: cost > 0 ? sales / cost : null,
        };
      });
    } catch {
      warnings.push("월별 추세 집계에 실패해 누적 비교의 시계열 부분을 생략했습니다.");
    }
  }

  const snapshot: BrandSnapshot = {
    brand: opts.brand,
    as_of: bounds.max,
    comparison_mode: comparisonMode,
    current,
    prev_same_length: prev,
    prev_30d: last30,
    all_time: allTime,
    monthly_trend,
    campaigns: campaigns.slice(0, Math.max(topN, 40)),
    risk_keywords,
    opportunity_keywords,
    warnings,
  };

  if (opts.scope === "campaign" && opts.campaign) {
    snapshot.drilldown_keywords = keywordPool
      .filter((k) => k.campaign_name === opts.campaign)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 80);
  }

  return snapshot;
}
