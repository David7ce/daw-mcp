# Music Composition Guide

How to actually write good music through the `daw` MCP tools, not just how
to call them correctly. `PROTOCOL.md` documents the wire format and
`CLAUDE.md` documents tool mechanics and API constraints - neither covers
the compositional layer: what to search for, what to write, in what order,
and how to tell whether it worked. This doc is that layer, grounded only in
things verified live against a running Bitwig instance (two full songs, two
genres, two projects) - not aspirational.

## Workflow: read, write, verify

**Read before writing anything.** Call `get_daws`, `list_tracks`, and
`batch_list_clips` first. Never assume a project is empty or that a slot is
free - use `batch_create_clips` in explicit mode (with `slotIndex`) so a
collision fails loudly, or omit `slotIndex` to auto-find an empty one.

**Learn the drum kit's pitch mapping before writing drum notes - don't
assume it.** GM convention (36=kick, 38=snare, 42=closed hihat, 46=open
hihat) held for both kits used so far ("Acoustic Drums Kit Loose
Processed" and "Acoustic Drums Kit 1 Processed" - see the instrument
catalog below), but that's two data points, not a guarantee. If a beat
already exists on the kit's track, `batch_get_notes` it and read the
pitches back before writing new material - a wrong guess here is silent
and produces wrong-sounding output with no error.

**If existing clips are already in the project, read their register and
phrasing before adding new ones.** A prior bass clip's note range, rhythmic
density, and articulation style (root notes, passing tones, chord voicing
shape) tells you what "fits" this project - matching it keeps new material
from sounding bolted-on.

**Notes are always beats, never steps** (`x`, `dx` in every note tool). The
server quantizes for Bitwig internally; write musical time, not grid
indices.

**Verify harmony after writing it, don't just trust what you typed.** Call
`get_clip_stats` and read its `analysis.chords` (Tonal.js chord detection
run against your actual written notes) and `analysis.suggestedKey`. This
catches transposition mistakes, wrong-octave errors, and typos in a note
array that "look right" but aren't. A two-note power chord (root+fifth,
no third) correctly reads back as chord type `"fifth"`, not major/minor -
that's Tonal.js being right, not a detection failure, since a dyad is
harmonically ambiguous by design.

## Instrument catalog (confirmed live via `search_browser`/`load_device`)

