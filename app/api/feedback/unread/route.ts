import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Counts feedback posts + comments created strictly after `since`.
 * Used by the nav-bar badge — the client stores `lastSeenAt` in localStorage
 * (set whenever the feedback page is opened) and polls this endpoint for the
 * count of new activity since.
 *
 * When `since` is missing, returns the latest activity timestamp so the
 * client can seed lastSeenAt without showing a badge for historical posts.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const since = url.searchParams.get("since");

  const supabase = getSupabaseAdmin();

  if (!since) {
    // Seed mode: return the most recent activity timestamp across both tables.
    const [posts, comments] = await Promise.all([
      supabase
        .from("feedback_posts")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("feedback_comments")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    if (posts.error) return NextResponse.json({ error: posts.error.message }, { status: 500 });
    if (comments.error) return NextResponse.json({ error: comments.error.message }, { status: 500 });

    const latestPost = posts.data?.[0]?.created_at ?? null;
    const latestComment = comments.data?.[0]?.created_at ?? null;
    let lastActivityAt: string | null = null;
    if (latestPost && latestComment) {
      lastActivityAt = latestPost > latestComment ? latestPost : latestComment;
    } else {
      lastActivityAt = latestPost ?? latestComment ?? null;
    }
    return NextResponse.json({ posts: 0, comments: 0, total: 0, lastActivityAt });
  }

  // Count mode: items strictly after `since`.
  const [postsRes, commentsRes] = await Promise.all([
    supabase
      .from("feedback_posts")
      .select("*", { count: "exact", head: true })
      .gt("created_at", since),
    supabase
      .from("feedback_comments")
      .select("*", { count: "exact", head: true })
      .gt("created_at", since),
  ]);
  if (postsRes.error) return NextResponse.json({ error: postsRes.error.message }, { status: 500 });
  if (commentsRes.error) return NextResponse.json({ error: commentsRes.error.message }, { status: 500 });

  const postsCount = postsRes.count ?? 0;
  const commentsCount = commentsRes.count ?? 0;
  return NextResponse.json({
    posts: postsCount,
    comments: commentsCount,
    total: postsCount + commentsCount,
  });
}
