/**
 * Gemini 에 보낼 system / user 프롬프트를 만든다. 핵심 원칙:
 *
 * 1. 시스템 프롬프트는 페르소나와 출력 형식을 못 박는다 — "어떤 캠페인이
 *    ROAS 가 낮다" 수준의 빈약한 진단이 아니라, 시기 비교 + 구체적 액션을
 *    내놓도록 강제한다.
 * 2. 데이터는 사실(facts)로만 직렬화하고, 해석은 LLM 에게 맡긴다. JSON 을
 *    그대로 던지면 모델이 형식에 끌려가니, 가독성 좋은 표/리스트로 미리
 *    정리해서 토큰을 절약하고 모델이 인용하기 좋게 만든다.
 */

import type {
  BrandSnapshot,
  CampaignDelta,
  KeywordRow,
  MonthlyPoint,
  PeriodSummary,
} from "./brand-snapshot";

const SYSTEM_BRAND = `너는 아마존 Sponsored Products 광고 운영을 10년 이상 해온 시니어 PPC 컨설턴트다.
한 브랜드의 최근 광고 성과 스냅샷을 받아 한국어로 매우 구체적인 진단과 액션 플랜을 작성한다.

엄수해야 할 원칙:
- "ROAS 가 낮다" 같은 일반론은 절대 쓰지 않는다. 어떤 캠페인이 / 어떤 시기 대비 / 얼마나 / 왜 떨어졌는지를 숫자로 짚는다.
- 모든 주장은 입력 데이터에 직접 인용할 수 있는 숫자로 뒷받침한다. 데이터에 없는 사실은 추측하지 않는다.
- 액션은 즉시 실행 가능해야 한다. "비딩 조정"이 아니라 "캠페인 X 의 target_value=Y 에 입찰가를 현재 기준 20–30% 인상" 같은 식으로 적는다.
- 효율 좋은 키워드의 노출이 적으면 "추가/입찰 인상" 후보로, 비용 큰데 매출 없는 키워드는 "네거티브/입찰 인하" 후보로 명확히 구분한다.
- 손익 판단의 기준은 ROAS 와 ACOS 둘 다이며, 매출 절댓값(sales)도 같이 본다. ROAS 가 좋아도 매출이 미미하면 영향이 작다고 밝힌다.
- 입력에 "warnings" 가 있으면 분석 한계로 본문에 짧게 명시한다.

출력 형식 (정확히 이 구조의 한국어 마크다운으로 작성한다):

## 1. 종합 진단
- 한 단락. 현재 기간의 성과를 이전 같은 길이 / 최근 30일 평균 / 전체 평균과 비교해서 ROAS, 매출, 비용 변화의 크기와 방향을 정리한다.
- 가장 큰 변화를 일으킨 1–2 개 캠페인을 이름까지 적시한다.

## 2. 시기 비교 표
| 지표 | 현재 | 직전 동일기간 | Δ | 30일 평균 | 전체 평균 |
| --- | ---:| ---:| ---:| ---:| ---:|
- 비용, 매출, ROAS, ACOS, 노출, CTR, 매출/클릭(전환 대용) 행으로.

## 3. 캠페인별 변화 (Top 5 손실)
- 표가 아니라 캠페인별 한 단락씩. 캠페인 이름, ROAS / 비용 / 매출 변화, 추정 원인, 권장 액션 1개를 한 줄로 적는다.

## 4. 캠페인별 변화 (Top 3 개선)
- 동일 형식.

## 5. 손실 키워드 (즉시 조치)
- 위험 키워드 목록을 작은 표로:
| 캠페인 | 키워드 | 타입 | 비용 | 매출 | ROAS | 권장 조치 |
- "권장 조치" 칸은 네거티브 추가 / 입찰 -X% / 매치타입 좁히기 중 하나 + 이유를 한 줄.

## 6. 기회 키워드 (확장)
- 위와 같은 표:
| 캠페인 | 키워드 | 타입 | 노출 | ROAS | 매출 | 권장 조치 |
- "권장 조치" 칸은 입찰 +X% / 별도 캠페인 분리 / 매치타입 정확형 추가 등 + 이유.

## 7. 이번 주 액션 체크리스트
- 체크박스(- [ ]) 형식의 5–10 개 액션. 각 항목은 캠페인 이름과 구체 수치를 포함한다.

규칙:
- 수치는 USD 와 % 로 적되, 큰 숫자는 천 단위 콤마. 소수점은 ROAS/ACOS 만 둘째자리까지.
- 키워드 이름이 길어도 줄이지 말고 그대로 인용 (네거티브 추가시 정확히 일치해야 함).
- 데이터에 없는 캠페인/키워드 이름은 절대 만들어 내지 않는다.`;

