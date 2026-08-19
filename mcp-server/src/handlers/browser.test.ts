import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleBrowserOpen, handleBrowserGetResults, handleBrowserSelect, handleBrowserSetFilter } from './browser.js';
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

test('browser_open defaults to mode "end" and omits position when not given', async () => {
  const { manager, calls } = fakeDawManager({ 'browser.open': {} });
  await handleBrowserOpen(ctxFor(manager, {}));

  assert.deepEqual(calls.find(c => c.method === 'browser.open')!.params, { mode: 'end' });
});

test('browser_open converts an explicit position from 1-based to 0-based', async () => {
  const { manager, calls } = fakeDawManager({ 'browser.open': {} });
  await handleBrowserOpen(ctxFor(manager, { mode: 'position', position: 3 }));

  assert.deepEqual(calls.find(c => c.method === 'browser.open')!.params, { mode: 'position', position: 2 });
});

test('browser_get_results converts indices to 1-based and slices to the requested limit', async () => {
  const { manager } = fakeDawManager({
    'browser.getResults': {
      results: [{ index: 0, name: 'A' }, { index: 1, name: 'B' }, { index: 2, name: 'C' }],
      totalCount: 3,
    },
  });
  const result = await handleBrowserGetResults(ctxFor(manager, { limit: 2 }));
  const parsed = textOf(result);

  assert.equal(parsed.count, 2);
  assert.deepEqual(parsed.results.map((r: { index: number }) => r.index), [1, 2]);
  assert.equal(parsed.totalCount, 3);
});

test('browser_select converts index from 1-based to 0-based', async () => {
  const { manager, calls } = fakeDawManager({ 'browser.select': {} });
  await handleBrowserSelect(ctxFor(manager, { index: 9 }));

  assert.equal(calls.find(c => c.method === 'browser.select')!.params!.index, 8);
});

test('browser_set_filter sends an empty value to clear a filter (the documented wildcard)', async () => {
  const { manager, calls } = fakeDawManager({ 'browser.setFilter': {} });
  await handleBrowserSetFilter(ctxFor(manager, { column: 'category' })); // value omitted

  assert.deepEqual(calls.find(c => c.method === 'browser.setFilter')!.params, { column: 'category', value: '' });
});
