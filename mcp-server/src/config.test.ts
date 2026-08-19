import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isToolEnabled, getStepSize, Config } from './config.js';

// loadConfig()/getConfigPath() read the user's real config file
// (%APPDATA%\daw-mcp\config.json etc.) - not exercised here to avoid
// touching that path. Only the pure functions are tested.

function fakeConfig(tools: Record<string, boolean> = {}): Config {
  return {
    defaultDaw: 'bitwig',
    gridResolution: 16,
    bitwig: { port: 8181, cursorClipLengthBeats: 128, scenes: 128 },
    ableton: { port: 8182 },
    mcp: { selectionDelayMs: 400, requestTimeoutMs: 10000 },
    tools,
  };
}

test('a tool not mentioned anywhere defaults to enabled', () => {
  assert.equal(isToolEnabled(fakeConfig(), 'batch_get_notes'), true);
});

test('a tool in DEFAULT_DISABLED_TOOLS is disabled unless the config explicitly enables it', () => {
  assert.equal(isToolEnabled(fakeConfig(), 'batch_move_notes'), false);
  assert.equal(isToolEnabled(fakeConfig({ batch_move_notes: true }), 'batch_move_notes'), true);
});

test('explicit config always wins, including explicitly disabling a tool that defaults on', () => {
  assert.equal(isToolEnabled(fakeConfig({ batch_get_notes: false }), 'batch_get_notes'), false);
});

test('getStepSize follows stepSize = 4 / gridResolution', () => {
  assert.equal(getStepSize(fakeConfig()), 0.25); // gridResolution 16 -> 1/16th note
  const config = fakeConfig();
  config.gridResolution = 4;
  assert.equal(getStepSize(config), 1); // 1/4 note
  config.gridResolution = 32;
  assert.equal(getStepSize(config), 0.125); // 1/32nd note
});
