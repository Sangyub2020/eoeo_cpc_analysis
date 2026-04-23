import type { FilterState } from "./filter";

export type ChartKind = "bar" | "line" | "area" | "pie";
export type AggFn = "sum" | "avg" | "min" | "max" | "count";
export type Axis = "left" | "right";

export interface ChartConfig {
  kind: ChartKind;
  xCol: string;
  yCols: { col: string; fn: AggFn; axis: Axis }[];
  groupCol: string;
}

export interface ViewConfig {
  tab: "chart" | "table" | "history";
  chart: ChartConfig;
  filter: FilterState;
  table?: {
    visibleCols?: string[];
  };
}

export interface ReportView {
  id: string;
  report_type_id: string;
  name: string;
  config: ViewConfig;
  position: number;
  created_at: string;
  updated_at: string;
}
