/**
 * Device handlers: list_devices, select_device, get_device_parameters, set_device_parameter
 */

import { HandlerContext, ToolResult, successResult, errorResult } from './types.js';
import { toInternal, toUser } from '../helpers/index.js';

/** Handle list_devices */
export async function handleListDevices(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, daw } = ctx;

  try {
    const result = await dawManager.send('device.list', {}, daw) as {
      devices?: Array<{ index: number; [key: string]: unknown }>
    };

    const devices = (result.devices ?? []).map(device => ({
      ...device,
      index: toUser(device.index)
    }));

    return successResult({ devices, count: devices.length });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle select_device */
export async function handleSelectDevice(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, daw, args } = ctx;

  const index = args.index as number;
  try {
    await dawManager.send('device.select', { index: toInternal(index) }, daw);
    // Delay to ensure cursor device follows the selection
    await new Promise(resolve => setTimeout(resolve, ctx.config.mcp.selectionDelayMs));
    return successResult({ success: true });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle get_device_parameters */
export async function handleGetDeviceParameters(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, daw } = ctx;

  try {
    const result = await dawManager.send('device.getParameters', {}, daw) as {
      parameters?: Array<{ index: number; name: string; value: number; displayedValue: string }>
    };

    return successResult({ parameters: result.parameters ?? [], count: result.parameters?.length ?? 0 });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle set_device_parameter */
export async function handleSetDeviceParameter(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, daw, args } = ctx;

  const index = args.index as number;
  const value = args.value as number;
  try {
    await dawManager.send('device.setParameter', { index, value }, daw);
    return successResult({ success: true });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}
