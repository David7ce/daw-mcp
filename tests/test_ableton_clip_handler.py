# Smoke tests for ableton-extension/handlers/clip.py.
#
# Runs outside Ableton: fakes the slice of the Live API the handler touches
# (Song/Track/ClipSlot/Clip, plus Live.Clip.MidiNoteSpecification) so the
# note read/write logic - tolerance-based note matching, pitch clamping,
# both wire note formats, cursor-vs-explicit clip selection - can be
# verified without a running Live instance.
#
# Run with: python -m unittest tests/test_ableton_clip_handler.py -v
# (from the repo root)

from __future__ import absolute_import
import os
import sys
import unittest

# ableton-extension/ isn't an importable package name (hyphen), and its
# modules use relative imports (`from .base import BaseHandler`), so put the
# directory itself on sys.path and import `handlers.clip` as a top-level
# package from there.
ABLETON_EXTENSION_DIR = os.path.join(os.path.dirname(__file__), '..', 'ableton-extension')
sys.path.insert(0, os.path.abspath(ABLETON_EXTENSION_DIR))

import handlers.clip as clip_module  # noqa: E402
from handlers.clip import ClipHandler  # noqa: E402


class FakeMidiNoteSpecification(object):
    """Stand-in for Live.Clip.MidiNoteSpecification - just holds the fields."""

    def __init__(self, start_time, duration, pitch, velocity, mute):
        self.start_time = start_time
        self.duration = duration
        self.pitch = pitch
        self.velocity = velocity
        self.mute = mute


class FakeLiveClipModule(object):
    MidiNoteSpecification = FakeMidiNoteSpecification


class FakeLiveModule(object):
    Clip = FakeLiveClipModule


# clip.py does `try: import Live except ImportError: Live = None` at import
# time. Patch the module-level name directly so the write paths (which raise
# "Live API not available" when it's None) exercise real logic instead.
clip_module.Live = FakeLiveModule


class FakeClip(object):
    """notes: list of (pitch, time, duration, velocity, mute) tuples - the
    same tuple shape Live's Clip.get_notes returns."""

    def __init__(self, notes=None, length=4.0, name=''):
        self._notes = list(notes or [])
        self.length = length
        self.name = name
        self.is_playing = False
        self.is_recording = False
        self.loop_end = length

    def get_notes(self, from_time, from_pitch, time_span, pitch_span):
        return tuple(self._notes)

    def remove_notes_extended(self, from_pitch, pitch_span, from_time, time_span):
        self._notes = []

    def add_new_notes(self, specs):
        for s in specs:
            self._notes.append((s.pitch, s.start_time, s.duration, s.velocity, s.mute))


class BrokenClip(object):
    """A clip whose properties raise - simulates handle_list's per-slot
    try/except around clip property access."""

    @property
    def name(self):
        raise RuntimeError("boom")


class FakeClipSlot(object):
    def __init__(self, clip=None):
        self.clip = clip
        self.has_clip = clip is not None
        self.stopped = False

    def create_clip(self, length):
        self.clip = FakeClip(length=length)
        self.has_clip = True

    def delete_clip(self):
        self.clip = None
        self.has_clip = False

    def stop(self):
        self.stopped = True


class FakeTrack(object):
    def __init__(self, clip_slots=None):
        self.clip_slots = list(clip_slots or [])


class FakeSongView(object):
    def __init__(self, selected_track=None, highlighted_clip_slot=None):
        self.selected_track = selected_track
        self.highlighted_clip_slot = highlighted_clip_slot


class FakeSong(object):
    def __init__(self, tracks=None, selected_track=None, highlighted_clip_slot=None, scenes=None):
        self.tracks = list(tracks or [])
        self.view = FakeSongView(selected_track, highlighted_clip_slot)
        self.scenes = list(scenes or [])

    def create_scene(self, index):
        self.scenes.append(object())


class FakeDispatcher(object):
    def __init__(self, song):
        self.song = song


def make_handler(song):
    return ClipHandler(FakeDispatcher(song))