const SYSTEM_CAMPAIGN = `너는 아마존 Sponsored Products 광고 운영을 10년 이상 해온 시니어 PPC 컨설턴트다.
지금부터 받을 데이터는 **한 캠페인** 에 대한 드릴다운 스냅샷이다. 이 캠페인 하나에만 집중해서
키워드 단위까지 내려가는 매우 구체적인 진단과 액션 플랜을 한국어로 작성한다.

엄수해야 할 원칙:
- 다른 캠페인은 절대 언급하지 않는다. 입력에 다른 캠페인이 잠깐 등장해도 무시한다.
- 모든 진단은 이 캠페인의 시기 비교(현재 vs 직전 동일기간 / 30일 평균 / 전체 누적 평균) 수치로 뒷받침한다.
- 각 키워드/타겟에 대한 액션은 즉시 실행 가능한 형태로 적는다: "입찰 -25%", "Negative Exact 로 추가", "Phrase → Exact 로 좁히기", "예산 +30%" 같은 식. 두루뭉술한 "검토하세요" 금지.
- 키워드는 search_term(검색어 리포트의 실제 검색어) 과 target_value(타겟 키워드의 입찰 대상) 둘 다 다룬다.
  search_term 으로 잡힌 것은 네거티브 추가 후보, target_value 로 잡힌 것은 입찰가 조정 후보로 자연스럽게 구분한다.
- 입력에 "warnings" 가 있으면 분석 한계로 본문에 짧게 명시한다.

출력 형식 (정확히 이 구조의 한국어 마크다운으로 작성한다):

## 1. 캠페인 진단
- 캠페인 이름을 첫 줄에 굵게(**) 표시.
- 한 단락. 현재 기간(7일)의 성과를 직전 동일기간 / 최근 30일 평균 / 전체 평균과 비교해 ROAS / 매출 / 비용 / 노출 변화의 크기와 방향을 정리한다.
- 변화의 원인을 키워드 데이터에서 추정해 1–2 줄 추가 (예: "특정 search_term 의 비용 폭증이 ACOS 를 끌어올림").

## 2. 시기 비교 표
| 지표 | 현재 | 직전 동일기간 | Δ | 30일 평균 | 전체 평균 |
| --- | ---:| ---:| ---:| ---:| ---:|
- 비용, 매출, ROAS, ACOS, 노출, 클릭, CTR, 매출/클릭 행으로.

## 3. 손실 키워드 — 즉시 차단/축소
- 표:
| 키워드 | 타입 | 매치 | 비용 | 매출 | ROAS | ACOS | 권장 조치 |
- "권장 조치" 칸은 다음 중 하나 + 근거 한 줄:
  · search_term → "Negative Exact 로 추가" / "Negative Phrase 로 추가"
  · target_value → "입찰 -X%" / "Phrase → Exact 로 좁히기" / "일시 정지"
- ROAS 가 1.0 미만이면 우선 후보. cost 가 클수록 위에.

## 4. 기회 키워드 — 확장/입찰 인상
- 표:
| 키워드 | 타입 | 노출 | 클릭 | 매출 | ROAS | 권장 조치 |
- "권장 조치":
  · search_term → "별도 Exact 키워드로 캠페인에 추가, 초기 입찰 $X" (X 는 현재 평균 CPC 기준 추정)
  · target_value → "입찰 +X%" / "별도 캠페인으로 분리해서 예산 확대"
- ROAS 가 현재 캠페인 평균의 1.5 배 이상이고 노출/클릭이 적은 항목을 우선.

## 5. 매치타입/구조 권고
- 현재 캠페인의 매치타입 분포(target_match_type 값들)와 효율을 짧게 평가.
- Phrase / Broad 에서 효율 떨어지는 부분이 Exact 로 옮길 가치가 있는지 의견.
- 이 캠페인의 캠페인명에서 추정되는 의도(예: KT=Keyword Target, PAT=Product Attribute Target, AUDT=Audience)와 실제 데이터가 맞아 떨어지는지 1줄.

## 6. 이번 주 액션 체크리스트
- 체크박스(- [ ]) 형식 6–10 개. 각 항목은 캠페인 이름, 키워드, 구체 수치를 모두 포함한다.
- 예: "- [ ] 캠페인 X 의 target_value=\\"abc\\" 입찰 +25% (현재 ROAS 4.2, 노출 11)"

규칙:
- 수치는 USD 와 % 로 적되, 큰 숫자는 천 단위 콤마. ROAS/ACOS 는 둘째자리.
- 키워드 이름은 잘라쓰지 말고 그대로. 네거티브로 추가할 때 정확히 일치해야 한다.
- 데이터에 없는 키워드는 절대 만들어 내지 않는다.
- "다른 캠페인은 어떻다" 같은 비교를 넣지 않는다. 오직 이 캠페인 하나.`;

