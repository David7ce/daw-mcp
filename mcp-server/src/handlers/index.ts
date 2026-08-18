/**
 * Handlers module exports.
 */

// Types
export { HandlerContext, ToolResult, successResult, errorResult, sortNotes } from './types.js';

// Project handlers
export { handleGetDaws, handleGetProjectInfo } from './project.js';

// Track handlers
export { handleListTracks, handleBatchCreateTracks, handleBatchSetTrackProperties, handleBatchDeleteTracks } from './tracks.js';

// Device handlers
export { handleListDevices, handleSelectDevice, handleGetDeviceParameters, handleSetDeviceParameter, handleDeleteDevice, handleListParameterPages, handleSelectParameterPage } from './device.js';

// Browser handlers (session layer)
export { handleBrowserOpen, handleBrowserSetContentType, handleBrowserSetFilter, handleBrowserGetResults, handleBrowserSelect, handleBrowserCommit, handleBrowserCancel, handleBrowserGetState, settle } from './browser.js';

// Browser handlers (atomic layer)
export { handleLoadDevice, handleSearchBrowser } from './browser-load.js';

// Clip handlers
export { handleBatchListClips, handleBatchCreateClips, handleBatchDeleteClips, handleSetClipLength } from './clips.js';

// Note handlers
export { handleBatchGetNotes, handleBatchSetNotes, handleBatchClearNotes, handleBatchMoveNotes, handleBatchSetNoteProperties, handleTransposeClip, handleTransposeRange } from './notes.js';

// Analysis handlers
export { handleGetClipStats, computeClipStats, ClipStats } from './analysis.js';

// Euclidean pattern handler
export { handleBatchCreateEuclidPattern } from './euclid.js';
