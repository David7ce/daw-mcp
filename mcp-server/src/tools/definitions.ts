/**
 * MCP Tool definitions (JSON schemas).
 * All tools use unified names (no DAW prefix) with optional daw parameter.
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { Config } from '../config.js';

// Common DAW parameter schema
export const dawParam = {
  daw: {
    type: 'string',
    enum: ['bitwig', 'ableton'],
    description: 'Target DAW (optional - uses default from config if omitted)'
  }
};

/** Generate tool definitions (some depend on config values) */
export function createToolDefinitions(config: Config): Tool[] {
  return [
    // Discovery tool
    {
      name: 'get_daws',
      description: 'Check which DAWs are connected and available. Returns connection status for each DAW and indicates which is the default. IMPORTANT: Call this first to discover available DAWs. When multiple DAWs are connected, you must specify the "daw" parameter in other tool calls to target a specific DAW (e.g., daw: "ableton" or daw: "bitwig"). Without the "daw" parameter, tools will use the default DAW. Each DAW includes grid info: when grid is null, arbitrary note positioning is supported (any float value for x/duration). When grid has a value, note positions snap to the specified stepSize.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      }
    },

    // Project tools
    {
      name: 'get_project_info',
      description: 'Get current project information including BPM, time signature, and playback state',
      inputSchema: {
        type: 'object',
        properties: { ...dawParam },
        required: []
      }
    },
    // Track tools
    {
      name: 'list_tracks',
      description: 'List all tracks in the project with their properties',
      inputSchema: { type: 'object', properties: { ...dawParam }, required: [] }
    },

    // Device tools
    {
      name: 'list_devices',
      description: 'List devices in a track\'s device chain. Works on the track currently selected in DAW\'s UI by default. Provide trackIndex to target a specific track (adds brief selection delay and moves the DAW\'s track selection).',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' }
        },
        required: []
      }
    },
    {
      name: 'select_device',
      description: 'Select a device by its position in the device chain. Moves the cursor device in Bitwig\'s UI, so subsequent get_device_parameters/set_device_parameter act on it. Provide trackIndex to target a specific track (adds brief selection delay).',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' },
          index: { type: 'integer', description: 'Device position in chain, 1-based' }
        },
        required: ['index']
      }
    },
    {
      name: 'get_device_parameters',
      description: 'Read the 8 remote control parameters of the CURRENTLY SELECTED PAGE on the selected device. Devices have multiple pages - use list_parameter_pages and select_parameter_page to reach parameters not on the current page. Returns name, value (0.0-1.0), and displayedValue (human-readable string) for each. Provide trackIndex to select a track first (adds brief selection delay).',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' }
        },
        required: []
      }
    },
    {
      name: 'set_device_parameter',
      description: 'Set one of the 8 generic remote control parameters on the currently selected device (cursor device). Provide trackIndex to select a track first (adds brief selection delay).',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' },
          index: { type: 'integer', description: 'Parameter slot, 0-7' },
          value: { type: 'number', description: 'Value from 0.0 to 1.0' }
        },
        required: ['index', 'value']
      }
    },
    {
      name: 'delete_device',
      description: 'Delete a device from a track\'s device chain by its 1-based position. Works on the track currently selected in DAW\'s UI by default. Provide trackIndex to target a specific track (adds brief selection delay).',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' },
          index: { type: 'integer', description: 'Device position in chain, 1-based' }
        },
        required: ['index']
      }
    },

    {
      name: 'list_parameter_pages',
      description: 'List the remote control pages of the currently selected device. IMPORTANT: get_device_parameters only exposes ONE page of 8 parameters at a time - devices split their controls across several pages (e.g. Polysynth has OSC1, OSC2, MIX, FILTER, AMP, Envelope...). Call this to see what is available, then select_parameter_page to reach the parameters you want.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' }
        },
        required: []
      }
    },
    {
      name: 'select_parameter_page',
      description: 'Switch which remote control page get_device_parameters and set_device_parameter act on. Use list_parameter_pages first to see the available pages and their 1-based indices.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' },
          index: { type: 'integer', description: 'Page number, 1-based' }
        },
        required: ['index']
      }
    },

    // Device loading tools (atomic)
    {
      name: 'load_device',
      description: 'Load a Bitwig device into a track\'s device chain by name. Opens Bitwig\'s browser, picks the best match, and commits - the popup is always closed when this returns. Returns the name actually loaded. Works on the track currently selected in DAW\'s UI by default.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          name: { type: 'string', description: 'Device name to search for, e.g. "Polysynth"' },
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' },
          position: { type: 'integer', description: 'Device chain position to insert at, 1-based (optional - appends to end of chain if omitted)' }
        },
        required: ['name']
      }
    },
    {
      name: 'search_browser',
      description: 'Search what is available in Bitwig\'s browser WITHOUT loading anything. Read-only: always cancels, never inserts into the project. Use to discover device or preset names before calling load_device.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          query: { type: 'string', description: 'Filter result names by this substring (optional)' },
          category: { type: 'string', description: 'Category column filter, e.g. "Synth" (optional)' },
          creator: { type: 'string', description: 'Creator column filter (optional)' },
          limit: { type: 'integer', description: 'Max results to return (default: 50). The response reports `matched` (how many matched your query) and `limited` (whether this cut the list), separately from `truncated` (whether the browser bank could not hold the whole result set).' },
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' }
        },
        required: []
      }
    },

    // Browser session tools (disabled by default - see config)
    {
      name: 'browser_open',
      description: 'Open a Bitwig browser session. Advanced: prefer load_device unless you need precise filter control. Cancels any stale session first. IMPORTANT: the popup is modal in Bitwig - always finish with browser_commit or browser_cancel.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          mode: { type: 'string', enum: ['end', 'position', 'replace'], description: 'end = append to device chain (default), position = insert at a chain slot, replace = open against the cursor device (used for presets)' },
          position: { type: 'integer', description: 'Device chain position, 1-based (required when mode is "position")' },
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' }
        },
        required: []
      }
    },
    {
      name: 'browser_set_content_type',
      description: 'Switch the browser content type. KNOWN LIMITATION: verified non-functional against Bitwig - the call succeeds but the results column does not change. Kept for diagnostics only.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          name: { type: 'string', description: 'Content type name, e.g. "Devices" or "Presets"' }
        },
        required: ['name']
      }
    },
    {
      name: 'browser_set_filter',
      description: 'Select a value in one of the browser\'s filter columns. Omit value to clear that filter (selects the wildcard entry). Requires an open browser session.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          column: { type: 'string', enum: ['category', 'creator', 'tag', 'device', 'deviceType', 'fileType', 'location', 'smartCollection'], description: 'Filter column to set' },
          value: { type: 'string', description: 'Entry name to select (optional - clears the filter if omitted)' }
        },
        required: ['column']
      }
    },
    {
      name: 'browser_get_results',
      description: 'Read the current browser results. Requires an open browser session.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          limit: { type: 'integer', description: 'Max results to return (default: 50)' }
        },
        required: []
      }
    },
    {
      name: 'browser_select',
      description: 'Select a browser result by its 1-based position. Requires an open browser session. Does not load it - call browser_commit to apply.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          index: { type: 'integer', description: 'Result position, 1-based' }
        },
        required: ['index']
      }
    },
    {
      name: 'browser_commit',
      description: 'Commit the browser selection, loading it into the project, and close the popup.',
      inputSchema: { type: 'object', properties: { ...dawParam }, required: [] }
    },
    {
      name: 'browser_cancel',
      description: 'Cancel the browser session without loading anything. Safe to call when no session is open - use this to clear a stuck popup.',
      inputSchema: { type: 'object', properties: { ...dawParam }, required: [] }
    },
    {
      name: 'browser_get_state',
      description: 'Report whether a browser session is open, plus its title, content type, available content types, and result count.',
      inputSchema: { type: 'object', properties: { ...dawParam }, required: [] }
    },

    // MIDI Clip tools
    {
      name: 'transpose_clip',
      description: 'Transpose all notes in a clip by a number of semitones. Works on the clip currently selected in DAW\'s UI by default. Provide trackIndex/slotIndex to target a specific clip (adds brief selection delay).',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' },
          slotIndex: { type: 'integer', description: 'Clip slot number, 1-based (optional - uses DAW UI selection if omitted)' },
          semitones: { type: 'integer', description: 'Number of semitones (positive = up, negative = down)' }
        },
        required: ['semitones']
      }
    },
    {
      name: 'set_clip_length',
      description: 'Set the length of a clip. Works on the clip currently selected in DAW\'s UI by default. Provide trackIndex/slotIndex to target a specific clip (adds brief selection delay).',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' },
          slotIndex: { type: 'integer', description: 'Clip slot number, 1-based (optional - uses DAW UI selection if omitted)' },
          lengthInBeats: { type: 'number', description: 'Clip length in beats' }
        },
        required: ['lengthInBeats']
      }
    },

    // Batch note operations
    {
      name: 'batch_set_notes',
      description: 'Create/modify multiple MIDI notes in one call. Accepts two formats:\n' +
        '- Ultra-lean arrays: [[x, y, velocity, duration], ...] e.g., [[0, 60, 100, 0.5], [4, 64, 80, 0.25]]\n' +
        '- Object format: [{x, y, velocity?, duration?}, ...] for advanced properties\n' +
        'Format is auto-detected. Works on the clip currently selected in DAW\'s UI by default. Provide trackIndex/slotIndex to target a specific clip (adds brief selection delay).',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' },
          slotIndex: { type: 'integer', description: 'Clip slot number, 1-based (optional - uses DAW UI selection if omitted)' },
          notes: {
            type: 'array',
            description: 'Array of notes. Use [x, y, velocity, duration] arrays (lean) or {x, y, velocity?, duration?} objects',
            items: {}
          }
        },
        required: ['notes']
      }
    },
    {
      name: 'batch_move_notes',
      description: 'Move multiple MIDI notes in one call. Works on the clip currently selected in DAW\'s UI by default. Provide trackIndex/slotIndex to target a specific clip (adds brief selection delay).',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' },
          slotIndex: { type: 'integer', description: 'Clip slot number, 1-based (optional - uses DAW UI selection if omitted)' },
          moves: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                x: { type: 'number', description: 'Current beat position (same units as batch_set_notes)' },
                y: { type: 'integer', description: 'Current MIDI note number' },
                dx: { type: 'number', description: 'Beats to move horizontally (positive = right)' },
                dy: { type: 'integer', description: 'Semitones to move vertically (positive = up)' }
              },
              required: ['x', 'y']
            },
            description: 'Array of note moves'
          }
        },
        required: ['moves']
      }
    },
    {
      name: 'batch_clear_notes',
      description: 'Remove MIDI notes from a clip. If notes array omitted or empty, clears ALL notes (replaces clear_all_notes). Works on the clip currently selected in DAW\'s UI by default. Provide trackIndex/slotIndex to target a specific clip (adds brief selection delay).',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' },
          slotIndex: { type: 'integer', description: 'Clip slot number, 1-based (optional - uses DAW UI selection if omitted)' },
          notes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                x: { type: 'number', description: 'Beat position (same units as batch_set_notes)' },
                y: { type: 'integer', description: 'MIDI note number' }
              },
              required: ['x', 'y']
            },
            description: 'Array of notes to clear (optional - clears ALL notes if omitted or empty)'
          }
        },
        required: []
      }
    },
    {
      name: 'batch_set_note_properties',
      description: 'Set properties on multiple notes in one call (velocity, duration, gain, pan, pressure, timbre, transpose, chance, muted). Works on the clip currently selected in DAW\'s UI by default. Provide trackIndex/slotIndex to target a specific clip (adds brief selection delay).',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' },
          slotIndex: { type: 'integer', description: 'Clip slot number, 1-based (optional - uses DAW UI selection if omitted)' },
          notes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                x: { type: 'number', description: 'Beat position (same units as batch_set_notes)' },
                y: { type: 'integer', description: 'MIDI note number' },
                velocity: { type: 'number', description: 'Velocity (0.0 to 1.0)' },
                duration: { type: 'number', description: 'Duration in beats' },
                gain: { type: 'number', description: 'Gain (0.0 to 1.0)' },
                pan: { type: 'number', description: 'Pan (-1.0 to 1.0)' },
                pressure: { type: 'number', description: 'Pressure (0.0 to 1.0)' },
                timbre: { type: 'number', description: 'Timbre (-1.0 to 1.0)' },
                transpose: { type: 'number', description: 'Transpose in semitones' },
                chance: { type: 'number', description: 'Chance (0.0 to 1.0)' },
                muted: { type: 'boolean', description: 'Mute state' }
              },
              required: ['x', 'y']
            },
            description: 'Array of notes with properties to set'
          }
        },
        required: ['notes']
      }
    },

    // Higher-level operations
    {
      name: 'transpose_range',
      description: 'Transpose notes within a step range. Reads notes, filters by range, and moves them. Works on the clip currently selected in DAW\'s UI by default. Provide trackIndex/slotIndex to target a specific clip (adds brief selection delay).',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' },
          slotIndex: { type: 'integer', description: 'Clip slot number, 1-based (optional - uses DAW UI selection if omitted)' },
          startStep: { type: 'integer', description: 'Start step position (inclusive)' },
          endStep: { type: 'integer', description: 'End step position (inclusive)' },
          semitones: { type: 'integer', description: 'Semitones to transpose (positive = up, negative = down)' },
          pitchFilter: { type: 'integer', description: 'Optional: only transpose notes at this MIDI pitch' }
        },
        required: ['startStep', 'endStep', 'semitones']
      }
    },
    // Batch clip operations
    {
      name: 'batch_get_notes',
      description: 'Read notes from one or more clips. If clips array omitted, uses cursor clip. Returns ultra-lean format by default: [[x, y, velocity, duration], ...]. Use verbose=true for full note properties.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          trackIndex: { type: 'integer', description: 'Track number, 1-based (single clip shorthand, optional - uses DAW UI selection if omitted)' },
          slotIndex: { type: 'integer', description: 'Clip slot number, 1-based (single clip shorthand, optional - uses DAW UI selection if omitted)' },
          clips: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                trackIndex: { type: 'integer', description: 'Track number, 1-based' },
                slotIndex: { type: 'integer', description: 'Clip slot number, 1-based' }
              },
              required: ['trackIndex', 'slotIndex']
            },
            description: 'Array of clips to read notes from (optional - uses trackIndex/slotIndex or cursor clip if omitted)'
          },
          verbose: { type: 'boolean', description: 'If true, return full note properties as objects. Default: false (returns lean arrays)' }
        },
        required: []
      }
    },
    {
      name: 'get_clip_stats',
      description: 'Get statistics about a clip without reading all notes. Returns pitch classes, velocity/duration ranges, beat grid, and density. Token-efficient for orientation before detailed analysis. Works on cursor clip by default.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' },
          slotIndex: { type: 'integer', description: 'Clip slot number, 1-based (optional - uses DAW UI selection if omitted)' }
        },
        required: []
      }
    },
    {
      name: 'batch_list_clips',
      description: 'List clips WITH CONTENT from one or more tracks. If trackIndices omitted, uses cursor track. Only returns slots that have clips - empty slots are not listed. To find the first empty slot, use max(slotIndex) + 1.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          trackIndex: { type: 'integer', description: 'Track number, 1-based (single track shorthand, optional - uses DAW UI selection if omitted)' },
          trackIndices: {
            type: 'array',
            items: { type: 'integer' },
            description: 'Array of track numbers, 1-based (optional - uses trackIndex or cursor track if omitted)'
          }
        },
        required: []
      }
    },
    {
      name: 'batch_create_clips',
      description: `Create clips safely with two modes:\n` +
        `- Mode A (no slotIndex): Finds empty slots automatically from cursor position, within actual project scene count (not bank window of ${config.bitwig.scenes})\n` +
        `- Mode B (with slotIndex): Creates at specific slots, fails if occupied unless overwrite=true\n` +
        `Returns created slot positions for subsequent note operations. Uses DAW's UI selection for cursor track if trackIndex omitted.`,
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          clips: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' },
                slotIndex: { type: 'integer', description: 'Slot number, 1-based (optional - finds empty slot within scene count if omitted)' },
                lengthInBeats: { type: 'number', description: 'Clip length in beats (default: 4)' },
                name: { type: 'string', description: 'Clip name (optional)' }
              }
            },
            description: 'Array of clips to create. Omit slotIndex to auto-find empty slots. Optionally set clip name.'
          },
          overwrite: { type: 'boolean', description: 'If true, replace existing clips. Default: false (fail if slot has content)' }
        }
      }
    },
    {
      name: 'batch_delete_clips',
      description: 'Delete multiple clips in one call. If clips array is empty or omitted, deletes clip at DAW\'s UI selection.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          clips: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' },
                slotIndex: { type: 'integer', description: 'Clip slot number, 1-based (optional - uses DAW UI selection if omitted)' }
              }
            },
            description: 'Array of clips to delete. If empty/omitted, deletes at DAW UI selection.'
          }
        }
      }
    },

    // Generative tools
    {
      name: 'batch_create_euclid_pattern',
      description: 'Create Euclidean rhythm patterns across multiple tracks and clips in one call. ' +
        'Reduces round-trips when creating drum patterns across separate tracks. ' +
        'If slotIndex omitted, creates new clips safely. If slotIndex provided, updates existing clip (clears only pitches being patterned).',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          tracks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                trackIndex: { type: 'integer', description: 'Track number, 1-based' },
                clips: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      slotIndex: { type: 'integer', description: 'Clip slot, 1-based (optional - creates new clip if omitted)' },
                      lengthBeats: { type: 'number', description: 'Clip length in beats (default: 4)' },
                      name: { type: 'string', description: 'Clip name (optional, for new clips)' },
                      patterns: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            hits: { type: 'integer', description: 'Number of hits to distribute' },
                            steps: { type: 'integer', description: 'Total steps (16 = 1 bar at 1/16th)' },
                            pitch: { type: 'integer', description: 'MIDI note number' },
                            velocity: { type: 'integer', description: 'Note velocity 0-127 (default: 100)' },
                            rotate: { type: 'integer', description: 'Rotate pattern by N steps (default: 0)' },
                            duration: { type: 'number', description: 'Note duration in beats (default: auto)' }
                          },
                          required: ['hits', 'steps', 'pitch']
                        },
                        description: 'Euclidean patterns for this clip'
                      }
                    },
                    required: ['patterns']
                  },
                  description: 'Clips to create/update on this track'
                }
              },
              required: ['trackIndex', 'clips']
            },
            description: 'Array of tracks with their clips and patterns'
          }
        },
        required: ['tracks']
      }
    },

    // Batch track operations
    {
      name: 'batch_create_tracks',
      description: 'Create multiple tracks in one call. Replaces bitwig_create_track.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          tracks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['instrument', 'audio', 'effect'],
                  description: 'Type of track to create'
                },
                name: { type: 'string', description: 'Optional track name' },
                position: { type: 'integer', description: 'Position to insert, 1-based (-1 for end)' }
              },
              required: ['type']
            },
            description: 'Array of tracks to create'
          }
        },
        required: ['tracks']
      }
    },
    {
      name: 'batch_set_track_properties',
      description: 'Set properties on multiple tracks in one call. Replaces set_track_name, set_track_volume, set_track_mute, set_track_solo.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          tracks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'integer', description: 'Track number, 1-based' },
                name: { type: 'string', description: 'New track name' },
                volume: { type: 'number', description: 'Volume (0.0 to 1.0)' },
                mute: { type: 'boolean', description: 'Mute state' },
                solo: { type: 'boolean', description: 'Solo state' }
              },
              required: ['index']
            },
            description: 'Array of tracks with properties to set'
          }
        },
        required: ['tracks']
      }
    },
    {
      name: 'batch_delete_tracks',
      description: 'Delete multiple tracks in one call. Deletes in reverse order to preserve indices. Replaces bitwig_delete_track.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          trackIndices: {
            type: 'array',
            items: { type: 'integer' },
            description: 'Array of track numbers, 1-based'
          }
        },
        required: ['trackIndices']
      }
    }
  ];
}