const SYSTEM_BRAND_ALLTIME = `너는 아마존 Sponsored Products 광고 운영을 10년 이상 해온 시니어 PPC 컨설턴트다.
한 브랜드의 광고 성과 스냅샷을 받아 한국어로 매우 구체적인 진단과 액션 플랜을 작성한다.
이 분석은 **누적 데이터 / 장기 추세** 모드다 — 직전 한 주가 아니라, 브랜드의 전체 운영 역사에 비춘
현재 성과 평가가 핵심이다.

엄수해야 할 원칙:
- 비교의 기준은 "전체 누적 평균(일평균)" 과 "월별 추이의 패턴" 이다. 단기(W/W) 변화는 보조 신호로만 다룬다.
- 현재 ROAS / CTR / 매출/클릭 등을 "전체 평균" 및 "월별 평균 분포의 어느 자리" 인지로 평가한다 (예: "역대 일평균 ROAS 2.24 대비 1.46 으로 35% 낮은 수준 — 최근 3 개월 추세선의 바닥 근접").
- 월별 추이(monthly_trend)에서 **반복되는 패턴 / 시즌성 / 구조적 하락점**을 찾아낸다. 단순히 "최근 떨어졌다" 가 아니라 "11월부터 ROAS 가 단계적으로 내려와 현재 누적 평균을 크게 하회".
- 누적 평균에서 멀리 떨어진 캠페인 / 키워드는 "정상화 후보" 로 분류한다. 누적 평균보다 좋은 항목은 "전 기간 강자 → 비중 확대" 로 분류한다.
- 모든 액션은 즉시 실행 가능해야 한다. "비딩 조정" 이 아니라 "캠페인 X 의 target_value=Y 입찰가를 현재 기준 25% 인하" 처럼.

출력 형식 (정확히 이 구조의 한국어 마크다운으로 작성한다):

## 1. 장기 진단
- 한 단락. 현재 성과가 전체 누적 평균(일평균) 대비 어디에 위치하는지 (상위/평균/하위) + 월별 추이 패턴 요약.
- 가장 큰 시즌성 또는 구조적 변화를 1–2 가지 짚는다.

## 2. 누적 vs 현재 비교 표
| 지표 | 현재 (일평균 환산) | 전체 평균 (일평균) | Δ vs 평균 | 최근 30일 평균 (일평균) |
| --- | ---:| ---:| ---:| ---:|
- 비용, 매출, ROAS, ACOS, 노출, CTR, 매출/클릭 행으로. 현재는 7일이라도 "/일평균" 으로 환산해서 평균과 같은 척도로 비교.

## 3. 월별 추이 분석
- 표:
| 월 | 비용 | 매출 | ROAS | 누적 평균 대비 |
| --- | ---:| ---:| ---:| ---:|
- 12 개월 (또는 데이터 있는 만큼). "누적 평균 대비" 는 그 달 ROAS / 전체평균 ROAS × 100% 의 비율을 적는다.
- 표 아래에 패턴 해석 한 단락 — 시즌성/추세선/이상치/회복 신호 등.

## 4. 누적 강자 캠페인 (Top 3)
- 캠페인별 한 단락. 전체 누적에서 일관되게 ROAS 가 높았던 캠페인을 짚고 "비중 확대" 액션 1 개.

## 5. 정상화 후보 캠페인 (Top 5)
- 캠페인별 한 단락. 누적 평균 대비 현재가 크게 낮은 캠페인. ROAS / 비용 / 매출 변화 + 원인 추정 + 즉시 액션 1 개.

## 6. 손실 키워드 (즉시 조치)
- 표:
| 캠페인 | 키워드 | 타입 | 비용 | 매출 | ROAS | 권장 조치 |
- 누적 평균 ROAS 보다 현저히 낮은 키워드 위주. "권장 조치" 는 네거티브 추가 / 입찰 -X% / 매치 좁히기 중 하나.

## 7. 기회 키워드 (확장)
- 표:
| 캠페인 | 키워드 | 타입 | 노출 | ROAS | 매출 | 권장 조치 |
- 누적 평균 대비 ROAS 1.5 배 이상 + 노출 적은 항목.

## 8. 액션 체크리스트
- 체크박스(- [ ]) 형식의 6–10 개 액션. 캠페인 이름과 구체 수치 포함.

규칙:
- 수치는 USD 와 % 로 적되, 큰 숫자는 천 단위 콤마. ROAS/ACOS 는 둘째자리.
- 데이터에 없는 캠페인/키워드 이름은 절대 만들어 내지 않는다.
- 단기(W/W) 비교는 보조로만. 핵심은 "전체 평균과의 거리 + 월별 추이" 이다.`;

