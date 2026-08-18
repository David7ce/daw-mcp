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
import { selectBrowserMatch, BrowserResult, MatchOutcome, selectTrackIfNeeded, toInternal } from '../helpers/index.js';
import { DAWClientManager, DAWType } from '../daw-client.js';

/** The results column plus the true entry count behind that window */
interface ResultsRead {
  results: BrowserResult[];
  totalCount: number;
}

/** Read the current results column (0-based indices, as Bitwig returns them) */
async function readResults(
  dawManager: DAWClientManager,
  daw: DAWType
): Promise<ResultsRead> {
  const result = await dawManager.send('browser.getResults', {}, daw) as {
    results?: BrowserResult[];
    totalCount?: number;
  };
  const results = result.results ?? [];
  return { results, totalCount: result.totalCount ?? results.length };
}

/**
 * Build the "no match" error message. When the results window didn't cover
 * every entry, say so explicitly - otherwise a caller can't tell truncation
 * apart from genuine absence.
 */
function noMatchMessage(prefix: string, results: BrowserResult[], totalCount: number): string {
  const available = results.slice(0, 10).map(r => r.name);
  const truncated = totalCount > results.length;

  return prefix +
    (truncated
      ? ` Scanned ${results.length} of ${totalCount} entries (results truncated - narrow your search with search_browser).`
      : '') +
    (available.length > 0 ? ` Available: ${available.join(', ')}` : '');
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

    const { results, totalCount } = await readResults(dawManager, daw);
    const outcome = selectBrowserMatch(results, name);

    if (!outcome.match) {
      return errorResult(noMatchMessage(`No browser results matching "${name}".`, results, totalCount));
    }

    await dawManager.send('browser.select', { index: outcome.match.index }, daw);
    await settle(config);

    const verify = await readResults(dawManager, daw);
    const verified = verify.results.find(r => r.index === outcome.match!.index);
    if (!verified?.isSelected) {
      return errorResult(
        `Selection did not apply for "${outcome.match.name}" before commit - ` +
        `aborting to avoid loading the wrong device. Try increasing mcp.selectionDelayMs in the config and retry.`
      );
    }

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

    // Bitwig exposes no content type literally called "Presets" - the real
    // names are host- and device-dependent (e.g. "Bitwig Presets",
    // "Plug-in Presets"), so pick them out of what this session reports
    // rather than hardcoding a name that may not exist.
    const state = await dawManager.send('browser.getState', {}, daw) as { contentTypes?: string[] };
    const available = state.contentTypes ?? [];
    const presetTypes = available.filter(t => /preset/i.test(t));

    if (presetTypes.length === 0) {
      return errorResult(
        `This browser session exposes no preset content type. Available: ${available.join(', ') || '(none)'}`
      );
    }

    // Search each preset content type in turn - a name may live under the
    // device's own presets or the plug-in preset library.
    let outcome: MatchOutcome | null = null;
    let results: BrowserResult[] = [];
    let totalCount = 0;

    for (const contentType of presetTypes) {
      await dawManager.send('browser.setContentType', { name: contentType }, daw);
      await settle(config);

      const read = await readResults(dawManager, daw);
      results = read.results;
      totalCount = read.totalCount;

      const candidate = selectBrowserMatch(results, name);
      if (candidate.match) {
        outcome = candidate;
        break;
      }
    }

    if (!outcome || !outcome.match) {
      return errorResult(noMatchMessage(`No preset matching "${name}".`, results, totalCount));
    }

    await dawManager.send('browser.select', { index: outcome.match.index }, daw);
    await settle(config);

    const verify = await readResults(dawManager, daw);
    const verified = verify.results.find(r => r.index === outcome.match!.index);
    if (!verified?.isSelected) {
      return errorResult(
        `Selection did not apply for "${outcome.match.name}" before commit - ` +
        `aborting to avoid loading the wrong preset. Try increasing mcp.selectionDelayMs in the config and retry.`
      );
    }

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

    const { results, totalCount } = await readResults(dawManager, daw);

    const filtered = query === undefined
      ? results
      : results.filter(r => r.name.toLowerCase().includes(query.trim().toLowerCase()));

    return successResult({
      results: filtered.slice(0, limit).map(r => r.name),
      count: Math.min(filtered.length, limit),
      totalAvailable: totalCount,
      truncated: totalCount > results.length
    });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  } finally {
    // Invariant: search never commits
    await cancelQuietly(dawManager, daw);
  }
}