class ClipSelectionTest(unittest.TestCase):
    def test_explicit_indices_bypass_the_cursor(self):
        clip = FakeClip()
        track = FakeTrack([FakeClipSlot(clip)])
        song = FakeSong(tracks=[track])
        handler = make_handler(song)

        result = handler.handle_getNotes({'trackIndex': 0, 'slotIndex': 0})

        self.assertEqual(result['notes'], [])

    def test_no_slot_selected_raises(self):
        song = FakeSong()
        handler = make_handler(song)

        with self.assertRaisesRegex(ValueError, 'No clip slot selected'):
            handler.handle_getNotes({})

    def test_empty_slot_raises(self):
        track = FakeTrack([FakeClipSlot(clip=None)])
        song = FakeSong(tracks=[track], highlighted_clip_slot=track.clip_slots[0])
        handler = make_handler(song)

        with self.assertRaisesRegex(ValueError, 'No clip in slot'):
            handler.handle_getNotes({})


class ListClipsTest(unittest.TestCase):
    def test_only_slots_with_content_are_listed(self):
        clip = FakeClip(name='Intro', length=8.0)
        track = FakeTrack([FakeClipSlot(clip), FakeClipSlot(clip=None)])
        handler = make_handler(FakeSong(tracks=[track]))

        result = handler.handle_list({'trackIndex': 0})

        self.assertEqual(len(result['clips']), 1)
        self.assertEqual(result['clips'][0]['name'], 'Intro')
        self.assertEqual(result['clips'][0]['length'], 8.0)

    def test_a_broken_clip_is_skipped_not_fatal(self):
        good = FakeClip(name='Good')
        slot_good = FakeClipSlot(good)
        slot_broken = FakeClipSlot(BrokenClip())
        track = FakeTrack([slot_broken, slot_good])
        handler = make_handler(FakeSong(tracks=[track]))

        result = handler.handle_list({'trackIndex': 0})

        self.assertEqual(len(result['clips']), 1)
        self.assertEqual(result['clips'][0]['name'], 'Good')


class GetNotesTest(unittest.TestCase):
    def test_normalizes_velocity_to_0_1_and_reports_clip_length(self):
        clip = FakeClip(notes=[(60, 0.0, 0.5, 127, False), (64, 1.0, 0.25, 0, False)], length=4.0)
        track = FakeTrack([FakeClipSlot(clip)])
        handler = make_handler(FakeSong(tracks=[track]))

        result = handler.handle_getNotes({'trackIndex': 0, 'slotIndex': 0})

        self.assertEqual(result['count'], 2)
        self.assertEqual(result['clipLength'], 4.0)
        self.assertAlmostEqual(result['notes'][0]['velocity'], 1.0)
        self.assertAlmostEqual(result['notes'][1]['velocity'], 0.0)
        self.assertEqual(result['notes'][0]['y'], 60)

    def test_empty_clip_returns_zero_count(self):
        clip = FakeClip(notes=[], length=4.0)
        track = FakeTrack([FakeClipSlot(clip)])
        handler = make_handler(FakeSong(tracks=[track]))

        result = handler.handle_getNotes({'trackIndex': 0, 'slotIndex': 0})

        self.assertEqual(result['notes'], [])
        self.assertEqual(result['count'], 0)


class SetNotesTest(unittest.TestCase):
    def test_ultra_lean_array_format(self):
        clip = FakeClip()
        track = FakeTrack([FakeClipSlot(clip)])
        handler = make_handler(FakeSong(tracks=[track]))

        handler.handle_setNotes({
            'trackIndex': 0, 'slotIndex': 0,
            'notes': [[0, 60, 100, 0.5]],
        })

        self.assertEqual(clip._notes, [(60, 0.0, 0.5, 100.0, False)])

    def test_object_format_with_defaults(self):
        clip = FakeClip()
        track = FakeTrack([FakeClipSlot(clip)])
        handler = make_handler(FakeSong(tracks=[track]))

        handler.handle_setNotes({
            'trackIndex': 0, 'slotIndex': 0,
            'notes': [{'x': 1.0, 'y': 64}],  # velocity/duration/muted omitted
        })

        self.assertEqual(clip._notes, [(64, 1.0, 0.25, 100.0, False)])

    def test_empty_notes_list_is_a_no_op(self):
        clip = FakeClip()
        track = FakeTrack([FakeClipSlot(clip)])
        handler = make_handler(FakeSong(tracks=[track]))

        result = handler.handle_setNotes({'trackIndex': 0, 'slotIndex': 0, 'notes': []})

        self.assertEqual(result, {'success': True})
        self.assertEqual(clip._notes, [])


