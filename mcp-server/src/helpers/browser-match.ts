/**
 * Browser match selection.
 *
 * Picking a result from a browser search must be deterministic rather than
 * a "best guess", so callers can explain what was loaded and why.
 * Implements the rules from the browser/device-loading design spec.
 */

/** A single browser result (index is 0-based internal, as Bitwig returns it) */
export interface BrowserResult {
  index: number;
  name: string;
  isSelected?: boolean;
}

/** Which rule produced the match */
export type MatchRule = 'exact' | 'unique-substring' | 'shortest-substring' | 'none';

export interface MatchOutcome {
  match: BrowserResult | null;
  rule: MatchRule;
  /** Names that were passed over (only populated when the choice was ambiguous) */
  alternatives: string[];
}

/**
 * Select a result for a query, in this order:
 *   1. Case-insensitive exact name match.
 *   2. Exactly one case-insensitive substring match.
 *   3. Several substring matches - the shortest name wins (the
 *      least-decorated match, e.g. "Polysynth" over "Polysynth Bass Kit"),
 *      and the rest are returned as alternatives.
 *   4. No matches.
 */
export function selectBrowserMatch(results: BrowserResult[], query: string): MatchOutcome {
  const needle = query.trim().toLowerCase();

  const exact = results.find(r => r.name.toLowerCase() === needle);
  if (exact) {
    return { match: exact, rule: 'exact', alternatives: [] };
  }

  const substring = results.filter(r => r.name.toLowerCase().includes(needle));

  if (substring.length === 1) {
    return { match: substring[0], rule: 'unique-substring', alternatives: [] };
  }

  if (substring.length > 1) {
    // Shortest name = least decorated match
    const sorted = [...substring].sort((a, b) => a.name.length - b.name.length);
    return {
      match: sorted[0],
      rule: 'shortest-substring',
      alternatives: sorted.slice(1).map(r => r.name)
    };
  }

  return { match: null, rule: 'none', alternatives: [] };
}
