import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleBatchListClips, handleBatchCreateClips, handleBatchDeleteClips, handleSetClipLength } from './clips.js';
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
 * Records every dawManager.send call. `responses[method]` may be a single
 * value (returned every time) or an array (consumed in call order, last
 * entry repeats once exhausted) - needed because batch_create_clips can
 * call clip.findEmptySlots twice per clip (before/after auto-scene-creation).
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

function baseCtx(manager: DAWClientManager, args: Record<string, unknown>): HandlerContext {
  return { dawManager: manager, config: fakeConfig(), daw: 'bitwig', args };
}

function textOf(result: Awaited<ReturnType<typeof handleBatchListClips>>) {
  return JSON.parse((result.content[0] as { text: string }).text);
}

// --- batch_list_clips ---

test('batch_list_clips uses explicit trackIndices over cursor', async () => {
  const { manager, calls } = fakeDawManager({
    'clip.list': { clips: [{ slotIndex: 0, name: 'A' }] },
  });
  const result = await handleBatchListClips(baseCtx(manager, { trackIndices: [2, 3] }));
  const parsed = textOf(result);

  assert.equal(parsed.completed, 2);
  assert.deepEqual(parsed.tracks.map((t: { trackIndex: number }) => t.trackIndex), [2, 3]);
  // 1-based -> 0-based conversion for the wire call
  assert.deepEqual(calls.map(c => c.params!.trackIndex), [1, 2]);
  // slotIndex converted back to 1-based for the user
  assert.equal(parsed.tracks[0].clips[0].slotIndex, 1);
});

test('batch_list_clips falls back to the cursor track when nothing is provided', async () => {
  const { manager, calls } = fakeDawManager({
    'clip.getSelection': { trackIndex: 2 }, // 0-based internal
    'clip.list': { clips: [] },
  });
  const result = await handleBatchListClips(baseCtx(manager, {}));
  const parsed = textOf(result);

  assert.equal(parsed.tracks[0].trackIndex, 3); // 1-based
  assert.equal(calls.find(c => c.method === 'clip.list')!.params!.trackIndex, 2);
});

test('batch_list_clips reports a clear error when no track is selected', async () => {
  const { manager } = fakeDawManager({ 'clip.getSelection': { trackIndex: -1 } });
  const result = await handleBatchListClips(baseCtx(manager, {}));

  assert.equal(result.isError, true);
  assert.match((result.content[0] as { text: string }).text, /No track selected/);
});

// --- batch_create_clips: Mode A (auto-find) ---

test('batch_create_clips with no clips array creates one clip at the first empty slot from cursor', async () => {
  const { manager, calls } = fakeDawManager({
    'clip.getSelection': { trackIndex: 0, slotIndex: 0 },
    'clip.getSceneCount': { sceneCount: 8 },
    'clip.findEmptySlots': { emptySlots: [3], found: 1, requested: 1, sceneCount: 8 },
    'clip.create': { success: true },
  });
  const result = await handleBatchCreateClips(baseCtx(manager, {}));
  const parsed = textOf(result);

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.createdClips, [{ trackIndex: 1, slotIndex: 4, lengthInBeats: 4 }]);
  const createCall = calls.find(c => c.method === 'clip.create');
  assert.deepEqual(createCall!.params, { trackIndex: 0, slotIndex: 3, lengthInBeats: 4 });
});

test('batch_create_clips auto-creates scenes when no empty slot exists, then retries', async () => {
  const { manager, calls } = fakeDawManager({
    'clip.getSelection': { trackIndex: 0, slotIndex: 0 },
    'clip.getSceneCount': { sceneCount: 2 },
    'clip.findEmptySlots': [
      { emptySlots: [], found: 0, requested: 1, sceneCount: 2 },       // before
      { emptySlots: [2], found: 1, requested: 1, sceneCount: 3 },      // after scene creation
    ],
    'clip.createScene': { success: true, created: 1, sceneCount: 3 },
    'clip.create': { success: true },
  });
  const result = await handleBatchCreateClips(baseCtx(manager, {}));
  const parsed = textOf(result);

  assert.equal(parsed.success, true);
  assert.equal(parsed.scenesCreated, 1);
  assert.deepEqual(parsed.createdClips[0], { trackIndex: 1, slotIndex: 3, lengthInBeats: 4 });
  assert.equal(calls.filter(c => c.method === 'clip.findEmptySlots').length, 2);
});

test('batch_create_clips reports a clear error when no room exists even after scene creation', async () => {
  const { manager } = fakeDawManager({
    'clip.getSelection': { trackIndex: 0, slotIndex: 0 },
    'clip.getSceneCount': { sceneCount: 2 },
    'clip.findEmptySlots': { emptySlots: [], found: 0, requested: 1, sceneCount: 2 },
    'clip.createScene': { success: false, created: 0, sceneCount: 2 },
  });
  const result = await handleBatchCreateClips(baseCtx(manager, {}));

  assert.equal(result.isError, true);
  assert.match((result.content[0] as { text: string }).text, /No empty slots available/);
});

// --- batch_create_clips: Mode B (explicit target) ---