class ClearNoteTest(unittest.TestCase):
    def test_removes_only_the_matching_note(self):
        clip = FakeClip(notes=[(60, 0.0, 0.5, 100, False), (64, 1.0, 0.25, 80, False)])
        track = FakeTrack([FakeClipSlot(clip)])
        handler = make_handler(FakeSong(tracks=[track]))

        handler.handle_clearNote({'trackIndex': 0, 'slotIndex': 0, 'x': 0.0, 'y': 60})

        self.assertEqual(len(clip._notes), 1)
        self.assertEqual(clip._notes[0][0], 64)  # the other note's pitch

    def test_no_match_leaves_notes_untouched(self):
        clip = FakeClip(notes=[(60, 0.0, 0.5, 100, False)])
        track = FakeTrack([FakeClipSlot(clip)])
        handler = make_handler(FakeSong(tracks=[track]))

        handler.handle_clearNote({'trackIndex': 0, 'slotIndex': 0, 'x': 5.0, 'y': 60})

        self.assertEqual(len(clip._notes), 1)


class MoveNoteTest(unittest.TestCase):
    def test_moves_the_matching_note_by_dx_dy(self):
        clip = FakeClip(notes=[(60, 0.0, 0.5, 100, False)])
        track = FakeTrack([FakeClipSlot(clip)])
        handler = make_handler(FakeSong(tracks=[track]))

        handler.handle_moveNote({'trackIndex': 0, 'slotIndex': 0, 'x': 0.0, 'y': 60, 'dx': 2.0, 'dy': 12})

        self.assertEqual(len(clip._notes), 1)
        pitch, time, duration, velocity, mute = clip._notes[0]
        self.assertEqual(pitch, 72)
        self.assertEqual(time, 2.0)

    def test_zero_offset_is_a_no_op(self):
        clip = FakeClip(notes=[(60, 0.0, 0.5, 100, False)])
        track = FakeTrack([FakeClipSlot(clip)])
        handler = make_handler(FakeSong(tracks=[track]))

        handler.handle_moveNote({'trackIndex': 0, 'slotIndex': 0, 'x': 0.0, 'y': 60})

        # No get_notes/rewrite cycle happened - the original tuple is untouched.
        self.assertEqual(clip._notes, [(60, 0.0, 0.5, 100, False)])

    def test_moving_pitch_out_of_range_drops_the_note(self):
        clip = FakeClip(notes=[(120, 0.0, 0.5, 100, False)])
        track = FakeTrack([FakeClipSlot(clip)])
        handler = make_handler(FakeSong(tracks=[track]))

        handler.handle_moveNote({'trackIndex': 0, 'slotIndex': 0, 'x': 0.0, 'y': 120, 'dy': 20})

        self.assertEqual(clip._notes, [])


class ModifyNotePropertyTest(unittest.TestCase):
    def test_set_velocity_only_touches_the_matching_note(self):
        clip = FakeClip(notes=[(60, 0.0, 0.5, 100, False), (64, 1.0, 0.5, 100, False)])
        track = FakeTrack([FakeClipSlot(clip)])
        handler = make_handler(FakeSong(tracks=[track]))

        handler.handle_setNoteVelocity({'trackIndex': 0, 'slotIndex': 0, 'x': 0.0, 'y': 60, 'value': 42})

        velocities = sorted(n[3] for n in clip._notes)
        self.assertEqual(velocities, [42.0, 100.0])

    def test_set_muted(self):
        clip = FakeClip(notes=[(60, 0.0, 0.5, 100, False)])
        track = FakeTrack([FakeClipSlot(clip)])
        handler = make_handler(FakeSong(tracks=[track]))

        handler.handle_setNoteMuted({'trackIndex': 0, 'slotIndex': 0, 'x': 0.0, 'y': 60, 'value': True})

        self.assertTrue(clip._notes[0][4])


