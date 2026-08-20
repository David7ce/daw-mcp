/**
 * Transport handlers: transport_play, transport_stop
 */

import { HandlerContext, ToolResult, successResult, errorResult } from './types.js';

/** Handle transport_play */
export async function handleTransportPlay(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, daw } = ctx;

  try {
    await dawManager.send('transport.play', {}, daw);
    return successResult({ success: true });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle transport_stop */
export async function handleTransportStop(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, daw } = ctx;

  try {
    await dawManager.send('transport.stop', {}, daw);
    return successResult({ success: true });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}
