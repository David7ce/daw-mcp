# Smoke tests for ableton-extension/handlers/device.py.
#
# Runs outside Ableton: fakes the slice of the Live API the handler touches
# (Song/Track/Device/DeviceParameter) so the validation and value-
# normalization logic can be verified without a running Live instance.
#
# Run with: python -m unittest tests/test_ableton_device_handler.py -v
# (from the repo root)

from __future__ import absolute_import
import os
import sys
import unittest

# ableton-extension/ isn't an importable package name (hyphen), and its
# modules use relative imports (`from .base import BaseHandler`), so put the
# directory itself on sys.path and import `handlers.device` as a top-level
# package from there.
ABLETON_EXTENSION_DIR = os.path.join(os.path.dirname(__file__), '..', 'ableton-extension')
sys.path.insert(0, os.path.abspath(ABLETON_EXTENSION_DIR))

from handlers.device import DeviceHandler  # noqa: E402


class FakeParameter(object):
    def __init__(self, name, value, min_value, max_value, is_quantized=False, display_fails=False):
        self.name = name
        self.value = value
        self.min = min_value
        self.max = max_value
        self.is_quantized = is_quantized
        self._display_fails = display_fails

    def str_for_value(self, value):
        if self._display_fails:
            raise RuntimeError("no display available")
        return "%.1f" % value


class FakeDevice(object):
    def __init__(self, name, parameters=None):
        self.name = name
        self.parameters = parameters or []


class FakeTrackView(object):
    def __init__(self):
        self.selected_device = None


class FakeTrack(object):
    def __init__(self, devices=None):
        self.devices = list(devices or [])
        self.view = FakeTrackView()
        self.deleted_indices = []

    def delete_device(self, index):
        self.deleted_indices.append(index)
        del self.devices[index]


class FakeSongView(object):
    def __init__(self, selected_track=None):
        self.selected_track = selected_track


class FakeSong(object):
    def __init__(self, selected_track=None):
        self.view = FakeSongView(selected_track)


class FakeDispatcher(object):
    def __init__(self, song):
        self.song = song


def make_handler(track):
    return DeviceHandler(FakeDispatcher(FakeSong(track)))


class DeviceHandlerTest(unittest.TestCase):
    def test_list_returns_index_and_name_for_every_device(self):
        track = FakeTrack([FakeDevice('Operator'), FakeDevice('EQ Eight')])
        result = make_handler(track).handle_list({})

        self.assertEqual(result['count'], 2)
        self.assertEqual(result['devices'], [
            {'index': 0, 'name': 'Operator'},
            {'index': 1, 'name': 'EQ Eight'},
        ])

    def test_list_with_no_track_selected_raises(self):
        with self.assertRaises(ValueError):
            make_handler(None).handle_list({})

    def test_select_moves_the_selected_device_cursor(self):
        device = FakeDevice('Reverb')
        track = FakeTrack([device])
        handler = make_handler(track)

        handler.handle_select({'index': 0})

        self.assertIs(track.view.selected_device, device)

    def test_select_out_of_bounds_reports_one_based_index(self):
        track = FakeTrack([FakeDevice('Reverb')])
        handler = make_handler(track)

        with self.assertRaisesRegex(ValueError, r'index: 6'):
            handler.handle_select({'index': 5})

    def test_delete_removes_the_device_by_index(self):
        track = FakeTrack([FakeDevice('Compressor')])
        handler = make_handler(track)

        handler.handle_delete({'index': 0})

        self.assertEqual(track.deleted_indices, [0])

    def test_delete_out_of_bounds_raises_without_deleting(self):
        track = FakeTrack([FakeDevice('Compressor')])
        handler = make_handler(track)

        with self.assertRaises(ValueError):
            handler.handle_delete({'index': 3})
        self.assertEqual(track.deleted_indices, [])

    def test_get_parameters_normalizes_native_range_to_0_1(self):
        # Filter cutoff: 20-20000 Hz, currently at 10010 Hz -> ~0.5
        param = FakeParameter('Cutoff', value=10010, min_value=20, max_value=20000)
        device = FakeDevice('Filter', [param])
        track = FakeTrack([device])
        track.view.selected_device = device
        handler = make_handler(track)

        result = handler.handle_getParameters({})

        self.assertEqual(result['count'], 1)
        self.assertAlmostEqual(result['parameters'][0]['value'], 0.5, places=3)
        self.assertEqual(result['parameters'][0]['displayedValue'], '10010.0')

    def test_get_parameters_falls_back_when_str_for_value_raises(self):
        param = FakeParameter('Weird', value=1, min_value=0, max_value=1, display_fails=True)
        device = FakeDevice('Odd', [param])
        track = FakeTrack([device])
        track.view.selected_device = device
        handler = make_handler(track)

        result = handler.handle_getParameters({})

        self.assertEqual(result['parameters'][0]['displayedValue'], '1')

    def test_get_parameters_requires_a_selected_device(self):
        track = FakeTrack([FakeDevice('Reverb')])
        handler = make_handler(track)

        with self.assertRaises(ValueError):
            handler.handle_getParameters({})

    def test_set_parameter_denormalizes_0_1_into_native_range(self):
        param = FakeParameter('Cutoff', value=0, min_value=20, max_value=20020)
        device = FakeDevice('Filter', [param])
        track = FakeTrack([device])
        track.view.selected_device = device
        handler = make_handler(track)

        handler.handle_setParameter({'index': 0, 'value': 0.5})

        self.assertAlmostEqual(param.value, 10020, places=3)

    def test_set_parameter_clamps_outside_0_1(self):
        param = FakeParameter('Cutoff', value=0, min_value=0, max_value=100)
        device = FakeDevice('Filter', [param])
        track = FakeTrack([device])
        track.view.selected_device = device
        handler = make_handler(track)

        handler.handle_setParameter({'index': 0, 'value': 5})

        self.assertEqual(param.value, 100)

    def test_set_parameter_rounds_quantized_params_to_nearest_step(self):
        # 4-way enum (0-3): value 0.6 -> raw 1.8 -> nearest step 2
        param = FakeParameter('Filter Type', value=0, min_value=0, max_value=3, is_quantized=True)
        device = FakeDevice('Filter', [param])
        track = FakeTrack([device])
        track.view.selected_device = device
        handler = make_handler(track)

        handler.handle_setParameter({'index': 0, 'value': 0.6})

        self.assertEqual(param.value, 2)
        self.assertIsInstance(param.value, int)

    def test_set_parameter_index_out_of_range_raises(self):
        device = FakeDevice('Filter', [FakeParameter('Cutoff', 0, 0, 1)])
        track = FakeTrack([device])
        track.view.selected_device = device
        handler = make_handler(track)

        with self.assertRaises(ValueError):
            handler.handle_setParameter({'index': 5, 'value': 0.5})

    def test_parameter_pages_are_explicitly_unsupported(self):
        handler = make_handler(FakeTrack())
        track = handler.track
        track.view.selected_device = FakeDevice('Filter')

        with self.assertRaisesRegex(ValueError, 'no remote-control-page concept'):
            handler.handle_listParameterPages({})
        with self.assertRaisesRegex(ValueError, 'no remote-control-page concept'):
            handler.handle_selectParameterPage({'index': 0})


if __name__ == '__main__':
    unittest.main()
