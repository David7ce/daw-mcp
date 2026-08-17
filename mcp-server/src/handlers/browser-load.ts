/**
 * Atomic browser handlers: load_device, load_preset, search_browser.
 *
 * Each composes the browser.* primitives into a single call that always
 * ends with the popup closed - committed on success, cancelled otherwise.
 * The popup is modal in Bitwig's UI, so leaking an open session would
 * block the user.
 */

import { HandlerContext, ToolResult, successResult, errorResult } from './types.js';
import { settle } from './browser.js';
import { selectBrowserMatch, BrowserResult, selectTrackIfNeeded, toInternal } from '../helpers/index.js';
import { DAWClientManager, DAWType } from '../daw-client.js';

/** Read the current results column (0-based indices, as Bitwig returns them) */
async function readResults(
  dawManager: DAWClientManager,
  daw: DAWType
): Promise<BrowserResult[]> {
  const result = await dawManager.send('browser.getResults', {}, daw) as {
    results?: BrowserResult[];
  };
  return result.results ?? [];
}

/** Cancel the browser, swallowing errors - this runs on failure paths */
async function cancelQuietly(dawManager: DAWClientManager, daw: DAWType): Promise<void> {
  try {
    await dawManager.send('browser.cancel', {}, daw);
  } catch {
    // Already closed, or the session never opened - nothing to clean up
  }
}

/** Handle load_device */
export async function handleLoadDevice(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, config, daw, args } = ctx;

  const name = args.name as string;
  const position = args.position as number | undefined;
  let committed = false;

  try {
    await selectTrackIfNeeded(dawManager, config, daw, args);

    await dawManager.send('browser.open', {
      mode: position === undefined ? 'end' : 'position',
      ...(position !== undefined && { position: toInternal(position) })
    }, daw);
    await settle(config);

    const results = await readResults(dawManager, daw);
    const outcome = selectBrowserMatch(results, name);

    if (!outcome.match) {
      const available = results.slice(0, 10).map(r => r.name);
      return errorResult(
        `No browser results matching "${name}".` +
        (available.length > 0 ? ` Available: ${available.join(', ')}` : '')
      );
    }

    await dawManager.send('browser.select', { index: outcome.match.index }, daw);
    await settle(config);
    await dawManager.send('browser.commit', {}, daw);
    await settle(config);
    committed = true;

    return successResult({
      success: true,
      loaded: outcome.match.name,
      matchedBy: outcome.rule,
      ...(outcome.alternatives.length > 0 && { alternatives: outcome.alternatives })
    });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  } finally {
    // Invariant: never leave the popup open
    if (!committed) {
      await cancelQuietly(dawManager, daw);
    }
  }
}

/** Handle load_preset */
export async function handleLoadPreset(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, config, daw, args } = ctx;

  const name = args.name as string;
  let committed = false;

  try {
    await selectTrackIfNeeded(dawManager, config, daw, args);

    // "replace" opens the browser against the cursor device, which is how
    // Bitwig exposes that device's presets
    await dawManager.send('browser.open', { mode: 'replace' }, daw);
    await settle(config);

    await dawManager.send('browser.setContentType', { name: 'Presets' }, daw);
    await settle(config);

    const results = await readResults(dawManager, daw);
    const outcome = selectBrowserMatch(results, name);

    if (!outcome.match) {
      const available = results.slice(0, 10).map(r => r.name);
      return errorResult(
        `No preset matching "${name}".` +
        (available.length > 0 ? ` Available: ${available.join(', ')}` : '')
      );
    }

    await dawManager.send('browser.select', { index: outcome.match.index }, daw);
    await settle(config);
    await dawManager.send('browser.commit', {}, daw);
    await settle(config);
    committed = true;

    return successResult({
      success: true,
      preset: outcome.match.name,
      matchedBy: outcome.rule,
      ...(outcome.alternatives.length > 0 && { alternatives: outcome.alternatives })
    });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  } finally {
    if (!committed) {
      await cancelQuietly(dawManager, daw);
    }
  }
}

/**
 * Handle search_browser.
 *
 * Invariant: never commits. This opens a session purely to read what is
 * available, then always cancels - nothing is inserted into the project.
 */
export async function handleSearchBrowser(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, config, daw, args } = ctx;

  const query = args.query as string | undefined;
  const contentType = args.contentType as string | undefined;
  const category = args.category as string | undefined;
  const creator = args.creator as string | undefined;
  const limit = (args.limit as number | undefined) ?? 50;

  try {
    await selectTrackIfNeeded(dawManager, config, daw, args);

    await dawManager.send('browser.open', { mode: 'end' }, daw);
    await settle(config);

    if (contentType !== undefined) {
      await dawManager.send('browser.setContentType', { name: contentType }, daw);
      await settle(config);
    }
    if (category !== undefined) {
      await dawManager.send('browser.setFilter', { column: 'category', value: category }, daw);
      await settle(config);
    }
    if (creator !== undefined) {
      await dawManager.send('browser.setFilter', { column: 'creator', value: creator }, daw);
      await settle(config);
    }

    const results = await readResults(dawManager, daw);

    const filtered = query === undefined
      ? results
      : results.filter(r => r.name.toLowerCase().includes(query.trim().toLowerCase()));

    return successResult({
      results: filtered.slice(0, limit).map(r => r.name),
      count: Math.min(filtered.length, limit),
      totalAvailable: results.length
    });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  } finally {
    // Invariant: search never commits
    await cancelQuietly(dawManager, daw);
  }
}