class TransposeTest(unittest.TestCase):
    def test_shifts_every_note_by_semitones(self):
        clip = FakeClip(notes=[(60, 0.0, 0.5, 100, False), (64, 1.0, 0.5, 100, False)])
        track = FakeTrack([FakeClipSlot(clip)])
        handler = make_handler(FakeSong(tracks=[track]))

        handler.handle_transpose({'trackIndex': 0, 'slotIndex': 0, 'semitones': 12})

        pitches = sorted(n[0] for n in clip._notes)
        self.assertEqual(pitches, [72, 76])

    def test_notes_pushed_out_of_range_are_dropped(self):
        clip = FakeClip(notes=[(120, 0.0, 0.5, 100, False)])
        track = FakeTrack([FakeClipSlot(clip)])
        handler = make_handler(FakeSong(tracks=[track]))

        handler.handle_transpose({'trackIndex': 0, 'slotIndex': 0, 'semitones': 20})

        self.assertEqual(clip._notes, [])

    def test_zero_semitones_is_a_no_op(self):
        clip = FakeClip(notes=[(60, 0.0, 0.5, 100, False)])
        track = FakeTrack([FakeClipSlot(clip)])
        handler = make_handler(FakeSong(tracks=[track]))

        handler.handle_transpose({'trackIndex': 0, 'slotIndex': 0, 'semitones': 0})

        self.assertEqual(clip._notes, [(60, 0.0, 0.5, 100, False)])


class CreateDeleteClipTest(unittest.TestCase):
    def test_create_raises_when_slot_already_has_a_clip(self):
        track = FakeTrack([FakeClipSlot(FakeClip())])
        handler = make_handler(FakeSong(tracks=[track]))

        with self.assertRaisesRegex(ValueError, 'already has a clip'):
            handler.handle_create({'trackIndex': 0, 'slotIndex': 0})

    def test_create_sets_the_name_when_provided(self):
        track = FakeTrack([FakeClipSlot(clip=None)])
        handler = make_handler(FakeSong(tracks=[track]))

        handler.handle_create({'trackIndex': 0, 'slotIndex': 0, 'lengthInBeats': 8, 'name': 'Verse'})

        self.assertEqual(track.clip_slots[0].clip.name, 'Verse')
        self.assertEqual(track.clip_slots[0].clip.length, 8.0)

    def test_delete_raises_when_slot_is_already_empty(self):
        track = FakeTrack([FakeClipSlot(clip=None)])
        handler = make_handler(FakeSong(tracks=[track]))

        with self.assertRaisesRegex(ValueError, 'No clip in slot'):
            handler.handle_delete({'trackIndex': 0, 'slotIndex': 0})

    def test_delete_clears_the_slot(self):
        track = FakeTrack([FakeClipSlot(FakeClip())])
        handler = make_handler(FakeSong(tracks=[track]))

        handler.handle_delete({'trackIndex': 0, 'slotIndex': 0})

        self.assertFalse(track.clip_slots[0].has_clip)


class FindEmptySlotsTest(unittest.TestCase):
    def test_stops_at_requested_count_and_scene_bound(self):
        # 5 slots, only 3 scenes exist (slot 3+ is past the project's actual scenes)
        slots = [FakeClipSlot(clip=None) for _ in range(5)]
        slots[0] = FakeClipSlot(FakeClip())  # slot 0 filled
        track = FakeTrack(slots)
        song = FakeSong(tracks=[track], scenes=[object(), object(), object()])  # 3 scenes
        handler = make_handler(song)

        result = handler.handle_findEmptySlots({'trackIndex': 0, 'startSlot': 0, 'count': 5})

        # Only slots 1, 2 are both empty and within the 3-scene bound.
        self.assertEqual(result['emptySlots'], [1, 2])
        self.assertEqual(result['sceneCount'], 3)


if __name__ == '__main__':
    unittest.main()
