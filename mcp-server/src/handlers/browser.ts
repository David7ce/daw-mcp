/**
 * Session-layer browser handlers: direct 1:1 access to the Bitwig popup
 * browser primitives.
 *
 * Browser results populate asynchronously, so each step that changes what
 * the browser is showing is followed by a settle delay before the next
 * read. These tools are disabled by default - see DEFAULT_DISABLED_TOOLS.
 */

import { HandlerContext, ToolResult, successResult, errorResult } from './types.js';
import { Config } from '../config.js';
import { toInternal, toUser, selectTrackIfNeeded } from '../helpers/index.js';

/** Wait for Bitwig to settle after a browser state change */
export function settle(config: Config): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, config.mcp.selectionDelayMs));
}

/** Handle browser_open */
export async function handleBrowserOpen(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, config, daw, args } = ctx;

  const mode = (args.mode as string | undefined) ?? 'end';
  const position = args.position as number | undefined;

  try {
    await selectTrackIfNeeded(dawManager, config, daw, args);

    await dawManager.send('browser.open', {
      mode,
      ...(position !== undefined && { position: toInternal(position) })
    }, daw);
    await settle(config);

    return successResult({ success: true });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle browser_set_content_type */
export async function handleBrowserSetContentType(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, config, daw, args } = ctx;

  const name = args.name as string;

  try {
    await dawManager.send('browser.setContentType', { name }, daw);
    await settle(config);
    return successResult({ success: true });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle browser_set_filter */
export async function handleBrowserSetFilter(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, config, daw, args } = ctx;

  const column = args.column as string;
  const value = args.value as string | undefined;

  try {
    await dawManager.send('browser.setFilter', { column, value: value ?? '' }, daw);
    await settle(config);
    return successResult({ success: true });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle browser_get_results */
export async function handleBrowserGetResults(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, daw, args } = ctx;

  const limit = (args.limit as number | undefined) ?? 50;

  try {
    const result = await dawManager.send('browser.getResults', {}, daw) as {
      results?: Array<{ index: number; name: string }>;
      count?: number;
      totalCount?: number;
    };

    const results = (result.results ?? []).slice(0, limit).map(r => ({
      index: toUser(r.index),
      name: r.name
    }));

    return successResult({
      results,
      count: results.length,
      totalCount: result.totalCount ?? results.length
    });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle browser_select */
export async function handleBrowserSelect(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, config, daw, args } = ctx;

  const index = args.index as number;

  try {
    await dawManager.send('browser.select', { index: toInternal(index) }, daw);
    await settle(config);
    return successResult({ success: true });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle browser_commit */
export async function handleBrowserCommit(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, config, daw } = ctx;

  try {
    await dawManager.send('browser.commit', {}, daw);
    await settle(config);
    return successResult({ success: true });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle browser_cancel */
export async function handleBrowserCancel(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, config, daw } = ctx;

  try {
    await dawManager.send('browser.cancel', {}, daw);
    await settle(config);
    return successResult({ success: true });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle browser_get_state */
export async function handleBrowserGetState(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, daw } = ctx;

  try {
    const state = await dawManager.send('browser.getState', {}, daw);
    return successResult(state);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}
