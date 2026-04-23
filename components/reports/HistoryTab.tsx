"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Image as ImageIcon, X, Pencil, Save } from "lucide-react";

interface HistoryEntry {
  id: string;
  report_type_id: string | null;
  brand?: string | null;
  entry_date: string; // YYYY-MM-DD
  note: string;
  screenshots: string[];
  created_at: string;
  updated_at: string;
}

interface Props {
  /** Base URL for the history endpoints — either
   *  `/api/reports/<slug>` or `/api/brands/<brand>`. The component appends
   *  `/history`, `/history/<id>`, `/history/upload` to this. */
  baseUrl: string;
}

export default function HistoryTab({ baseUrl }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`${baseUrl}/history`, { signal: abort.signal })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setEntries(j.entries ?? []);
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "조회 실패");
      })
      .finally(() => setLoading(false));
    return () => abort.abort();
  }, [baseUrl, refreshKey]);

  async function deleteEntry(id: string) {
    if (!window.confirm("이 기록을 삭제할까요?")) return;
    const res = await fetch(`${baseUrl}/history/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`삭제 실패: ${j.error ?? res.status}`);
      return;
    }
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-gray-100">변경 히스토리</h2>
          <p className="text-xs text-gray-500">
            날짜 / 테스트 내용 / 스크린샷으로 변경 기록을 남겨두세요.
          </p>
        </div>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-gradient-to-r from-cyan-500 to-purple-500 text-white text-sm font-medium hover:from-cyan-600 hover:to-purple-600 shadow-lg shadow-cyan-500/30"
          >
            <Plus size={14} /> 새 기록 추가
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">
          {error}
        </div>
      )}

      {showAdd && (
        <EntryForm
          baseUrl={baseUrl}
          onCancel={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {loading && entries.length === 0 ? (
        <div className="flex items-center gap-2 p-6 text-gray-500 text-sm">
          <Loader2 size={14} className="animate-spin text-cyan-400" />
          불러오는 중...
        </div>
      ) : entries.length === 0 && !showAdd ? (
        <div className="p-10 rounded-lg border border-dashed border-purple-500/30 bg-slate-800/40 text-center text-gray-500 text-sm">
          아직 기록이 없습니다.
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((e) =>
            editingId === e.id ? (
              <EntryForm
                key={e.id}
                baseUrl={baseUrl}
                initial={e}
                onCancel={() => setEditingId(null)}
                onSaved={() => {
                  setEditingId(null);
                  setRefreshKey((k) => k + 1);
                }}
              />
            ) : (
              <EntryCard
                key={e.id}
                entry={e}
                onEdit={() => setEditingId(e.id)}
                onDelete={() => deleteEntry(e.id)}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function EntryCard({
  entry,
  onEdit,
  onDelete,
}: {
  entry: HistoryEntry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="p-4 rounded-lg border border-purple-500/20 bg-slate-800/40 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs text-cyan-300 font-mono">{entry.entry_date}</div>
          <p className="mt-1 text-sm text-gray-200 whitespace-pre-wrap">
            {entry.note || <span className="italic text-gray-500">(내용 없음)</span>}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
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
      </div>
      {entry.screenshots && entry.screenshots.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {entry.screenshots.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
              <img
                src={url}
                alt="screenshot"
                className="h-32 w-auto rounded-md border border-purple-500/20 object-cover hover:border-cyan-500/50 transition-colors"
              />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function EntryForm({
  baseUrl,
  initial,
  onCancel,
  onSaved,
}: {
  baseUrl: string;
  initial?: HistoryEntry;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState<string>(
    initial?.entry_date ?? new Date().toISOString().slice(0, 10),
  );
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
        const res = await fetch(`${baseUrl}/history/upload`, {
          method: "POST",
          body: form,
        });
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

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    await uploadFiles(Array.from(files));
  }

  // Paste handler — catches Ctrl+V / Cmd+V with image clipboard content anywhere in the form.
  // Screenshot tools (Win Snipping Tool, macOS ⌘⇧4, etc.) place PNG on clipboard which we upload.
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
    setSaving(true);
    setErr(null);
    const body = {
      entry_date: date,
      note: note.trim(),
      screenshots,
    };
    const url = initial
      ? `${baseUrl}/history/${initial.id}`
      : `${baseUrl}/history`;
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
      <div className="flex items-center gap-3">
        <label className="text-xs text-gray-400">
          날짜{" "}
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="ml-2 rounded-md border border-purple-500/30 bg-slate-900 text-gray-200 px-2 py-1 text-sm focus:border-cyan-500 focus:outline-none [color-scheme:dark]"
          />
        </label>
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="테스트 내용, 변경 사유, 관찰 등..."
        rows={4}
        className="w-full rounded-md border border-purple-500/30 bg-slate-900 text-gray-200 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none"
      />

      <div className="space-y-2">
        <div className="flex items-center gap-2">
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
            또는 <kbd className="px-1 py-0.5 rounded bg-slate-900 border border-purple-500/30 text-gray-300 font-mono text-[10px]">Ctrl</kbd>
            <span className="mx-0.5 text-gray-500">+</span>
            <kbd className="px-1 py-0.5 rounded bg-slate-900 border border-purple-500/30 text-gray-300 font-mono text-[10px]">V</kbd>
            {" "}로 붙여넣기
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
          {initial ? "저장" : "추가"}
        </button>
      </div>
    </div>
  );
}
