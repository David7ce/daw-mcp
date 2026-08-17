/**
 * Device selection helpers.
 * Device operations act on the cursor track's device chain. Providing an
 * explicit trackIndex selects that track first, so the chain follows.
 */

import { DAWClientManager, DAWType } from '../daw-client.js';
import { Config } from '../config.js';
import { toInternal } from './indices.js';

/**
 * Select the track if trackIndex was explicitly provided.
 * Omitted means "use whatever track is selected in the DAW's UI" (cursor track).
 */
export async function selectTrackIfNeeded(
  dawManager: DAWClientManager,
  config: Config,
  daw: DAWType | undefined,
  args: Record<string, unknown>
): Promise<void> {
  const trackIndex = args.trackIndex as number | undefined;
  if (trackIndex === undefined) {
    return;
  }

  await dawManager.send('track.select', { index: toInternal(trackIndex) }, daw);
  // Delay to ensure the cursor track (and its device chain) follows the selection
  await new Promise(resolve => setTimeout(resolve, config.mcp.selectionDelayMs));
}
