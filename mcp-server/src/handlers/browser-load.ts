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

/**
 * These tools need the browser session to survive several round-trips, so a
 * session that disappears mid-flow is a real failure mode worth naming.
 * The cause is not established - it has been seen when another browser
 * operation's cleanup raced this one - so the message describes what
 * happened rather than asserting why.
 */
function isSessionLost(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('No browser session open');
}

const SESSION_LOST_HINT =
  'The Bitwig browser session closed before this operation finished, so nothing ' +
  'was loaded. Retry; if it repeats, check that no other browser operation is ' +
  'running concurrently.';

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
    if (isSessionLost(error)) {
      return errorResult(SESSION_LOST_HINT);
    }
    return errorResult(error instanceof Error ? error.message : String(error));
  } finally {
    // Invariant: never leave the popup open
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
  const category = args.category as string | undefined;
  const creator = args.creator as string | undefined;
  const limit = (args.limit as number | undefined) ?? 50;

  try {
    await selectTrackIfNeeded(dawManager, config, daw, args);

    await dawManager.send('browser.open', { mode: 'end' }, daw);
    await settle(config);

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

    // Two different kinds of "you are not seeing everything", reported apart so
    // a caller can tell an incomplete read from their own limit:
    //   truncated - the results bank could not hold the whole set (raise
    //               bitwig.browserResults)
    //   limited   - more entries matched than `limit` allowed through
    const shown = filtered.slice(0, limit).map(r => r.name);

    return successResult({
      results: shown,
      count: shown.length,
      matched: filtered.length,
      totalAvailable: totalCount,
      truncated: results.length < totalCount,
      limited: filtered.length > shown.length
    });
  } catch (error) {
    if (isSessionLost(error)) {
      return errorResult(SESSION_LOST_HINT);
    }
    return errorResult(error instanceof Error ? error.message : String(error));
  } finally {
    // Invariant: search never commits
    await cancelQuietly(dawManager, daw);
  }
}