**Important scoping caveat, discovered this session**: `search_browser`'s
result set depends on what's *already loaded* in the target track's device
chain, not just what exists in Bitwig's whole content library (this is the
same "browse results are scoped by insertion context" behavior CLAUDE.md
documents for the load_device/search_browser session model, observed here
concretely). An **empty** instrument track's search returned `totalAvailable:
2284`; the exact same query against a track that already had an instrument
loaded returned `totalAvailable: 993` - a different, narrower scope
(audio-effects-oriented). **To browse for a new instrument, target an empty
instrument track** (or a fresh one via `batch_create_tracks`), not one that
already has something loaded.

### Confirmed loadable by exact name (real library instruments, not presets)

These loaded successfully via `load_device` with `matchedBy: "exact"` -
verified, not guessed:

| Category | Names found via `search_browser` |
|----------|-----------------------------------|
| Drums | `Acoustic Drums Kit 1/2/3/4 Clean`, `Acoustic Drums Kit 1/2/3/4 Processed`, `Acoustic Drums Kit DW 1/2 Clean/Processed`, `Acoustic Drums Kit Brushed Clean/Processed`, `Acoustic Drums Kit Loose Processed`, `Acoustic Drums Kicks And Toms Ludwig`, `Acoustic Drums Kicks DW`, `Acoustic Drums Hat 12-Inch/14-Inch K Custom`, `Acoustic Drums Crashes A Custom`, `Drum Machine` (empty shell, needs samples loaded separately - not a quick win) |
| Bass | `Electric Bass - Fingered`, `Electric Bass - Fingered Phat`, `Electric Bass - Fingered Distorted 1`, `Electric Bass - Fingered Distorted 2`, `Bass Guitar` |
| Guitar | `Metal Guitar`, `Dirty Guitar`, `Destroyed Guitar`, `Jazz Guitar`, `Guitar Solo 1`, `Guitar Solo 2`, `Muted Guitar 1`, `Physical-Guitar`, `Seven String Electric Guitar Clean/Droneverb/Gliss/w Amp 1/w Amp 2/w Amp 3`, `FM Guitar`, `Guitarino`, `Soft Guitar Pluck`, `Fairy Guitar` |
| Base synth (always available, shape via parameters) | `Polysynth` - see below |

**Not yet found**: a Rhodes/electric-piano device name, or an "Acoustic
Bass" device name. An earlier project had tracks named "Rusty Rhodes" and
"Acoustic Bass" with working instruments already loaded, but those are
user-assigned *track names* - `search_browser` for "Rhodes" and "Electric
Piano" from an instrument-loaded track context returned zero results (that
search may have been scope-limited per the caveat above; it was not
re-tried from an empty track). Don't assume those exact strings are real
loadable device names - they weren't independently confirmed.

### Found in search results but NOT confirmed loadable - treat as presets, not devices

Names like `2020 Lead`, `Apple Lead`, `FM Lead 1`, `FM Lead 2`, etc.
appeared in a `search_browser` query for "lead" but were never actually
loaded. Per CLAUDE.md's documented Bitwig API limitation
(`PopupBrowser.selectedContentTypeIndex().set(int)` is inert - presets are
unreachable via the popup browser's content-type switch), curated
preset-style names are a real risk of silent failure or an unexpected
match. **The reliable pattern used throughout both songs**: load the base
device (`Polysynth`), then shape it into the target sound via
`set_device_parameter` - never trust an untested preset name for something
that matters.

### Polysynth parameter shaping (confirmed via `set_device_parameter`)

9 remote-control pages: `OSC1`, `OSC2`, `MIX`, `FILTER`, `FILTER/EG`,
`AMP`, `Envelope`, `Common`, `Vibrato`. On the `FILTER` page (index 4):

| Slot | Name | Effect of raising it |
|------|------|------------------------|
| 0 | Filt Freq | Brighter, more cutting - useful for turning a default patch into a lead |
| 1 | Reso | More resonant bite/character |
| 4 | Keytrack | More consistent brightness across the instrument's pitch range - matters for a melody line spanning more than an octave |

Used this exact recipe (Filt Freq -> 0.8, Reso -> 0.5, Keytrack -> 0.7) to
turn a default Polysynth patch into a usable lead voice for a melody track.

## Genre recipes (grounded in two full songs built this session)

### Pop-rock (C major, I-V-vi-IV)

- **Progression**: `C - G - Am - F` (I-V-vi-IV, the "Axis progression" -
  extremely common across pop/rock; safe default when no genre specifics
  are given).
- **Structure**: Intro (sparse, rhythm section only, no melody/keys yet -
  builds anticipation) -> Verse (sparse: half-note-ish bass with a walking
  passing tone into the next chord, sustained triads with a soft restrike,
  plain backbeat drums) -> Pre-Chorus (2 bars, rising velocity throughout,
  hihat 16th-note buildup on the last beat) -> Chorus (dense: steady 8th-note
  bass with an octave lift on the last 8th of each bar, rhythmic chord
  stabs, syncopated kick, open-hihat accents) -> Bridge (genuine contrast:
  start on a different scale degree, e.g. `Am - F - C - G`, strip the
  arrangement back to near-silence for the first half then rebuild) ->
  Outro (big unison chord hit, sustain, snare build, one final combined
  hit - a clean stop reads better than an ambiguous fade-out).
- **Melody**: its own track/clip, not folded into the keys part. A short
  rhythmic *motif sequenced across the chord changes* (same rhythmic shape,
  transposed to follow each new chord's harmony) reads as an intentional
  hook far more reliably than a fully through-composed, unrepeated line -
  this is standard pop songwriting technique, not a shortcut.

### Rock instrumental / live-guitar backing (E minor, power chords)

- **Key choice affects playability, not just harmony.** E minor / A minor
  / D minor sit under standard guitar tuning's open strings; pick one of
  these (not an arbitrary key) when the backing exists for someone to play
  guitar over live.
- **Power chords are root + fifth only - no third.** E.g. `E2(40) + B2(47)`
  for an "Em5" power chord. This is deliberate, not a simplification to
  fix later: real rock rhythm guitar is voiced this way, and it's exactly
  why the chord-detector correctly reports type `"fifth"` rather than
  major/minor.
- **Progression**: `i - i - VI - VII` (`Em - Em - C - D`) is a durable,
  simple rock riff shape.
- **Rhythm**: a syncopated eighth-note pattern with one deliberate gap per
  bar (e.g. skip the "and" of beat 3: hit 0, 0.5, 1, 1.5, [[rest]], 2.5, 3,
  3.5) reads as a real rock riff; straight unbroken 8ths read as generic
  and flat by comparison.
- **Arranging for a live player on top**: build the real backing (drums,
  bass) unmuted. Add a guide instrument for the part the live player might
  cover (e.g. guitar) and **mute it by default** - it's a compositional
  reference, not meant to sound in the final mix. For at least one section
  (a solo/breakdown), **don't create a clip for the guide instrument at
  all** rather than an empty or muted one - genuinely open space beats a
  guide track fighting a live performance.
- **Dynamic contrast via arrangement, not just volume**: a half-time drum
  feel (kick/snare only, no hihat, spaced twice as far apart) reads as a
  dramatic "breakdown" far more effectively than simply playing the normal
  pattern quieter.

## What this setup cannot do

See `CHANGELOG.md`'s "two full songs composed live via the MCP tools"
entry for the full, dated account of what was built and verified. In
short: no audio recording (a live instrument on top is always a manual
step in Bitwig - see the project's Scope section in `CLAUDE.md`), no
reliable preset loading (base devices + parameter shaping only), and
factory guitar/bass instruments are synthesized stand-ins, not
amp-modeled or performance-realistic substitutes for the real thing.
