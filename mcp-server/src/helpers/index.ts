/**
 * Helper module exports.
 */

export { toInternal, toUser, quantizeForBitwig } from './indices.js';
export {
  resolveClipIndices,
  slotHasContent,
  findEmptySlots,
  selectClipIfNeeded
} from './clip-selection.js';
export { selectTrackIfNeeded } from './device-selection.js';
export { resolveDaw } from './daw-resolution.js';
export { selectBrowserMatch } from './browser-match.js';
// Types need `export type`: a plain re-export emits a runtime binding that does
// not exist, which breaks any consumer loading these as real ES modules.
export type { BrowserResult, MatchRule, MatchOutcome } from './browser-match.js';
