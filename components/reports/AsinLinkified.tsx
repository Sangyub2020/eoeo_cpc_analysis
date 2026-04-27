"use client";

import { useMemo } from "react";

/**
 * Linkifies an Amazon ASIN at the START of a value cell.
 *
 * Matches (case-insensitively):
 *  - the cell starts with `asin=B0XXXXXXXX` — links just the ASIN part
 *  - the cell starts with `B0XXXXXXXX`     — links the ASIN
 *
 * Leading whitespace / quote chars (`"` `'` `` ` ``) are tolerated. The ASIN
 * portion is `B0` + 8 alphanumerics, NOT followed by another alphanumeric
 * (so `B0XXXXXXXX1` — 11 chars — doesn't match).
 *
 * Anything that doesn't start with one of the two patterns is rendered as
 * plain text — e.g. `SP_Conversion_B0DDC3QGJL_KT_Core` is left alone, since
 * the ASIN is embedded mid-string.
 */
interface Props {
  text: string;
  className?: string;
  linkClassName?: string;
}

interface Match {
  asin: string; // upper-cased canonical form, used for the URL
  start: number; // index in text where the visible ASIN starts
  end: number; // exclusive end index
}

// Allow optional whitespace / quote chars BOTH before and after the optional
// `asin=` prefix, so `asin="B0XXXXXXXX"` also gets linked.
const PREFIX_RE = /^[\s"'`]*(asin=)?[\s"'`]*/i;
const ASIN_AT_START_RE = /^B0[A-Z0-9]{8}(?![A-Z0-9])/i;

function findAsinAtStart(text: string): Match | null {
  if (!text) return null;
  const prefixMatch = text.match(PREFIX_RE);
  const offset = prefixMatch ? prefixMatch[0].length : 0;
  const rest = text.slice(offset);
  const asinMatch = rest.match(ASIN_AT_START_RE);
  if (!asinMatch) return null;
  return {
    asin: asinMatch[0].toUpperCase(),
    start: offset,
    end: offset + asinMatch[0].length,
  };
}

export default function AsinLinkified({
  text,
  className,
  linkClassName,
}: Props) {
  const match = useMemo(() => findAsinAtStart(text), [text]);
  if (!match) {
    return <span className={className}>{text}</span>;
  }
  const before = text.slice(0, match.start);
  const visible = text.slice(match.start, match.end);
  const after = text.slice(match.end);
  return (
    <span className={className}>
      {before}
      <a
        href={`https://www.amazon.com/dp/${match.asin}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={
          linkClassName ??
          "text-cyan-300 hover:text-cyan-200 hover:underline underline-offset-2"
        }
        title={`Amazon: ${match.asin}`}
      >
        {visible}
      </a>
      {after}
    </span>
  );
}
