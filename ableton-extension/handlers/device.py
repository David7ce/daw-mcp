# Device Handler for Ableton MCP
# Handles device operations on the selected track's device chain.
#
# Ableton devices have no equivalent of Bitwig's fixed 8-slot remote-control
# page: getParameters returns every parameter on the device directly, and
# there is no listParameterPages/selectParameterPage. Parameter values are
# normalized to 0.0-1.0 on the wire (matching the Bitwig side) even though
# Live's own DeviceParameter.value is in the device's native range.

from __future__ import absolute_import, print_function
import logging

from .base import BaseHandler

logger = logging.getLogger("ableton_mcp")


class DeviceHandler(BaseHandler):
    """
    Handles device operations on the currently selected track's device chain.

    Methods:
        - list: List devices on the selected track
        - select: Move the selected-device cursor to a device by index
        - getParameters: Read all parameters of the selected device (0.0-1.0)
        - setParameter: Write a parameter on the selected device (0.0-1.0)
        - delete: Remove a device from the chain
    """

    @property
    def track(self):
        track = self.song.view.selected_track
        if track is None:
            raise ValueError("No track selected in Ableton.")
        return track

    def handle_list(self, params):
        """List devices on the selected track."""
        devices = [{'index': i, 'name': d.name} for i, d in enumerate(self.track.devices)]
        logger.info("Listed %d devices", len(devices))
        return {'devices': devices, 'count': len(devices)}

    def handle_select(self, params):
        """Move the selected-device cursor to a device by index."""
        device = self._get_device(self._get_index(params))
        self.track.view.selected_device = device
        logger.info("Selected device '%s'", device.name)
        return self.success()

    def handle_delete(self, params):
        """Delete a device from the chain by index."""
        index = self._get_index(params)
        self._get_device(index)  # validates existence
        self.track.delete_device(index)
        logger.info("Deleted device at index %d", index)
        return self.success()

    def handle_getParameters(self, params):
        """Read every parameter of the selected device, value normalized to 0-1."""
        device = self._selected_device()
        parameters = []

        for i, param in enumerate(device.parameters):
            try:
                displayed = param.str_for_value(param.value)
            except Exception:
                displayed = str(param.value)

            parameters.append({
                'index': i,
                'name': param.name,
                'value': self._normalize(param),
                'displayedValue': displayed,
            })

        return {'parameters': parameters, 'count': len(parameters)}

    def handle_setParameter(self, params):
        """Write a parameter on the selected device (value normalized 0-1)."""
        device = self._selected_device()
        index = self._get_index(params)
        if 'value' not in params:
            raise ValueError("Missing 'value' parameter")

        if index < 0 or index >= len(device.parameters):
            raise ValueError("Parameter does not exist at index: " + str(index))

        param = device.parameters[index]
        clamped = max(0.0, min(1.0, float(params.get('value'))))
        raw = param.min + clamped * (param.max - param.min)
        param.value = int(round(raw)) if param.is_quantized else raw

        logger.info("Set device parameter %d to %s", index, clamped)
        return self.success()

    def handle_listParameterPages(self, params):
        raise ValueError(
            "Ableton devices have no remote-control-page concept - "
            "get_device_parameters already returns every parameter."
        )

    def handle_selectParameterPage(self, params):
        raise ValueError(
            "Ableton devices have no remote-control-page concept - "
            "get_device_parameters already returns every parameter."
        )

    def _selected_device(self):
        device = self.track.view.selected_device
        if device is None:
            raise ValueError("No device selected. Select a device in Ableton.")
        return device

    def _get_device(self, index):
        devices = self.track.devices
        if index < 0 or index >= len(devices):
            # Wire index is 0-based; report the 1-based index the user sees.
            raise ValueError("Device does not exist at index: " + str(index + 1))
        return devices[index]

    def _get_index(self, params):
        index = params.get('index')
        if index is None:
            raise ValueError("index is required")
        return index

    def _normalize(self, param):
        span = param.max - param.min
        if span == 0:
            return 0.0
        return (param.value - param.min) / span
