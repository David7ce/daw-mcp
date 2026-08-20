/**
 * Index conversion helpers.
 * User-facing API uses 1-based indexing (Track 1, Slot 1)
 * Internal DAW API uses 0-based indexing (Track 0, Slot 0)
 */

import { getStepSize, Config } from '../config.js';

/** Convert 1-based user index to 0-based internal index */
export function toInternal(index: number): number {
  return index - 1;
}

/** Convert 0-based internal index to 1-based user index */
export function toUser(index: number): number {
  return index + 1;
}

/**
 * Quantize a beat value to the configured grid.
 * Used when sending notes to Bitwig (API limitation).
 */
export function quantizeForBitwig(beats: number, config: Config): number {
  const stepSize = getStepSize(config);
  return Math.round(beats / stepSize) * stepSize;
}

/**
 * Quantize a note duration to the configured grid, same as quantizeForBitwig
 * but never rounds down to 0 - a duration below half a grid step (e.g. from
 * a real-audio transcription) would otherwise quantize to exactly 0, which
 * Bitwig's note-insert API rejects outright ("insertDuration must be > 0.0").
 * Unlike position, a duration of 0 is never meaningful, so the floor is safe.
 */
export function quantizeDurationForBitwig(beats: number, config: Config): number {
  const stepSize = getStepSize(config);
  return Math.max(stepSize, quantizeForBitwig(beats, config));
}
