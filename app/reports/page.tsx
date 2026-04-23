import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { buildReportSummary, type SummaryColumn, type ReportSummary } from "@/lib/reports/summary";
import ReportCard from "@/components/reports/ReportCard";
import { Upload, FolderOpen } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ReportsListPage() {
  const supabase = getSupabaseAdmin();
  const { data: types, error } = await supabase
    .from("report_types")
    .select("id, slug, display_name, table_name, key_columns, created_at, brand")
    .order("created_at", { ascending: false });

  let enriched: (NonNullable<typeof types>[number] & { summary: ReportSummary | null })[] = [];

  if (types && types.length > 0) {
    const typeIds = types.map((t) => t.id);
    const [{ data: allColumns }, { data: latestUploads }] = await Promise.all([
      supabase
        .from("report_columns")
        .select("report_type_id, column_name, source_header, data_type, is_key, position")
        .in("report_type_id", typeIds)
        .order("position", { ascending: true }),
      supabase
        .from("report_uploads")
        .select("report_type_id, uploaded_at")
        .in("report_type_id", typeIds)
        .order("uploaded_at", { ascending: false }),
    ]);

    const columnsByType = new Map<string, SummaryColumn[]>();
    for (const c of allColumns ?? []) {
      const arr = columnsByType.get(c.report_type_id) ?? [];
      arr.push({
        column_name: c.column_name,
        source_header: c.source_header,
        data_type: c.data_type,
        is_key: c.is_key,
        position: c.position,
      });
      columnsByType.set(c.report_type_id, arr);
    }
    const lastUploadByType = new Map<string, string>();
    for (const u of latestUploads ?? []) {
      if (!lastUploadByType.has(u.report_type_id))
        lastUploadByType.set(u.report_type_id, u.uploaded_at);
    }

    const summaries = await Promise.all(
      types.map((t) =>
        buildReportSummary(
          t.table_name,
          columnsByType.get(t.id) ?? [],
          lastUploadByType.get(t.id) ?? null,
        ).catch(() => null),
      ),
    );

    enriched = types.map((t, i) => ({ ...t, summary: summaries[i] }));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
            레포트
          </h1>
          <p className="text-gray-400 mt-2">브랜드별 레포트 대시보드</p>
        </div>
        <Link
          href="/upload"
          className="inline-flex items-center gap-2 h-10 px-4 rounded-md font-medium text-sm bg-gradient-to-r from-cyan-500 to-purple-500 text-white hover:from-cyan-600 hover:to-purple-600 shadow-lg shadow-cyan-500/50 transition-colors"
        >
          <Upload className="h-4 w-4" /> 업로드
        </Link>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">
          {error.message}
        </div>
      )}

      {!enriched.length ? (
        <div className="p-10 rounded-lg border border-dashed border-purple-500/30 bg-slate-800/40 backdrop-blur-xl text-center text-gray-400">
          아직 레포트가 없습니다.{" "}
          <Link href="/upload" className="text-cyan-300 underline-offset-4 hover:underline">
            파일을 업로드
          </Link>
          해서 시작하세요.
        </div>
      ) : (() => {
        // Group by brand — a brand with 1+ report_types becomes a single card
        // linking to /brands/<brand>; untagged reports render individually.
        const byBrand = new Map<string, typeof enriched>();
        const ungrouped: typeof enriched = [];
        for (const t of enriched) {
          if (t.brand && t.brand.trim()) {
            const key = t.brand.trim();
            const arr = byBrand.get(key) ?? [];
            arr.push(t);
            byBrand.set(key, arr);
          } else {
            ungrouped.push(t);
          }
        }
        const brands = Array.from(byBrand.entries()).sort((a, b) =>
          a[0].localeCompare(b[0]),
        );
        return (
          <div className="space-y-10">
            {brands.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {brands.map(([brand, members]) => {
                  const totalRows = members.reduce(
                    (s, m) => s + (m.summary?.rowCount ?? 0),
                    0,
                  );
                  const lastUp = members
                    .map((m) => m.summary?.lastUploadedAt)
                    .filter((x): x is string => !!x)
                    .sort()
                    .at(-1);
                  return (
                    <Link
                      key={brand}
                      href={`/brands/${encodeURIComponent(brand)}`}
                      className="p-6 rounded-xl border border-purple-500/30 bg-gradient-to-br from-slate-800/60 to-slate-900/60 backdrop-blur-xl shadow-lg shadow-purple-500/10 hover:border-cyan-500/50 hover:shadow-cyan-500/10 transition-all block group"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <FolderOpen
                            className="text-cyan-300 group-hover:text-cyan-200 transition-colors"
                            size={22}
                          />
                          <span className="text-2xl font-bold text-gray-100">{brand}</span>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-200 whitespace-nowrap">
                          {members.length}개 레포트
                        </span>
                      </div>
                      <div className="mt-4 space-y-1 text-xs text-gray-400">
                        {members.map((m) => (
                          <div key={m.slug} className="flex items-center gap-1.5">
                            <span className="text-gray-600">•</span>
                            <span className="truncate text-gray-300">{m.display_name}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 flex items-center gap-3 text-xs text-gray-400 pt-3 border-t border-purple-500/10">
                        <span>
                          합계{" "}
                          <span className="text-cyan-300 font-semibold tabular-nums">
                            {totalRows.toLocaleString()}
                          </span>
                          행
                        </span>
                        {lastUp && (
                          <span className="text-gray-500">
                            · 최근 업로드 {lastUp.slice(0, 10)}
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            {brands.length === 0 && ungrouped.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {ungrouped.map((t) => (
                  <ReportCard key={t.slug} type={t} />
                ))}
              </div>
            )}

            {brands.length > 0 && ungrouped.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-300 list-none select-none">
                  브랜드 태그 없는 레포트 {ungrouped.length}개 ▾
                </summary>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                  {ungrouped.map((t) => (
                    <ReportCard key={t.slug} type={t} />
                  ))}
                </div>
              </details>
            )}
          </div>
        );
      })()}
    </div>
  );
}
