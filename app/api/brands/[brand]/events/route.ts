import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function resolveBrand(raw: string): string {
  return decodeURIComponent(raw).trim();
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isValidColor(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s);
}

/** GET: 이 브랜드에 등록된 이벤트 목록을 시작일 기준 오름차순으로 반환. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ brand: string }> },
) {
  const brand = resolveBrand((await ctx.params).brand);
  if (!brand) {
    return NextResponse.json({ error: "brand required" }, { status: 400 });
  }
  const { data, error } = await getSupabaseAdmin()
    .from("brand_events")
    .select("id, name, color, start_date, end_date")
    .eq("brand", brand)
    .order("start_date", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ events: data ?? [] });
}

/**
 * POST: 새 이벤트 생성. body = { name, color, start_date, end_date }.
 * color 가 빠지면 청록색 기본값을 사용한다.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ brand: string }> },
) {
  const brand = resolveBrand((await ctx.params).brand);
  if (!brand) {
    return NextResponse.json({ error: "brand required" }, { status: 400 });
  }
  let body: {
    name?: string;
    color?: string;
    start_date?: string;
    end_date?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  const startDate = (body.start_date ?? "").trim();
  const endDate = (body.end_date ?? "").trim();
  const color = (body.color ?? "").trim() || "#22d3ee";

  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (!isValidDate(startDate) || !isValidDate(endDate)) {
    return NextResponse.json(
      { error: "start_date/end_date 는 YYYY-MM-DD 형식이어야 합니다" },
      { status: 400 },
    );
  }
  if (endDate < startDate) {
    return NextResponse.json(
      { error: "end_date 는 start_date 이후여야 합니다" },
      { status: 400 },
    );
  }
  if (!isValidColor(color)) {
    return NextResponse.json(
      { error: "color 는 #rrggbb 형식이어야 합니다" },
      { status: 400 },
    );
  }
  if (name.length > 80) {
    return NextResponse.json({ error: "name 은 80자 이하" }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("brand_events")
    .insert({
      brand,
      name,
      color,
      start_date: startDate,
      end_date: endDate,
    })
    .select("id, name, color, start_date, end_date")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ event: data });
}

/** DELETE: ?id=<uuid> 로 단일 이벤트 삭제. */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ brand: string }> },
) {
  const brand = resolveBrand((await ctx.params).brand);
  if (!brand) {
    return NextResponse.json({ error: "brand required" }, { status: 400 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const { error } = await getSupabaseAdmin()
    .from("brand_events")
    .delete()
    .eq("brand", brand)
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