const SYSTEM_CAMPAIGN_ALLTIME = `너는 아마존 Sponsored Products 광고 운영을 10년 이상 해온 시니어 PPC 컨설턴트다.
한 캠페인의 누적 / 장기 추이 스냅샷을 받아 한국어로 매우 구체적인 진단과 액션 플랜을 작성한다.

엄수해야 할 원칙:
- 다른 캠페인은 절대 언급하지 않는다.
- 비교의 기준은 이 캠페인의 "전체 누적 평균(일평균)" + "월별 추이". 단기(W/W) 는 보조.
- 월별 추이에서 시즌성 / 구조적 변화 / 이상치를 찾아낸다.
- 모든 액션은 즉시 실행 가능 — 입찰 ±X%, Negative Exact 추가, 매치 변경, 예산 조정 등 구체 수치 포함.

출력 형식 (한국어 마크다운):

## 1. 캠페인 장기 진단
- 캠페인 이름을 굵게(**) 표시.
- 현재 성과가 이 캠페인의 전체 누적 평균(일평균) 대비 어디에 위치하는지 + 월별 추이 패턴.

## 2. 누적 vs 현재 비교 표
| 지표 | 현재 (일평균) | 전체 평균 (일평균) | Δ vs 평균 | 최근 30일 (일평균) |
| --- | ---:| ---:| ---:| ---:|
- 비용, 매출, ROAS, ACOS, 노출, 클릭, CTR, 매출/클릭.

## 3. 월별 추이
| 월 | 비용 | 매출 | ROAS | 누적 평균 대비 |
| --- | ---:| ---:| ---:| ---:|
- 표 아래 패턴 해석 한 단락.

## 4. 손실 키워드 — 즉시 차단/축소
| 키워드 | 타입 | 매치 | 비용 | 매출 | ROAS | 권장 조치 |
- "권장 조치" 는 search_term=Negative Exact/Phrase 추가, target_value=입찰 ±X% / 매치 좁히기 중 하나.

## 5. 기회 키워드 — 확장/입찰 인상
| 키워드 | 타입 | 노출 | 클릭 | 매출 | ROAS | 권장 조치 |
- ROAS 가 캠페인 평균의 1.5 배 이상이고 노출/클릭이 적은 항목.

## 6. 매치타입/구조 권고
- 매치타입 분포 + 누적 효율로 구조적 권고 (예: Phrase → Exact 이전).

## 7. 액션 체크리스트
- 체크박스(- [ ]) 6–10 개. 키워드/수치 모두 포함.

규칙:
- USD/% 표기, ROAS/ACOS 둘째자리, 큰 숫자 천 단위 콤마.
- 다른 캠페인 언급 금지. 데이터에 없는 키워드 생성 금지.`;

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return "$" + Math.round(n).toLocaleString();
  return "$" + n.toFixed(2);
}
function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString();
}
function fmtPct(n: number | null | undefined, frac = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return (n * 100).toFixed(frac) + "%";
}
function fmtRoas(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function periodLine(label: string, p: PeriodSummary | null): string {
  if (!p) return `- ${label}: 데이터 없음`;
  return `- ${label} (${p.from}~${p.to}, ${p.days}일): 비용 ${fmtMoney(p.cost)}, 매출 ${fmtMoney(p.sales)}, ROAS ${fmtRoas(p.roas)}, ACOS ${fmtPct(p.acos)}, 노출 ${fmtInt(p.impressions)}, 클릭 ${fmtInt(p.clicks)}, CTR ${fmtPct(p.ctr, 2)}, 매출/클릭 ${fmtMoney(p.cvr_proxy)}`;
}

function campaignLine(c: CampaignDelta): string {
  const d = c.current;
  const prev = c.prev_same_length;
  const roasDelta = c.roas_change_vs_prev;
  const costDelta = c.cost_change_pct_vs_prev;
  const salesDelta = c.sales_change_pct_vs_prev;
  const parts: string[] = [];
  parts.push(`- "${c.campaign_name}"`);
  parts.push(
    `  · 현재: 비용 ${fmtMoney(d.cost)}, 매출 ${fmtMoney(d.sales)}, ROAS ${fmtRoas(d.roas)}, ACOS ${fmtPct(d.acos)}, 노출 ${fmtInt(d.impressions)}, 클릭 ${fmtInt(d.clicks)}`,
  );
  if (prev) {
    parts.push(
      `  · 직전 동일기간: 비용 ${fmtMoney(prev.cost)}, 매출 ${fmtMoney(prev.sales)}, ROAS ${fmtRoas(prev.roas)}`,
    );
    parts.push(
      `  · Δ: ROAS ${roasDelta == null ? "—" : (roasDelta >= 0 ? "+" : "") + roasDelta.toFixed(2)}, 비용 ${fmtPct(costDelta)}, 매출 ${fmtPct(salesDelta)}`,
    );
  }
  if (c.prev_all_time_daily_avg) {
    const a = c.prev_all_time_daily_avg;
    parts.push(
      `  · 전체기간 일평균: 비용 ${fmtMoney(a.cost)}, 매출 ${fmtMoney(a.sales)}, ROAS ${fmtRoas(a.roas)}`,
    );
  }
  return parts.join("\n");
}

function monthlyTrendTable(rows: MonthlyPoint[] | undefined): string {
  if (!rows || rows.length === 0) return "(월별 추이 데이터 없음)";
  const header = `| 월 | 노출 | 클릭 | 비용 | 매출 | ROAS |
| --- | ---:| ---:| ---:| ---:| ---:|`;
  const body = rows
    .map(
      (m) =>
        `| ${m.month} | ${fmtInt(m.impressions)} | ${fmtInt(m.clicks)} | ${fmtMoney(m.cost)} | ${fmtMoney(m.sales)} | ${fmtRoas(m.roas)} |`,
    )
    .join("\n");
  return `${header}\n${body}`;
}

function keywordTable(rows: KeywordRow[]): string {
  if (!rows.length) return "(해당 없음)";
  const header = `| 캠페인 | 키워드 | 타입 | 노출 | 클릭 | 비용 | 매출 | ROAS |
| --- | --- | --- | ---:| ---:| ---:| ---:| ---:|`;
  const body = rows
    .map(
      (k) =>
        `| ${k.campaign_name} | ${k.keyword.replace(/\|/g, "/")} | ${k.keyword_type === "search_term" ? "검색어" : "타겟"}${k.match_type ? `(${k.match_type})` : ""} | ${fmtInt(k.impressions)} | ${fmtInt(k.clicks)} | ${fmtMoney(k.cost)} | ${fmtMoney(k.sales)} | ${fmtRoas(k.roas)} |`,
    )
    .join("\n");
  return `${header}\n${body}`;
}

export interface PromptInput {
  snapshot: BrandSnapshot;
  scope: "brand" | "campaign";
  campaign?: string | null;
}

export interface BuiltPrompt {
  system: string;
  user: string;
}

export function buildPrompt({ snapshot, scope, campaign }: PromptInput): BuiltPrompt {
  const s = snapshot;
  const isAlltime = s.comparison_mode === "vs_alltime";
  if (scope === "campaign" && campaign) {
    return isAlltime
      ? buildCampaignAlltimePrompt(s, campaign)
      : buildCampaignPrompt(s, campaign);
  }
  return isAlltime ? buildBrandAlltimePrompt(s) : buildBrandPrompt(s);
}

function buildBrandPrompt(s: BrandSnapshot): BuiltPrompt {
  const lines: string[] = [];

  lines.push(`# 브랜드 광고 성과 스냅샷 (직전 동기간 비교 모드)`);
  lines.push(`- 브랜드: **${s.brand}**`);
  lines.push(`- 데이터 최신 일자: ${s.as_of}`);
  lines.push(`- 분석 범위: 브랜드 전체`);
  if (s.warnings.length) {
    lines.push(`- 분석 한계: ${s.warnings.join("; ")}`);
  }

  lines.push(`\n## 시기별 합계`);
  lines.push(periodLine("현재 기간", s.current));
  lines.push(periodLine("직전 동일 길이", s.prev_same_length));
  lines.push(periodLine("최근 30일 (현재 직전)", s.prev_30d));
  lines.push(periodLine("전체 누적 (현재 직전까지)", s.all_time));

  lines.push(`\n## 캠페인별 현재 + 변화 (비용 큰 순, 최대 ${s.campaigns.length}개)`);
  for (const c of s.campaigns) {
    lines.push(campaignLine(c));
  }

  lines.push(`\n## 손실 위험 키워드 (현재 기간, 비용 ≥ 평균)`);
  lines.push(keywordTable(s.risk_keywords));

  lines.push(`\n## 기회 키워드 (ROAS 높음 + 노출 적음)`);
  lines.push(keywordTable(s.opportunity_keywords));

  lines.push(`\n---\n위 데이터만 근거로, 시스템 프롬프트가 명시한 출력 구조에 정확히 맞춰 한국어 분석을 작성하라.`);

  return { system: SYSTEM_BRAND, user: lines.join("\n") };
}

function buildCampaignPrompt(s: BrandSnapshot, campaign: string): BuiltPrompt {
  const lines: string[] = [];

  lines.push(`# 캠페인 드릴다운 스냅샷 (직전 동기간 비교 모드)`);
  lines.push(`- 브랜드: **${s.brand}**`);
  lines.push(`- 캠페인: **${campaign}**`);
  lines.push(`- 데이터 최신 일자: ${s.as_of}`);
  if (s.warnings.length) {
    lines.push(`- 분석 한계: ${s.warnings.join("; ")}`);
  }

  lines.push(`\n## 이 캠페인의 시기별 합계 (캠페인 한정)`);
  lines.push(periodLine("현재 기간", s.current));
  lines.push(periodLine("직전 동일 길이", s.prev_same_length));
  lines.push(periodLine("최근 30일 (현재 직전)", s.prev_30d));
  lines.push(periodLine("전체 누적 (현재 직전까지)", s.all_time));

  lines.push(`\n## 이 캠페인의 손실 위험 키워드 (비용 ≥ 캠페인 평균)`);
  lines.push(keywordTable(s.risk_keywords));

  lines.push(`\n## 이 캠페인의 기회 키워드 (ROAS 높음 + 노출 적음)`);
  lines.push(keywordTable(s.opportunity_keywords));

  if (s.drilldown_keywords && s.drilldown_keywords.length) {
    lines.push(
      `\n## 이 캠페인의 키워드 전체 (비용 큰 순, 최대 ${s.drilldown_keywords.length}개)`,
    );
    lines.push(keywordTable(s.drilldown_keywords));
  }

  lines.push(
    `\n---\n오로지 이 캠페인 "${campaign}" 하나에만 집중해서, 시스템 프롬프트의 출력 구조를 그대로 따라 분석을 작성하라. 다른 캠페인은 절대 언급하지 않는다.`,
  );

  return { system: SYSTEM_CAMPAIGN, user: lines.join("\n") };
}

function buildBrandAlltimePrompt(s: BrandSnapshot): BuiltPrompt {
  const lines: string[] = [];

  lines.push(`# 브랜드 광고 성과 스냅샷 (누적 데이터 / 장기 추세 모드)`);
  lines.push(`- 브랜드: **${s.brand}**`);
  lines.push(`- 데이터 최신 일자: ${s.as_of}`);
  lines.push(`- 분석 범위: 브랜드 전체`);
  if (s.warnings.length) {
    lines.push(`- 분석 한계: ${s.warnings.join("; ")}`);
  }

  lines.push(`\n## 시기별 합계 (참고: 핵심은 "전체 평균 vs 현재")`);
  lines.push(periodLine("현재 기간", s.current));
  lines.push(periodLine("직전 동일 길이 (보조)", s.prev_same_length));
  lines.push(periodLine("최근 30일", s.prev_30d));
  lines.push(periodLine("전체 누적 (현재 직전까지) — 비교 기준", s.all_time));

  lines.push(`\n## 월별 추이 (최근 12 개월 또는 데이터 있는 만큼)`);
  lines.push(monthlyTrendTable(s.monthly_trend));

  lines.push(`\n## 캠페인별 현재 + 누적 일평균 (비용 큰 순)`);
  for (const c of s.campaigns) {
    lines.push(campaignLine(c));
  }

  lines.push(`\n## 손실 위험 키워드`);
  lines.push(keywordTable(s.risk_keywords));

  lines.push(`\n## 기회 키워드`);
  lines.push(keywordTable(s.opportunity_keywords));

  lines.push(`\n---\n위 데이터를 근거로, "누적 평균 대비 현재의 위치" 와 "월별 패턴" 이 분석의 핵심이라는 것을 잊지 말고, 시스템 프롬프트의 출력 구조에 정확히 맞춰 작성하라.`);

  return { system: SYSTEM_BRAND_ALLTIME, user: lines.join("\n") };
}

function buildCampaignAlltimePrompt(s: BrandSnapshot, campaign: string): BuiltPrompt {
  const lines: string[] = [];

  lines.push(`# 캠페인 드릴다운 스냅샷 (누적 데이터 / 장기 추세 모드)`);
  lines.push(`- 브랜드: **${s.brand}**`);
  lines.push(`- 캠페인: **${campaign}**`);
  lines.push(`- 데이터 최신 일자: ${s.as_of}`);
  if (s.warnings.length) {
    lines.push(`- 분석 한계: ${s.warnings.join("; ")}`);
  }

  lines.push(`\n## 이 캠페인의 시기별 합계 (참고: 핵심은 "전체 평균 vs 현재")`);
  lines.push(periodLine("현재 기간", s.current));
  lines.push(periodLine("직전 동일 길이 (보조)", s.prev_same_length));
  lines.push(periodLine("최근 30일", s.prev_30d));
  lines.push(periodLine("전체 누적 (현재 직전까지) — 비교 기준", s.all_time));

  lines.push(`\n## 이 캠페인의 월별 추이`);
  lines.push(monthlyTrendTable(s.monthly_trend));

  lines.push(`\n## 이 캠페인의 손실 위험 키워드`);
  lines.push(keywordTable(s.risk_keywords));

  lines.push(`\n## 이 캠페인의 기회 키워드`);
  lines.push(keywordTable(s.opportunity_keywords));

  if (s.drilldown_keywords && s.drilldown_keywords.length) {
    lines.push(
      `\n## 이 캠페인의 키워드 전체 (비용 큰 순, 최대 ${s.drilldown_keywords.length}개)`,
    );
    lines.push(keywordTable(s.drilldown_keywords));
  }

  lines.push(
    `\n---\n오로지 이 캠페인 "${campaign}" 하나에만 집중하고, "누적 평균 대비 현재 위치" 와 "월별 추이" 가 분석의 핵심임을 잊지 마라.`,
  );

  return { system: SYSTEM_CAMPAIGN_ALLTIME, user: lines.join("\n") };
}
