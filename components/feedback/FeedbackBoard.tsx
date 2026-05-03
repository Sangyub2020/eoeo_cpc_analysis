"use client";

import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  Plus,
  Trash2,
  Image as ImageIcon,
  X,
  Pencil,
  Save,
  MessageSquare,
  Check,
  ChevronDown,
  Send,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isAdminEmail } from "@/lib/auth/admin";

type Status = "open" | "in_progress" | "done";

interface FeedbackPost {
  id: string;
  nickname: string;
  author_email: string | null;
  note: string;
  screenshots: string[];
  status: Status;
  created_at: string;
  updated_at: string;
}

interface FeedbackComment {
  id: string;
  post_id: string;
  nickname: string;
  author_email: string | null;
  note: string;
  created_at: string;
}

/** Hook: resolve the signed-in user's email so we can hide edit/delete
 *  buttons on posts/comments the current user didn't write. */
function useMyEmail(): string | null {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!cancelled) setEmail(user?.email ?? null);
      } catch {
        // noop
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return email;
}

/**
 * Public feedback board. Author of each post is the signed-in Google user
 * (no nickname input). Edit/delete is restricted to the author. Comments
 * can be left by anyone signed in; only the comment's author can delete.
 */
export default function FeedbackBoard() {
  const myEmail = useMyEmail();
  const [posts, setPosts] = useState<FeedbackPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    fetch("/api/feedback", { signal: abort.signal })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setPosts(j.posts ?? []);
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "로드 실패");
      })
      .finally(() => setLoading(false));
    return () => abort.abort();
  }, [refreshKey]);

  async function deletePost(id: string) {
    if (!window.confirm("이 건의를 삭제할까요?")) return;
    const res = await fetch(`/api/feedback/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`삭제 실패: ${j.error ?? res.status}`);
      return;
    }
    setRefreshKey((k) => k + 1);
  }

  async function setStatus(p: FeedbackPost, next: Status) {
    if (next === p.status) return;
    const res = await fetch(`/api/feedback/${p.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`상태 변경 실패: ${j.error ?? res.status}`);
      return;
    }
    setRefreshKey((k) => k + 1);
  }

  const openCount = posts.filter((p) => p.status === "open").length;
  const inProgressCount = posts.filter((p) => p.status === "in_progress").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-gray-100 inline-flex items-center gap-2">
            <MessageSquare className="text-cyan-300" size={18} />
            건의 · 피드백
          </h2>
          <p className="text-xs text-gray-500">
            고치고 싶은 점, 추가했으면 하는 기능 등을 편하게 남겨주세요.
            {openCount > 0 && (
              <span className="ml-2 text-amber-300">
                접수 {openCount}건 대기중
              </span>
            )}
            {inProgressCount > 0 && (
              <span className="ml-2 text-cyan-300">
                진행중 {inProgressCount}건
              </span>
            )}
          </p>
        </div>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-gradient-to-r from-cyan-500 to-purple-500 text-white text-sm font-medium hover:from-cyan-600 hover:to-purple-600 shadow-lg shadow-cyan-500/30"
          >
            <Plus size={14} /> 새 건의 작성
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">
          {error}
        </div>
      )}

      {showAdd && (
        <PostForm
          onCancel={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {loading && posts.length === 0 ? (
        <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
          <Loader2 size={14} className="animate-spin text-cyan-400" /> 불러오는 중...
        </div>
      ) : posts.length === 0 && !showAdd ? (
        <div className="p-10 rounded-lg border border-dashed border-purple-500/30 bg-slate-800/40 text-center text-sm text-gray-500">
          아직 접수된 건의가 없습니다.
        </div>
      ) : (
        <div className="space-y-2">
          {posts.map((p) =>
            editingId === p.id ? (
              <PostForm
                key={p.id}
                initial={p}
                onCancel={() => setEditingId(null)}
                onSaved={() => {
                  setEditingId(null);
                  setRefreshKey((k) => k + 1);
                }}
              />
            ) : (
              <PostCard
                key={p.id}
                post={p}
                myEmail={myEmail}
                onEdit={() => setEditingId(p.id)}
                onDelete={() => deletePost(p.id)}
                onSetStatus={(next) => setStatus(p, next)}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

const STATUS_STYLES: Record<Status, string> = {
  open: "bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25",
  in_progress: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/25",
  done: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25",
};
const STATUS_LABELS: Record<Status, string> = {
  open: "접수",
  in_progress: "진행중",
  done: "완료",
};

function StatusBadge({
  status,
  canEdit,
  onChange,
}: {
  status: Status;
  canEdit: boolean;
  onChange: (next: Status) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const baseClass =
    "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[10px] font-medium uppercase tracking-wide transition-colors";

  if (!canEdit) {
    return (
      <span className={`${baseClass} ${STATUS_STYLES[status]}`}>
        {status === "done" && <Check size={10} />}
        {STATUS_LABELS[status]}
      </span>
    );
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        title="상태 변경 (관리자)"
        className={`${baseClass} cursor-pointer ${STATUS_STYLES[status]}`}
      >
        {status === "done" && <Check size={10} />}
        {STATUS_LABELS[status]}
        <ChevronDown size={10} className="opacity-70" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 min-w-[110px] rounded-md border border-purple-500/30 bg-slate-800 shadow-lg shadow-slate-950/40 overflow-hidden">
          {(["open", "in_progress", "done"] as Status[]).map((s) => (
            <button
              key={s}
              onClick={() => {
                onChange(s);
                setOpen(false);
              }}
              className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 ${
                s === status ? "text-cyan-300 bg-white/5" : "text-gray-200"
              }`}
            >
              {STATUS_LABELS[s]}
              {s === status && <span className="ml-1 text-[10px]">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PostCard({
  post,
  myEmail,
  onEdit,
  onDelete,
  onSetStatus,
}: {
  post: FeedbackPost;
  myEmail: string | null;
  onEdit: () => void;
  onDelete: () => void;
  onSetStatus: (next: Status) => void;
}) {
  const isDone = post.status === "done";
  const isMine = !!myEmail && post.author_email === myEmail;
  const isAdmin = isAdminEmail(myEmail);

  const [comments, setComments] = useState<FeedbackComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsRefresh, setCommentsRefresh] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    setCommentsLoading(true);
    fetch(`/api/feedback/${post.id}/comments`, { signal: abort.signal })
      .then((r) => r.json())
      .then((j) => setComments(j.comments ?? []))
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
      })
      .finally(() => setCommentsLoading(false));
    return () => abort.abort();
  }, [post.id, commentsRefresh]);

  async function deleteComment(commentId: string) {
    if (!window.confirm("이 댓글을 삭제할까요?")) return;
    const res = await fetch(`/api/feedback/${post.id}/comments/${commentId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`삭제 실패: ${j.error ?? res.status}`);
      return;
    }
    setCommentsRefresh((k) => k + 1);
  }

  const cardBorder =
    post.status === "done"
      ? "border-emerald-500/20 bg-emerald-500/5"
      : post.status === "in_progress"
        ? "border-cyan-500/20 bg-cyan-500/5"
        : "border-purple-500/20 bg-slate-800/40";

  return (
    <div className={`p-4 rounded-lg border space-y-3 ${cardBorder}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-sm font-semibold text-gray-100 truncate max-w-[260px]"
            title={post.author_email ?? post.nickname}
          >
            {post.nickname}
          </span>
          <span className="text-[11px] text-gray-500">{fmtWhen(post.created_at)}</span>
          <StatusBadge
            status={post.status}
            canEdit={isAdmin}
            onChange={onSetStatus}
          />
        </div>
        {isMine && (
          <div className="flex items-center gap-1">
            <button
              onClick={onEdit}
              className="p-1.5 rounded-md text-gray-400 hover:text-cyan-300 hover:bg-white/5"
              title="수정"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded-md text-gray-400 hover:text-rose-300 hover:bg-rose-500/10"
              title="삭제"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>
      <p
        className={`text-sm whitespace-pre-wrap ${
          isDone ? "text-gray-400 line-through decoration-emerald-400/50" : "text-gray-200"
        }`}
      >
        {post.note}
      </p>
      {post.screenshots && post.screenshots.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {post.screenshots.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
              <img
                src={url}
                alt="screenshot"
                className="h-28 w-auto rounded-md border border-purple-500/20 object-cover hover:border-cyan-500/50 transition-colors"
              />
            </a>
          ))}
        </div>
      )}

      {/* Comment thread */}
      <div className="pt-2 border-t border-purple-500/10 space-y-2">
        {commentsLoading && comments.length === 0 ? (
          <div className="text-xs text-gray-500">
            <Loader2 size={10} className="inline animate-spin mr-1 text-cyan-400" />
            댓글 불러오는 중
          </div>
        ) : comments.length === 0 ? (
          <div className="text-xs text-gray-500">아직 댓글이 없습니다.</div>
        ) : (
          <ul className="space-y-1.5">
            {comments.map((c) => {
              const mineComment = !!myEmail && c.author_email === myEmail;
              return (
                <li
                  key={c.id}
                  className="flex items-start gap-2 text-xs group"
                >
                  <span
                    className="text-cyan-300 font-medium shrink-0 truncate max-w-[180px]"
                    title={c.author_email ?? c.nickname}
                  >
                    {c.nickname}
                  </span>
                  <span className="text-gray-500 shrink-0">{fmtWhen(c.created_at)}</span>
                  <span className="text-gray-200 whitespace-pre-wrap flex-1">{c.note}</span>
                  {mineComment && (
                    <button
                      onClick={() => deleteComment(c.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-500 hover:text-rose-300"
                      title="댓글 삭제"
                    >
                      <X size={11} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <CommentForm
          postId={post.id}
          onSaved={() => setCommentsRefresh((k) => k + 1)}
        />
      </div>
    </div>
  );
}

function CommentForm({
  postId,
  onSaved,
}: {
  postId: string;
  onSaved: () => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const text = note.trim();
    if (!text) {
      setErr("댓글 내용을 입력하세요.");
      return;
    }
    setSaving(true);
    setErr(null);
    const res = await fetch(`/api/feedback/${postId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: text }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? `저장 실패 (${res.status})`);
      return;
    }
    setNote("");
    onSaved();
  }

  return (
    <div className="flex items-start gap-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !saving) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="댓글 달기... (Enter 로 등록)"
        className="flex-1 rounded-md border border-purple-500/20 bg-slate-900 text-gray-200 px-2 py-1 text-xs focus:border-cyan-500 focus:outline-none"
      />
      <button
        onClick={submit}
        disabled={saving}
        className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs hover:bg-cyan-500/30 disabled:opacity-50"
        title="등록"
      >
        {saving ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
      </button>
      {err && (
        <span className="ml-2 text-[11px] text-rose-300 self-center">{err}</span>
      )}
    </div>
  );
}

function PostForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial?: FeedbackPost;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState<string>(initial?.note ?? "");
  const [screenshots, setScreenshots] = useState<string[]>(initial?.screenshots ?? []);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setErr(null);
    const uploaded: string[] = [];
    try {
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/feedback/upload", { method: "POST", body: form });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? `upload failed (${res.status})`);
        uploaded.push(j.url);
      }
      setScreenshots((prev) => [...prev, ...uploaded]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "업로드 실패");
    } finally {
      setUploading(false);
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    void uploadFiles(Array.from(files));
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) imageFiles.push(f);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      void uploadFiles(imageFiles);
    }
  }

  async function save() {
    const trimmedNote = note.trim();
    if (!trimmedNote) {
      setErr("내용을 입력하세요.");
      return;
    }
    setSaving(true);
    setErr(null);
    const body = { note: trimmedNote, screenshots };
    const url = initial ? `/api/feedback/${initial.id}` : "/api/feedback";
    const method = initial ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? `저장 실패 (${res.status})`);
      return;
    }
    onSaved();
  }

  function removeScreenshot(url: string) {
    setScreenshots((prev) => prev.filter((u) => u !== url));
  }

  return (
    <div
      onPaste={handlePaste}
      className="p-4 rounded-lg border border-cyan-500/30 bg-slate-800/60 space-y-3"
    >
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="고치고 싶은 부분, 추가할 기능, 버그 등..."
        rows={4}
        className="w-full rounded-md border border-purple-500/30 bg-slate-900 text-gray-200 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none"
      />

      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-purple-500/30 bg-slate-900 text-xs text-gray-300 cursor-pointer hover:border-cyan-500/50">
            <ImageIcon size={14} className="text-cyan-400" />
            스크린샷 추가
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <span className="text-[11px] text-gray-500">
            또는{" "}
            <kbd className="px-1 py-0.5 rounded bg-slate-900 border border-purple-500/30 text-gray-300 font-mono text-[10px]">
              Ctrl
            </kbd>
            <span className="mx-0.5 text-gray-500">+</span>
            <kbd className="px-1 py-0.5 rounded bg-slate-900 border border-purple-500/30 text-gray-300 font-mono text-[10px]">
              V
            </kbd>{" "}
            로 붙여넣기
          </span>
          {uploading && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-400">
              <Loader2 size={12} className="animate-spin text-cyan-400" /> 업로드 중
            </span>
          )}
        </div>

        {screenshots.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {screenshots.map((url) => (
              <div key={url} className="relative group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt=""
                  className="h-24 w-auto rounded-md border border-purple-500/20"
                />
                <button
                  onClick={() => removeScreenshot(url)}
                  className="absolute top-1 right-1 p-1 rounded-full bg-slate-900/80 text-gray-300 opacity-0 group-hover:opacity-100 hover:text-rose-300 transition-opacity"
                  title="제거"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {err && (
        <div className="p-2 rounded border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs">
          {err}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={saving || uploading}
          className="px-3 py-1.5 rounded-md border border-purple-500/30 text-sm text-gray-300 hover:bg-white/5 disabled:opacity-50"
        >
          취소
        </button>
        <button
          onClick={save}
          disabled={saving || uploading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gradient-to-r from-cyan-500 to-purple-500 text-white text-sm font-medium hover:from-cyan-600 hover:to-purple-600 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {initial ? "저장" : "등록"}
        </button>
      </div>
    </div>
  );
}
