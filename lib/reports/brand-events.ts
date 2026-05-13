/** 브랜드 대시보드의 모든 시계열 차트 위에 표시되는 사용자 정의 이벤트 구간.
 *  예: ("BS", 2026-03-03, 2026-03-07) → X축 상에 해당 기간만큼 음영 + 라벨. */
export interface BrandEvent {
  id: string;
  name: string;
  /** #rrggbb */
  color: string;
  /** YYYY-MM-DD */
  start_date: string;
  /** YYYY-MM-DD, start_date 이상 */
  end_date: string;
}

/** ReferenceArea 의 색을 살짝 투명한 배경/테두리 한 쌍으로 풀어준다. */
export function eventColors(hex: string): { fill: string; stroke: string } {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) {
    return { fill: "rgba(34,211,238,0.10)", stroke: "rgba(34,211,238,0.45)" };
  }
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return {
    fill: `rgba(${r},${g},${b},0.10)`,
    stroke: `rgba(${r},${g},${b},0.55)`,
  };
}

/** 차트의 데이터 X 도메인과 겹치지 않는 이벤트는 그리지 않는다.
 *  date 가 들어오기 전(차트 데이터가 아직 로딩 중)에는 이벤트를 전부 반환. */
export function visibleEvents(
  events: BrandEvent[] | undefined,
  domain: { min?: string | null; max?: string | null } | null,
): BrandEvent[] {
  if (!events || events.length === 0) return [];
  if (!domain || !domain.min || !domain.max) return events;
  return events.filter(
    (e) => e.end_date >= domain.min! && e.start_date <= domain.max!,
  );
}
