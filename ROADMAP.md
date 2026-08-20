# Roadmap

## Recently shipped (this commit)

Transport and clip-launcher control: `transport_play`, `transport_stop`,
`launch_clip`, `stop_clip`, `launch_scene`, `stop_all_clips`. Implemented
in parallel on both backends (Bitwig `ClipHandler.java`/`TransportHandler.java`,
Ableton `clip.py`/`transport.py`) plus the shared MCP layer
(`mcp-server/src/handlers/clips.ts`, new `transport.ts`).

Verified live against a running Bitwig instance: `launch_clip`, `stop_clip`,
`launch_scene`, `stop_all_clips`, `transport_play`, `transport_stop` all
confirmed working via `batch_list_clips`'s `isPlaying` state. **Ableton's
side of this feature is unverified against a real Ableton instance** — same
caveat as the existing Ableton device-support gap in `TODO.md`.

Also fixed as part of this work: `MCPServer.java`'s `stop()` used to close
only the listening socket, leaving already-accepted client connections
(including the MCP Node process's persistent connection) alive across a
Bitwig extension reload — those stale connections kept talking to the dead
pre-reload extension instance and returned degraded state (e.g. only
"Master" track visible) with no error. Now `stop()` tracks and closes
accepted sockets too, so a client reliably reconnects to the fresh instance
after a reload.

## Near-term

- **Verify Ableton transport/clip-launcher parity live.** `handle_play`,
  `handle_stop`, `handle_launch`, `handle_launchScene`,
  `handle_stopAllClips` in the Ableton extension are implemented by direct
  analogy to the Bitwig side and to existing Ableton handler patterns, but
  have not been run against a real Ableton Live instance. Do this before
  relying on cross-DAW parity claims for these six tools.
- **Verify Ableton device support against a real Live instance** (existing
  `TODO.md` item — the fakes in `tests/test_ableton_device_handler.py`
  check the handler's own logic, not that the real Live API objects behave
  the way the fakes assume).

## Workflow bridge to audio2score-mcp

`audio2score-mcp` (sibling project, `d:\Workspaces\David7ce-user\David7ce-code\cli\audio2score-mcp`)
transcribes audio to MIDI/MusicXML — deliberately a separate repo (Python
+ TensorFlow stack vs this project's Node+Java, and this project's own
scope excludes notation/transcription work by design). The two connect at
the workflow level: `transcribe_audio(song.mp3)` there produces a `.mid`
file, which `batch_set_notes` here can read into a Bitwig/Ableton clip. No
automated bridge exists yet — it's a manual hand-off, or something Claude
does by reading one tool's output and calling the other's input. Worth a
small bridge script only if this happens often enough to be worth it.

## Ideas under consideration

See `docs/ideas/` for deeper write-ups:
- `humanization-matching.md` — extend `detectedGrid` with timing
  distribution stats (mean/stdDev/max/bias) so newly generated notes can
  match an existing clip's humanized feel instead of landing dead-on-grid.

## Explicitly out of scope

Unchanged from `CLAUDE.md`: arrangement view, Reaper support, MIDI/OSC
alternatives to the DAW extension model. See `CLAUDE.md`'s "Scope" section
for the reasoning — this remains a session-view/clip-launcher project by
design, not an oversight to eventually fix.
