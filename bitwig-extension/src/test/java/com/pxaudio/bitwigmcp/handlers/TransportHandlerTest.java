package com.pxaudio.bitwigmcp.handlers;

import com.bitwig.extension.controller.api.*;
import com.google.gson.JsonObject;
import com.pxaudio.bitwigmcp.BitwigMCPExtension;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Covers TransportHandler's branching: togglePlay flips based on current
 * state, setPosition's required-param check, and the unknown-action path.
 * Mocked; doesn't touch a running Bitwig instance.
 */
class TransportHandlerTest {

    private BitwigMCPExtension extension;
    private Transport transport;
    private TransportHandler handler;

    @BeforeEach
    void setUp() {
        extension = mock(BitwigMCPExtension.class);
        transport = mock(Transport.class);
        when(extension.getTransport()).thenReturn(transport);

        handler = new TransportHandler(extension, mock(ControllerHost.class));
    }

    @Test
    void togglePlay_callsPlayWhenCurrentlyStopped() {
        SettableBooleanValue isPlaying = mock(SettableBooleanValue.class);
        when(isPlaying.get()).thenReturn(false);
        when(transport.isPlaying()).thenReturn(isPlaying);

        handler.handle("togglePlay", new JsonObject());

        verify(transport).play();
        verify(transport, never()).stop();
    }

    @Test
    void togglePlay_callsStopWhenCurrentlyPlaying() {
        SettableBooleanValue isPlaying = mock(SettableBooleanValue.class);
        when(isPlaying.get()).thenReturn(true);
        when(transport.isPlaying()).thenReturn(isPlaying);

        handler.handle("togglePlay", new JsonObject());

        verify(transport).stop();
        verify(transport, never()).play();
    }

    @Test
    void toggleRecord_togglesArrangerRecordEnabled() {
        SettableBooleanValue recording = mock(SettableBooleanValue.class);
        when(transport.isArrangerRecordEnabled()).thenReturn(recording);

        handler.handle("toggleRecord", new JsonObject());

        verify(recording).toggle();
    }

    @Test
    void setPosition_missingBeatsParam_throws() {
        assertThrows(IllegalArgumentException.class, () -> handler.handle("setPosition", new JsonObject()));
        verifyNoInteractions(transport);
    }

    @Test
    void setPosition_setsTheTransportPosition() {
        JsonObject params = new JsonObject();
        params.addProperty("beats", 16.0);

        handler.handle("setPosition", params);

        verify(transport).setPosition(16.0);
    }

    @Test
    void getStatus_reportsAllThreeFields() {
        SettableBooleanValue isPlaying = mock(SettableBooleanValue.class);
        when(isPlaying.get()).thenReturn(true);
        when(transport.isPlaying()).thenReturn(isPlaying);
        SettableBooleanValue recording = mock(SettableBooleanValue.class);
        when(recording.get()).thenReturn(false);
        when(transport.isArrangerRecordEnabled()).thenReturn(recording);
        SettableBeatTimeValue position = mock(SettableBeatTimeValue.class);
        when(position.get()).thenReturn(4.5);
        when(transport.getPosition()).thenReturn(position);

        JsonObject result = handler.handle("getStatus", new JsonObject()).getAsJsonObject();

        assertTrue(result.get("isPlaying").getAsBoolean());
        assertFalse(result.get("isRecording").getAsBoolean());
        assertEquals(4.5, result.get("position").getAsDouble());
    }

    @Test
    void unknownAction_throws() {
        assertThrows(IllegalArgumentException.class, () -> handler.handle("bogus", new JsonObject()));
    }
}
