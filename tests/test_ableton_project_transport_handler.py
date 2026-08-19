# Smoke tests for ableton-extension/handlers/project.py and transport.py.
#
# Both are thin, but transport.py has one real validation branch (missing
# 'beats' raises) worth guarding, and project.py's field mapping is cheap
# insurance against a typo'd Live API attribute name going unnoticed.
#
# Run with: python tests/test_ableton_project_transport_handler.py -v
# (from the repo root)

from __future__ import absolute_import
import os
import sys
import unittest

ABLETON_EXTENSION_DIR = os.path.join(os.path.dirname(__file__), '..', 'ableton-extension')
sys.path.insert(0, os.path.abspath(ABLETON_EXTENSION_DIR))

from handlers.project import ProjectHandler  # noqa: E402
from handlers.transport import TransportHandler  # noqa: E402


class FakeSong(object):
    def __init__(self, tempo=120.0, sig_num=4, sig_den=4, is_playing=False, record_mode=False, current_song_time=0.0):
        self.tempo = tempo
        self.signature_numerator = sig_num
        self.signature_denominator = sig_den
        self.is_playing = is_playing
        self.record_mode = record_mode
        self.current_song_time = current_song_time


class FakeDispatcher(object):
    def __init__(self, song):
        self.song = song


class ProjectHandlerTest(unittest.TestCase):
    def test_getInfo_maps_every_field_from_the_song(self):
        song = FakeSong(tempo=128.5, sig_num=3, sig_den=4, is_playing=True, record_mode=False)
        handler = ProjectHandler(FakeDispatcher(song))

        result = handler.handle_getInfo({})

        self.assertEqual(result, {
            'bpm': 128.5,
            'timeSignatureNumerator': 3,
            'timeSignatureDenominator': 4,
            'isPlaying': True,
            'isRecording': False,
        })


class TransportHandlerTest(unittest.TestCase):
    def test_setPosition_missing_beats_raises(self):
        handler = TransportHandler(FakeDispatcher(FakeSong()))
        with self.assertRaises(ValueError):
            handler.handle_setPosition({})

    def test_setPosition_sets_current_song_time(self):
        song = FakeSong()
        handler = TransportHandler(FakeDispatcher(song))

        handler.handle_setPosition({'beats': 8})

        self.assertEqual(song.current_song_time, 8.0)
        self.assertIsInstance(song.current_song_time, float)  # coerced, not left as an int


if __name__ == '__main__':
    unittest.main()
