export type MatchType = "prefix" | "contains" | "regex";

export interface Brand {
  id: string;
  slug: string;
  display_name: string;
}

export interface BrandRule {
  id: string;
  brand_id: string;
  match_type: MatchType;
  pattern: string;
  priority: number;
}

export interface CompiledRule {
  brand_id: string;
  brand_slug: string;
  brand_display_name: string;
  match_type: MatchType;
  pattern: string;
  /** Lowercased pattern — prefix/contains matching is case-insensitive. */
  patternLower: string;
  priority: number;
  /** Pre-compiled regex for "regex" rules; undefined for other types.
   *  Regex rules are compiled with the `i` flag so they're case-insensitive
   *  too, unless the pattern itself already contains `(?-i:...)`. */
  regex?: RegExp;
  /** Pattern length, used as a tie-breaker. */
  length: number;
}

/**
 * Build a matcher from the brand catalog. Sorts rules by priority desc,
 * then by pattern length desc — longer patterns win over looser ones
 * when priorities are equal.
 */
export function compileRules(
  brands: Brand[],
  rules: BrandRule[],
): CompiledRule[] {
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const out: CompiledRule[] = [];
  for (const r of rules) {
    const b = brandById.get(r.brand_id);
    if (!b) continue;
    let regex: RegExp | undefined;
    if (r.match_type === "regex") {
      try {
        // Always case-insensitive by default, matching prefix/contains behavior.
        regex = new RegExp(r.pattern, "i");
      } catch {
        continue; // invalid regex — skip rather than crash matching
      }
    }
    out.push({
      brand_id: r.brand_id,
      brand_slug: b.slug,
      brand_display_name: b.display_name,
      match_type: r.match_type,
      pattern: r.pattern,
      patternLower: r.pattern.toLowerCase(),
      priority: r.priority,
      regex,
      length: r.pattern.length,
    });
  }
  out.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.length - a.length;
  });
  return out;
}

/**
 * Return the first matching brand slug, or null when no rule matches.
 * All match types are case-insensitive: `prefix` and `contains` compare
 * lowercased strings; `regex` is compiled with the `i` flag.
 */
export function matchBrand(
  campaignName: string,
  compiled: CompiledRule[],
): CompiledRule | null {
  if (!campaignName) return null;
  const nameLower = campaignName.toLowerCase();
  for (const r of compiled) {
    if (r.match_type === "prefix") {
      if (nameLower.startsWith(r.patternLower)) return r;
    } else if (r.match_type === "contains") {
      if (nameLower.includes(r.patternLower)) return r;
    } else if (r.match_type === "regex") {
      if (r.regex && r.regex.test(campaignName)) return r;
    }
  }
  return null;
}

/**
 * Suggest a default rule pattern from a campaign name. Strategy: treat the
 * first token delimited by `_`, `-`, or space as the likely brand token.
 * Returns null if the name is too short or has no delimiter.
 */
export function suggestPrefixPattern(campaignName: string): string | null {
  if (!campaignName) return null;
  const m = /^([A-Za-z0-9]+)[_\-\s]/.exec(campaignName);
  if (!m) return null;
  return m[1] + "_";
}
