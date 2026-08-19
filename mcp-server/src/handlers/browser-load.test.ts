import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleLoadDevice, handleSearchBrowser } from './browser-load.js';
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

/**
 * Queued-response fake: `responses[method]` may be an array, consumed in
 * call order - needed because load_device calls browser.getResults twice
 * (initial read, then a post-select verification read with a different
 * isSelected state).
 */
function fakeDawManager(responses: Record<string, unknown | unknown[]>) {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const callCounts: Record<string, number> = {};
  const send = async (method: string, params?: Record<string, unknown>) => {
    calls.push({ method, params });
    const entry = responses[method];
    if (Array.isArray(entry)) {
      const i = callCounts[method] ?? 0;
      callCounts[method] = i + 1;
      return entry[Math.min(i, entry.length - 1)] ?? {};
    }
    return entry ?? {};
  };
  return { manager: { send } as unknown as DAWClientManager, calls };
}

function ctxFor(manager: DAWClientManager, args: Record<string, unknown>): HandlerContext {
  return { dawManager: manager, config: fakeConfig(), daw: 'bitwig', args };
}

function textOf(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

// --- load_device ---

test('load_device commits an exact match after verifying selection, and never cancels on success', async () => {
  const { manager, calls } = fakeDawManager({
    'browser.getResults': [
      { results: [{ index: 0, name: 'Reverb' }, { index: 1, name: 'Polysynth' }], totalCount: 2 },
      { results: [{ index: 0, name: 'Reverb' }, { index: 1, name: 'Polysynth', isSelected: true }], totalCount: 2 },
    ],
  });
  const result = await handleLoadDevice(ctxFor(manager, { name: 'Polysynth' }));
  const parsed = textOf(result);

  assert.equal(parsed.success, true);
  assert.equal(parsed.loaded, 'Polysynth');
  assert.equal(parsed.matchedBy, 'exact');
  const methods = calls.map(c => c.method);
  assert.deepEqual(methods, ['browser.open', 'browser.getResults', 'browser.select', 'browser.getResults', 'browser.commit']);
  assert.equal(calls.find(c => c.method === 'browser.select')!.params!.index, 1);
});

test('load_device with no match reports scan truncation and cancels the popup', async () => {
  const { manager, calls } = fakeDawManager({
    'browser.getResults': { results: [{ index: 0, name: 'A' }], totalCount: 50 },
  });
  const result = await handleLoadDevice(ctxFor(manager, { name: 'zzzznotathing' }));

  assert.equal(result.isError, true);
  const text = (result.content[0] as { text: string }).text;
  assert.match(text, /Scanned 1 of 50/);
  assert.match(text, /Available: A/);
  assert.ok(calls.some(c => c.method === 'browser.cancel'));
  assert.ok(!calls.some(c => c.method === 'browser.commit'));
});

test('load_device aborts without committing when the post-select verification shows selection did not apply', async () => {
  const { manager, calls } = fakeDawManager({
    'browser.getResults': { results: [{ index: 0, name: 'Polysynth' }], totalCount: 1 }, // isSelected never becomes true
  });
  const result = await handleLoadDevice(ctxFor(manager, { name: 'Polysynth' }));

  assert.equal(result.isError, true);
  assert.match((result.content[0] as { text: string }).text, /Selection did not apply/);
  assert.ok(!calls.some(c => c.method === 'browser.commit'));
  assert.ok(calls.some(c => c.method === 'browser.cancel'));
});

test('load_device translates a lost browser session into a friendly retry hint', async () => {
  const send = async (method: string) => {
    if (method === 'browser.open') {
      throw new Error('No browser session open');
    }
    return {};
  };
  const manager = { send } as unknown as DAWClientManager;

  const result = await handleLoadDevice(ctxFor(manager, { name: 'Polysynth' }));

  assert.equal(result.isError, true);
  assert.match((result.content[0] as { text: string }).text, /browser session closed before this operation finished/);
});

// --- search_browser ---

test('search_browser never commits and always cancels, even on success', async () => {
  const { manager, calls } = fakeDawManager({
    'browser.getResults': { results: [{ index: 0, name: 'Polysynth' }], totalCount: 1 },
  });
  await handleSearchBrowser(ctxFor(manager, { query: 'poly' }));

  assert.ok(!calls.some(c => c.method === 'browser.commit'));
  assert.ok(calls.some(c => c.method === 'browser.cancel'));
});

test('search_browser filters case-insensitively and reports truncated vs. limited separately', async () => {
  const { manager } = fakeDawManager({
    // Results window only holds 2 of a true 100 (truncated); both match "synth" (limited by limit=1)
    'browser.getResults': { results: [{ index: 0, name: 'Polysynth' }, { index: 1, name: 'FM Synth' }], totalCount: 100 },
  });
  const result = await handleSearchBrowser(ctxFor(manager, { query: 'SYNTH', limit: 1 }));
  const parsed = textOf(result);

  assert.equal(parsed.matched, 2);
  assert.equal(parsed.count, 1); // capped by limit
  assert.equal(parsed.truncated, true); // results bank (2) < totalCount (100)
  assert.equal(parsed.limited, true);   // matched (2) > shown (1)
});

test('search_browser only sets category/creator filters when they were actually provided', async () => {
  const { manager, calls } = fakeDawManager({
    'browser.getResults': { results: [], totalCount: 0 },
  });
  await handleSearchBrowser(ctxFor(manager, { category: 'Bass' }));

  const filterCalls = calls.filter(c => c.method === 'browser.setFilter');
  assert.deepEqual(filterCalls.map(c => c.params), [{ column: 'category', value: 'Bass' }]);
});
