"use client";

import { Fragment, useMemo } from "react";

/**
 * ASIN: starts with "B0" + 8 uppercase alphanumeric chars. The negative
 * look-behind/ahead ensures we don't pick up partial matches from longer
 * runs of alphanumerics — `AB0DDC3QGJLX` shouldn't link, but
 * `_B0DDC3QGJL_` should.
 */
const ASIN_RE = /(?<![A-Z0-9])B0[A-Z0-9]{8}(?![A-Z0-9])/g;

interface Props {
  text: string;
  className?: string;
  linkClassName?: string;
}

/**
 * Renders a string and turns any embedded Amazon ASIN tokens into hyperlinks
 * to `https://www.amazon.com/dp/<ASIN>` that open in a new tab. Click bubbles
 * are stopped so wrappers like `<label>` don't toggle their checkbox when
 * the user clicks the link.
 */
export default function AsinLinkified({
  text,
  className,
  linkClassName,
}: Props) {
  const parts = useMemo(() => splitOnAsins(text), [text]);
  if (parts.length === 1 && typeof parts[0] === "string") {
    return <span className={className}>{text}</span>;
  }
  return (
    <span className={className}>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <Fragment key={i}>{p}</Fragment>
        ) : (
          <a
            key={i}
            href={`https://www.amazon.com/dp/${p.asin}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={
              linkClassName ??
              "text-cyan-300 hover:text-cyan-200 hover:underline underline-offset-2"
            }
            title={`Amazon: ${p.asin}`}
          >
            {p.asin}
          </a>
        ),
      )}
    </span>
  );
}

type Part = string | { asin: string };

function splitOnAsins(text: string): Part[] {
  if (!text) return [""];
  const out: Part[] = [];
  let last = 0;
  // Reset the regex so repeated calls on the same string don't share state.
  ASIN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ASIN_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ asin: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length === 0 ? [text] : out;
}
