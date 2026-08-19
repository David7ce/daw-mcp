# Smoke tests for ableton-extension/handlers/track.py.
#
# Runs outside Ableton: fakes the slice of the Live API the handler touches
# (Song/Track/MixerDevice) so the CRUD + property logic can be verified
# without a running Live instance.
#
# Run with: python tests/test_ableton_track_handler.py -v
# (from the repo root)

from __future__ import absolute_import
import os
import sys
import unittest

ABLETON_EXTENSION_DIR = os.path.join(os.path.dirname(__file__), '..', 'ableton-extension')
sys.path.insert(0, os.path.abspath(ABLETON_EXTENSION_DIR))

from handlers.track import TrackHandler  # noqa: E402


class FakeMixerParam(object):
    def __init__(self, value):
        self.value = value


class FakeMixerDevice(object):
    def __init__(self, volume=0.85, panning=0.0):
        self.volume = FakeMixerParam(volume) if volume is not None else None
        self.panning = FakeMixerParam(panning) if panning is not None else None


_UNSET = object()  # sentinel: "give this track its own fresh mixer device"


class FakeTrack(object):
    def __init__(self, name, mute=False, solo=False, arm=None, mixer_device=_UNSET):
        self.name = name
        self.mute = mute
        self.solo = solo
        if arm is not None:
            self.arm = arm
        # A mutable default (FakeMixerDevice()) would be evaluated once and
        # shared across every FakeTrack() call that omits it - use a
        # sentinel so each track gets its own instance instead.
        self.mixer_device = FakeMixerDevice() if mixer_device is _UNSET else mixer_device


class BrokenTrack(object):
    @property
    def name(self):
        raise RuntimeError("boom")


class FakeSongView(object):
    def __init__(self):
        self.selected_track = None


class FakeSong(object):
    def __init__(self, tracks=None):
        self.tracks = list(tracks or [])
        self.view = FakeSongView()
        self.created = []  # (kind, position)
        self.deleted = []

    def create_audio_track(self, position):
        self.created.append(('audio', position))
        self.tracks.insert(position, FakeTrack('Audio'))

    def create_midi_track(self, position):
        self.created.append(('midi', position))
        self.tracks.insert(position, FakeTrack('MIDI'))

    def delete_track(self, index):
        self.deleted.append(index)
        del self.tracks[index]


class FakeDispatcher(object):
    def __init__(self, song):
        self.song = song


def make_handler(song):
    return TrackHandler(FakeDispatcher(song))


class ListTracksTest(unittest.TestCase):
    def test_reads_name_mute_solo_volume_pan(self):
        track = FakeTrack('Bass', mute=True, solo=False, mixer_device=FakeMixerDevice(volume=0.7, panning=-0.2))
        handler = make_handler(FakeSong([track]))

        result = handler.handle_list({})

        self.assertEqual(result['tracks'], [{
            'index': 0, 'name': 'Bass', 'mute': True, 'solo': False, 'arm': False,
            'volume': 0.7, 'pan': -0.2,
        }])

    def test_arm_defaults_to_false_when_the_live_object_lacks_it(self):
        track = FakeTrack('Bass')  # no `arm` attribute set
        handler = make_handler(FakeSong([track]))

        result = handler.handle_list({})

        self.assertEqual(result['tracks'][0]['arm'], False)

    def test_no_mixer_device_omits_volume_and_pan_instead_of_crashing(self):
        track = FakeTrack('Return', mixer_device=None)
        handler = make_handler(FakeSong([track]))

        result = handler.handle_list({})

        self.assertNotIn('volume', result['tracks'][0])
        self.assertNotIn('pan', result['tracks'][0])

    def test_a_broken_track_is_skipped_not_fatal(self):
        good = FakeTrack('Good')
        handler = make_handler(FakeSong([BrokenTrack(), good]))

        result = handler.handle_list({})

        self.assertEqual(len(result['tracks']), 1)
        self.assertEqual(result['tracks'][0]['name'], 'Good')


class CreateTrackTest(unittest.TestCase):
    def test_position_minus_one_appends_at_the_end(self):
        song = FakeSong([FakeTrack('A'), FakeTrack('B')])
        handler = make_handler(song)

        result = handler.handle_create({'type': 'instrument', 'position': -1})

        self.assertEqual(result['index'], 2)
        self.assertEqual(song.created, [('midi', 2)])

    def test_audio_type_creates_an_audio_track(self):
        song = FakeSong()
        handler = make_handler(song)

        handler.handle_create({'type': 'audio', 'position': 0})

        self.assertEqual(song.created, [('audio', 0)])

    def test_effect_type_creates_a_midi_track_like_instrument(self):
        song = FakeSong()
        handler = make_handler(song)

        handler.handle_create({'type': 'effect', 'position': 0})

        self.assertEqual(song.created, [('midi', 0)])


class DeleteTrackTest(unittest.TestCase):
    def test_missing_index_raises(self):
        handler = make_handler(FakeSong([FakeTrack('A')]))

        with self.assertRaises(ValueError):
            handler.handle_delete({})

    def test_deletes_the_track_at_index(self):
        song = FakeSong([FakeTrack('A'), FakeTrack('B')])
        handler = make_handler(song)

        handler.handle_delete({'index': 0})

        self.assertEqual(song.deleted, [0])
        self.assertEqual(len(song.tracks), 1)
        self.assertEqual(song.tracks[0].name, 'B')


class SelectTrackTest(unittest.TestCase):
    def test_missing_index_raises(self):
        handler = make_handler(FakeSong([FakeTrack('A')]))

        with self.assertRaises(ValueError):
            handler.handle_select({})

    def test_sets_the_selected_track(self):
        track = FakeTrack('A')
        song = FakeSong([track])
        handler = make_handler(song)

        handler.handle_select({'index': 0})

        self.assertIs(song.view.selected_track, track)


class TrackPropertiesTest(unittest.TestCase):
    def test_set_name_missing_index_raises(self):
        handler = make_handler(FakeSong([FakeTrack('A')]))
        with self.assertRaises(ValueError):
            handler.handle_setName({'name': 'X'})

    def test_set_name(self):
        song = FakeSong([FakeTrack('A')])
        handler = make_handler(song)

        handler.handle_setName({'index': 0, 'name': 'Bass'})

        self.assertEqual(song.tracks[0].name, 'Bass')

    def test_set_volume_writes_the_mixer_device(self):
        song = FakeSong([FakeTrack('A', mixer_device=FakeMixerDevice(volume=0.5))])
        handler = make_handler(song)

        handler.handle_setVolume({'index': 0, 'volume': 0.9})

        self.assertAlmostEqual(song.tracks[0].mixer_device.volume.value, 0.9)

    def test_set_volume_without_a_mixer_device_raises(self):
        song = FakeSong([FakeTrack('A', mixer_device=None)])
        handler = make_handler(song)

        with self.assertRaisesRegex(ValueError, 'no mixer device'):
            handler.handle_setVolume({'index': 0, 'volume': 0.9})

    def test_set_mute_coerces_to_bool(self):
        song = FakeSong([FakeTrack('A')])
        handler = make_handler(song)

        handler.handle_setMute({'index': 0, 'mute': 1})

        self.assertIs(song.tracks[0].mute, True)

    def test_set_solo_coerces_to_bool(self):
        song = FakeSong([FakeTrack('A')])
        handler = make_handler(song)

        handler.handle_setSolo({'index': 0, 'solo': 0})

        self.assertIs(song.tracks[0].solo, False)


if __name__ == '__main__':
    unittest.main()
