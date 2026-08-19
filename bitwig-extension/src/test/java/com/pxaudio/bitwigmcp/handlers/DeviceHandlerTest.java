package com.pxaudio.bitwigmcp.handlers;

import com.bitwig.extension.controller.api.*;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.pxaudio.bitwigmcp.BitwigMCPExtension;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.*;

/**
 * Covers the validation/bounds-checking logic in DeviceHandler - the part
 * that isn't pure delegation to the Bitwig API. Everything here is mocked;
 * it doesn't touch a running Bitwig instance.
 */
class DeviceHandlerTest {

    private BitwigMCPExtension extension;
    private DeviceBank deviceBank;
    private CursorDevice cursorDevice;
    private CursorRemoteControlsPage remoteControls;
    private DeviceHandler handler;

    @BeforeEach
    void setUp() {
        extension = mock(BitwigMCPExtension.class);
        deviceBank = mock(DeviceBank.class);
        cursorDevice = mock(CursorDevice.class);
        remoteControls = mock(CursorRemoteControlsPage.class);

        when(extension.getDeviceBank()).thenReturn(deviceBank);
        when(extension.getCursorDevice()).thenReturn(cursorDevice);
        when(extension.getRemoteControls()).thenReturn(remoteControls);

        handler = new DeviceHandler(extension, mock(ControllerHost.class));
    }

    private Device deviceExisting(String name) {
        Device device = mock(Device.class);
        BooleanValue exists = mock(BooleanValue.class);
        StringValue nameValue = mock(StringValue.class);
        when(exists.get()).thenReturn(true);
        when(nameValue.get()).thenReturn(name);
        when(device.exists()).thenReturn(exists);
        when(device.name()).thenReturn(nameValue);
        return device;
    }

    private Device deviceMissing() {
        Device device = mock(Device.class);
        BooleanValue exists = mock(BooleanValue.class);
        when(exists.get()).thenReturn(false);
        when(device.exists()).thenReturn(exists);
        return device;
    }

    private void cursorDeviceExists(boolean value) {
        BooleanValue exists = mock(BooleanValue.class);
        when(exists.get()).thenReturn(value);
        when(cursorDevice.exists()).thenReturn(exists);
    }

    private static JsonObject indexParam(int index) {
        JsonObject params = new JsonObject();
        params.addProperty("index", index);
        return params;
    }

    // --- list ---

    @Test
    void list_skipsNonExistentDevices() {
        Device deviceA = deviceExisting("A");
        Device deviceB = deviceMissing();
        Device deviceC = deviceExisting("C");
        when(deviceBank.getSizeOfBank()).thenReturn(3);
        when(deviceBank.getDevice(0)).thenReturn(deviceA);
        when(deviceBank.getDevice(1)).thenReturn(deviceB);
        when(deviceBank.getDevice(2)).thenReturn(deviceC);

        JsonObject result = handler.handle("list", new JsonObject()).getAsJsonObject();

        assertEquals(2, result.get("count").getAsInt());
        assertEquals("A", result.getAsJsonArray("devices").get(0).getAsJsonObject().get("name").getAsString());
        assertEquals("C", result.getAsJsonArray("devices").get(1).getAsJsonObject().get("name").getAsString());
    }

    // --- select ---

    @Test
    void select_movesCursorToTheDevice() {
        when(deviceBank.getSizeOfBank()).thenReturn(2);
        Device device = deviceExisting("Polysynth");
        when(deviceBank.getDevice(1)).thenReturn(device);

        JsonElement result = handler.handle("select", indexParam(1));

        verify(cursorDevice).selectDevice(device);
        assertTrue(result.getAsJsonObject().get("success").getAsBoolean());
    }

    @Test
    void select_outOfBounds_reportsOneBasedIndex() {
        when(deviceBank.getSizeOfBank()).thenReturn(2);

        Exception e = assertThrows(IllegalArgumentException.class,
                () -> handler.handle("select", indexParam(5)));
        assertTrue(e.getMessage().contains("6"), "expected 1-based index 6 in: " + e.getMessage());
    }

    // --- delete ---

    @Test
    void delete_removesTheDevice() {
        when(deviceBank.getSizeOfBank()).thenReturn(1);
        Device device = deviceExisting("Reverb");
        when(deviceBank.getDevice(0)).thenReturn(device);

        handler.handle("delete", indexParam(0));

        verify(device).deleteObject();
    }

    @Test
    void delete_nonExistentDevice_throws() {
        Device device = deviceMissing();
        when(deviceBank.getSizeOfBank()).thenReturn(1);
        when(deviceBank.getDevice(0)).thenReturn(device);

        assertThrows(IllegalArgumentException.class, () -> handler.handle("delete", indexParam(0)));
    }

    // --- getParameters ---