test('batch_create_clips Mode B refuses to overwrite an occupied slot by default', async () => {
  const { manager, calls } = fakeDawManager({
    'clip.hasContent': { hasContent: true },
  });
  const result = await handleBatchCreateClips(baseCtx(manager, {
    clips: [{ trackIndex: 1, slotIndex: 3, lengthInBeats: 8 }],
  }));
  const parsed = textOf(result);

  assert.equal(parsed.failed, 1);
  assert.match(parsed.errors[0].error, /Use overwrite=true/);
  assert.equal(calls.some(c => c.method === 'clip.create'), false);
});

test('batch_create_clips Mode B deletes the existing clip first when overwrite=true', async () => {
  const { manager, calls } = fakeDawManager({
    'clip.hasContent': { hasContent: true },
    'clip.create': { success: true },
  });
  const result = await handleBatchCreateClips(baseCtx(manager, {
    overwrite: true,
    clips: [{ trackIndex: 1, slotIndex: 3, lengthInBeats: 8 }],
  }));
  const parsed = textOf(result);

  assert.equal(parsed.success, true);
  const methods = calls.map(c => c.method);
  assert.ok(methods.indexOf('clip.delete') < methods.indexOf('clip.create'), 'delete must happen before create');
});

test('batch_create_clips Mode B sets the clip name via select + setName after creation', async () => {
  const { manager, calls } = fakeDawManager({
    'clip.hasContent': { hasContent: false },
    'clip.create': { success: true },
  });
  await handleBatchCreateClips(baseCtx(manager, {
    clips: [{ trackIndex: 1, slotIndex: 1, name: 'Verse' }],
  }));

  const methods = calls.map(c => c.method);
  assert.deepEqual(methods, ['clip.hasContent', 'clip.create', 'clip.select', 'clip.setName']);
  assert.equal(calls.find(c => c.method === 'clip.setName')!.params!.name, 'Verse');
});

test('batch_create_clips advances the cursor slot across multiple Mode-A clips in one call', async () => {
  const { manager, calls } = fakeDawManager({
    'clip.getSelection': { trackIndex: 0, slotIndex: 0 },
    'clip.getSceneCount': { sceneCount: 16 },
    'clip.findEmptySlots': [
      { emptySlots: [0], found: 1, requested: 1, sceneCount: 16 },
      { emptySlots: [1], found: 1, requested: 1, sceneCount: 16 },
    ],
    'clip.create': { success: true },
  });
  const result = await handleBatchCreateClips(baseCtx(manager, {
    clips: [{ lengthInBeats: 4 }, { lengthInBeats: 8 }],
  }));
  const parsed = textOf(result);

  assert.equal(parsed.completed, 2);
  assert.deepEqual(parsed.createdClips.map((c: { slotIndex: number }) => c.slotIndex), [1, 2]);
  const findCalls = calls.filter(c => c.method === 'clip.findEmptySlots');
  assert.equal(findCalls[0].params!.startSlot, 0);
  assert.equal(findCalls[1].params!.startSlot, 1); // advanced past the first clip
});

// --- batch_delete_clips ---

test('batch_delete_clips with no list deletes the cursor clip', async () => {
  const { manager, calls } = fakeDawManager({
    'clip.getSelection': { trackIndex: 2, slotIndex: 5 },
    'clip.delete': { success: true },
  });
  const result = await handleBatchDeleteClips(baseCtx(manager, {}));
  const parsed = textOf(result);

  assert.equal(parsed.completed, 1);
  assert.deepEqual(calls.find(c => c.method === 'clip.delete')!.params, { trackIndex: 2, slotIndex: 5 });
});

test('batch_delete_clips deletes each explicit clip and collects per-item errors', async () => {
  const send = async (method: string, params?: Record<string, unknown>) => {
    if (method === 'clip.delete' && params!.slotIndex === 0) {
      throw new Error('boom');
    }
    return { success: true };
  };
  const manager = { send } as unknown as DAWClientManager;

  const result = await handleBatchDeleteClips(baseCtx(manager, {
    clips: [{ trackIndex: 1, slotIndex: 1 }, { trackIndex: 1, slotIndex: 2 }],
  }));
  const parsed = textOf(result);

  assert.equal(parsed.completed, 1);
  assert.equal(parsed.failed, 1);
  assert.equal(parsed.errors[0].index, 0); // first clip (0-based slot 0) failed
});

// --- set_clip_length ---

test('set_clip_length with explicit indices refuses an empty slot', async () => {
  const { manager } = fakeDawManager({
    'clip.hasContent': { hasContent: false },
  });
  const result = await handleSetClipLength(baseCtx(manager, { trackIndex: 1, slotIndex: 1, lengthInBeats: 8 }));

  assert.equal(result.isError, true);
  assert.match((result.content[0] as { text: string }).text, /No clip at track 1, slot 1/);
});

test('set_clip_length with cursor selection skips the select step entirely', async () => {
  const { manager, calls } = fakeDawManager({
    'clip.getSelection': { trackIndex: 0, slotIndex: 0 },
    'clip.setLength': { success: true },
  });
  const result = await handleSetClipLength(baseCtx(manager, { lengthInBeats: 8 }));

  assert.equal(result.isError, undefined);
  assert.equal(calls.some(c => c.method === 'clip.select'), false);
  assert.equal(calls.find(c => c.method === 'clip.setLength')!.params!.lengthInBeats, 8);
});
