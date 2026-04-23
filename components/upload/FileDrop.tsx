"use client";

import { useCallback, useRef, useState } from "react";
import { UploadCloud, FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** Receives 1+ files at once. Caller handles queueing. */
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

export default function FileDrop({ onFiles, disabled }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      const list = e.dataTransfer.files;
      if (!list || list.length === 0) return;
      const files = Array.from(list);
      onFiles(files);
    },
    [onFiles, disabled],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className={cn(
        "border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors",
        "border-purple-500/30 bg-slate-800/40 backdrop-blur-xl hover:border-cyan-500/50 text-gray-300",
        dragging && "border-cyan-500 bg-cyan-500/10",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        multiple
        className="hidden"
        onChange={(e) => {
          const list = e.target.files;
          if (list && list.length > 0) onFiles(Array.from(list));
          e.target.value = "";
        }}
      />
      {dragging ? (
        <FileSpreadsheet size={40} className="text-cyan-400" />
      ) : (
        <UploadCloud size={40} className="text-cyan-400" />
      )}
      <div className="text-center">
        <p className="font-medium text-gray-100">파일 드롭 또는 클릭해서 선택</p>
        <p className="text-sm text-gray-500">.csv, .xlsx, .xls · 여러 개 한번에 선택 가능</p>
      </div>
    </div>
  );
}
