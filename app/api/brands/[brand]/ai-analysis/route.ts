import { NextResponse } from "next/server";
import { buildBrandSnapshot } from "@/lib/ai/brand-snapshot";
import { buildPrompt } from "@/lib/ai/analysis-prompt";
import { callGemini } from "@/lib/ai/gemini";

export const runtime = "nodejs";
// 큰 브랜드는 집계 + Gemini 호출에 시간이 걸린다. Railway 의 60초 기본을 넘기지
// 않게 마지막 보호선만 늘려둔다.
export const maxDuration = 120;

interface Payload {
  scope?: "brand" | "campaign";
  campaign?: string | null;
  currentFrom?: string | null;
  currentTo?: string | null;
  /** "vs_prev" (기본) = 직전 동일 길이 비교, "vs_alltime" = 누적/시즌성 분석. */
  comparisonMode?: "vs_prev" | "vs_alltime";
}

function resolveBrand(raw: string): string {
  return decodeURIComponent(raw).trim();
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ brand: string }> },
) {
  const brand = resolveBrand((await ctx.params).brand);
  if (!brand) {
    return NextResponse.json({ error: "brand required" }, { status: 400 });
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    body = {};
  }
  const scope = body.scope === "campaign" ? "campaign" : "brand";
  if (scope === "campaign" && !body.campaign?.trim()) {
    return NextResponse.json(
      { error: "scope=campaign 일 때 campaign 이름이 필요합니다" },
      { status: 400 },
    );
  }

  const comparisonMode =
    body.comparisonMode === "vs_alltime" ? "vs_alltime" : "vs_prev";

  let snapshot;
  try {
    snapshot = await buildBrandSnapshot({
      brand,
      scope,
      campaign: body.campaign?.trim() ?? null,
      currentFrom: body.currentFrom ?? null,
      currentTo: body.currentTo ?? null,
      comparisonMode,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "데이터 집계 실패" },
      { status: 500 },
    );
  }

  const prompt = buildPrompt({
    snapshot,
    scope,
    campaign: body.campaign ?? null,
  });

  try {
    const result = await callGemini({
      system: prompt.system,
      user: prompt.user,
      // 분석은 일관성이 중요하니 낮은 temperature.
      temperature: 0.2,
      maxOutputTokens: 8192,
    });
    return NextResponse.json({
      markdown: result.text,
      model: result.model,
      usage: result.usage ?? null,
      snapshotMeta: {
        currentFrom: snapshot.current.from,
        currentTo: snapshot.current.to,
        currentDays: snapshot.current.days,
        warnings: snapshot.warnings,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Gemini 호출 실패" },
      { status: 500 },
    );
  }
}
