import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleListDevices, handleSelectDevice, handleGetDeviceParameters,
  handleSetDeviceParameter, handleDeleteDevice, handleListParameterPages, handleSelectParameterPage,
} from './device.js';
import type { HandlerContext } from './types.js';
import type { DAWClientManager } from '../daw-client.js';
import type { Config } from '../config.js';

function fakeConfig(): Config {
  return {
    defaultDaw: 'bitwig',
    gridResolution: 16,
    bitwig: { port: 8181, cursorClipLengthBeats: 128, scenes: 128 },
    ableton: { port: 8182 },
    mcp: { selectionDelayMs: 0, requestTimeoutMs: 1000 },
    tools: {},
  };
}

function fakeDawManager(responses: Record<string, unknown>) {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const send = async (method: string, params?: Record<string, unknown>) => {
    calls.push({ method, params });
    return responses[method] ?? {};
  };
  return { manager: { send } as unknown as DAWClientManager, calls };
}

function ctxFor(manager: DAWClientManager, args: Record<string, unknown>): HandlerContext {
  return { dawManager: manager, config: fakeConfig(), daw: 'bitwig', args };
}

function textOf(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

// --- list_devices ---

test('list_devices converts device indices to 1-based for the user', async () => {
  const { manager } = fakeDawManager({ 'device.list': { devices: [{ index: 0, name: 'Polysynth' }] } });
  const result = await handleListDevices(ctxFor(manager, {}));
  assert.equal(textOf(result).devices[0].index, 1);
});

test('list_devices selects the track first when trackIndex is given', async () => {
  const { manager, calls } = fakeDawManager({ 'device.list': { devices: [] } });
  await handleListDevices(ctxFor(manager, { trackIndex: 2 }));

  assert.deepEqual(calls[0], { method: 'track.select', params: { index: 1 } });
  assert.equal(calls[1].method, 'device.list');
});

// --- select_device / delete_device: index IS converted ---

test('select_device converts index from 1-based to 0-based', async () => {
  const { manager, calls } = fakeDawManager({ 'device.select': {} });
  await handleSelectDevice(ctxFor(manager, { index: 3 }));

  const call = calls.find(c => c.method === 'device.select');
  assert.equal(call!.params!.index, 2);
});

test('delete_device converts index from 1-based to 0-based', async () => {
  const { manager, calls } = fakeDawManager({ 'device.delete': {} });
  await handleDeleteDevice(ctxFor(manager, { index: 1 }));

  const call = calls.find(c => c.method === 'device.delete');
  assert.equal(call!.params!.index, 0);
});

// --- set_device_parameter: index is a fixed 0-7 slot, NOT converted ---

test('set_device_parameter passes index through unconverted - it is a fixed remote-control slot, not a position', async () => {
  const { manager, calls } = fakeDawManager({ 'device.setParameter': {} });
  await handleSetDeviceParameter(ctxFor(manager, { index: 0, value: 0.5 }));

  const call = calls.find(c => c.method === 'device.setParameter');
  assert.deepEqual(call!.params, { index: 0, value: 0.5 });
});

// --- get_device_parameters ---

test('get_device_parameters defaults to an empty list when the DAW returns none', async () => {
  const { manager } = fakeDawManager({ 'device.getParameters': {} });
  const result = await handleGetDeviceParameters(ctxFor(manager, {}));

  assert.deepEqual(textOf(result), { parameters: [], count: 0 });
});

// --- list_parameter_pages / select_parameter_page ---

test('list_parameter_pages converts page indices and selectedIndex to 1-based', async () => {
  const { manager } = fakeDawManager({
    'device.listParameterPages': { pages: [{ index: 0, name: 'OSC1' }, { index: 3, name: 'FILTER' }], selectedIndex: 3 },
  });
  const result = await handleListParameterPages(ctxFor(manager, {}));
  const parsed = textOf(result);

  assert.deepEqual(parsed.pages.map((p: { index: number }) => p.index), [1, 4]);
  assert.equal(parsed.selectedIndex, 4);
});

test('select_parameter_page converts index from 1-based to 0-based', async () => {
  const { manager, calls } = fakeDawManager({ 'device.selectParameterPage': {} });
  await handleSelectParameterPage(ctxFor(manager, { index: 4 }));

  const call = calls.find(c => c.method === 'device.selectParameterPage');
  assert.equal(call!.params!.index, 3);
});
