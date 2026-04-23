import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const BUCKET = "report-screenshots";
const MAX_BYTES = 10 * 1024 * 1024; // 10MB per file

export async function POST(
  req: Request,
  ctx: { params: Promise<{ brand: string }> },
) {
  const brand = decodeURIComponent((await ctx.params).brand).trim();
  if (!brand) return NextResponse.json({ error: "brand required" }, { status: 400 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `file too large (>${MAX_BYTES / 1024 / 1024}MB)` }, { status: 400 });
  }

  const ext = (file.name.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? ".png").toLowerCase();
  // Store under a `brand_<slug>/` prefix to keep it distinct from per-report uploads.
  const brandSlug = brand.replace(/[^a-zA-Z0-9가-힣_-]+/g, "_");
  const path = `brand_${brandSlug}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${ext}`;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType: file.type || "application/octet-stream",
      cacheControl: "3600",
      upsert: false,
    });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ url: pub.publicUrl, path });
}