    @Test
    void getParameters_requiresACursorDevice() {
        cursorDeviceExists(false);

        Exception e = assertThrows(IllegalArgumentException.class,
                () -> handler.handle("getParameters", new JsonObject()));
        assertTrue(e.getMessage().contains("No device selected"));
    }

    @Test
    void getParameters_returnsAllEightSlots() {
        cursorDeviceExists(true);

        RemoteControl param = mock(RemoteControl.class);
        SettableStringValue paramName = mock(SettableStringValue.class);
        SettableRangedValue value = mock(SettableRangedValue.class);
        StringValue displayed = mock(StringValue.class);
        when(paramName.get()).thenReturn("Cutoff");
        when(value.get()).thenReturn(0.5);
        when(value.displayedValue()).thenReturn(displayed);
        when(displayed.get()).thenReturn("50 %");
        when(param.name()).thenReturn(paramName);
        when(param.value()).thenReturn(value);
        when(remoteControls.getParameter(anyInt())).thenReturn(param);

        JsonObject result = handler.handle("getParameters", new JsonObject()).getAsJsonObject();

        assertEquals(8, result.get("count").getAsInt());
        JsonObject first = result.getAsJsonArray("parameters").get(0).getAsJsonObject();
        assertEquals(0, first.get("index").getAsInt());
        assertEquals(0.5, first.get("value").getAsDouble());
        assertEquals("50 %", first.get("displayedValue").getAsString());
    }

    // --- setParameter ---

    @Test
    void setParameter_clampsAboveOneAndWritesImmediately() {
        cursorDeviceExists(true);
        RemoteControl param = mock(RemoteControl.class);
        SettableRangedValue value = mock(SettableRangedValue.class);
        when(param.value()).thenReturn(value);
        when(remoteControls.getParameter(3)).thenReturn(param);

        JsonObject params = indexParam(3);
        params.addProperty("value", 1.5);

        handler.handle("setParameter", params);

        verify(value).setImmediately(1.0);
    }

    @Test
    void setParameter_indexOutsideZeroToSeven_throws() {
        cursorDeviceExists(true);

        JsonObject params = indexParam(8);
        params.addProperty("value", 0.5);

        Exception e = assertThrows(IllegalArgumentException.class,
                () -> handler.handle("setParameter", params));
        assertTrue(e.getMessage().contains("0-7"));
    }

    @Test
    void setParameter_noCursorDevice_throwsBeforeTouchingIndex() {
        cursorDeviceExists(false);

        JsonObject params = indexParam(0);
        params.addProperty("value", 0.5);

        assertThrows(IllegalArgumentException.class, () -> handler.handle("setParameter", params));
        verifyNoInteractions(remoteControls);
    }

    // --- listParameterPages / selectParameterPage ---

    @Test
    void listParameterPages_returnsNamesAndSelectedIndex() {
        cursorDeviceExists(true);
        StringArrayValue names = mock(StringArrayValue.class);
        SettableIntegerValue selected = mock(SettableIntegerValue.class);
        when(names.get()).thenReturn(new String[] {"OSC1", "FILTER"});
        when(selected.get()).thenReturn(1);
        when(remoteControls.pageNames()).thenReturn(names);
        when(remoteControls.selectedPageIndex()).thenReturn(selected);

        JsonObject result = handler.handle("listParameterPages", new JsonObject()).getAsJsonObject();

        assertEquals(2, result.get("count").getAsInt());
        assertEquals(1, result.get("selectedIndex").getAsInt());
        assertEquals("FILTER", result.getAsJsonArray("pages").get(1).getAsJsonObject().get("name").getAsString());
    }

    @Test
    void selectParameterPage_outOfRange_reportsPageCount() {
        cursorDeviceExists(true);
        StringArrayValue names = mock(StringArrayValue.class);
        when(names.get()).thenReturn(new String[] {"OSC1", "FILTER"});
        when(remoteControls.pageNames()).thenReturn(names);

        Exception e = assertThrows(IllegalArgumentException.class,
                () -> handler.handle("selectParameterPage", indexParam(5)));
        assertTrue(e.getMessage().contains("6"));
        assertTrue(e.getMessage().contains("2"));
    }

    @Test
    void selectParameterPage_valid_setsTheIndex() {
        cursorDeviceExists(true);
        StringArrayValue names = mock(StringArrayValue.class);
        SettableIntegerValue selected = mock(SettableIntegerValue.class);
        when(names.get()).thenReturn(new String[] {"OSC1", "FILTER", "AMP"});
        when(remoteControls.pageNames()).thenReturn(names);
        when(remoteControls.selectedPageIndex()).thenReturn(selected);

        handler.handle("selectParameterPage", indexParam(2));

        verify(selected).set(2);
    }
}
