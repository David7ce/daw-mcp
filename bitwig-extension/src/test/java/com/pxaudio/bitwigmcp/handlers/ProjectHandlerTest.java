package com.pxaudio.bitwigmcp.handlers;

import com.bitwig.extension.controller.api.*;
import com.google.gson.JsonObject;
import com.pxaudio.bitwigmcp.BitwigMCPExtension;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Covers ProjectHandler's only real logic: the tempo normalization formula
 * (Bitwig stores tempo as 0-1, representing 20-666 BPM). Everything else is
 * a straight-line field read. Mocked; doesn't touch a running Bitwig
 * instance.
 */
class ProjectHandlerTest {

    private BitwigMCPExtension extension;
    private Transport transport;
    private ProjectHandler handler;

    @BeforeEach
    void setUp() {
        extension = mock(BitwigMCPExtension.class);
        transport = mock(Transport.class);
        when(extension.getTransport()).thenReturn(transport);

        handler = new ProjectHandler(extension, mock(ControllerHost.class));
    }

    private void stubTransport(double normalizedTempo, String timeSignature, boolean isPlaying, boolean isRecording, double position) {
        Parameter tempo = mock(Parameter.class);
        when(tempo.get()).thenReturn(normalizedTempo);
        when(transport.tempo()).thenReturn(tempo);

        TimeSignatureValue sig = mock(TimeSignatureValue.class);
        when(sig.get()).thenReturn(timeSignature);
        when(transport.timeSignature()).thenReturn(sig);

        SettableBooleanValue playing = mock(SettableBooleanValue.class);
        when(playing.get()).thenReturn(isPlaying);
        when(transport.isPlaying()).thenReturn(playing);

        SettableBooleanValue recording = mock(SettableBooleanValue.class);
        when(recording.get()).thenReturn(isRecording);
        when(transport.isArrangerRecordEnabled()).thenReturn(recording);

        SettableBeatTimeValue pos = mock(SettableBeatTimeValue.class);
        when(pos.get()).thenReturn(position);
        when(transport.getPosition()).thenReturn(pos);
    }

    @Test
    void getInfo_convertsNormalizedTempoZeroToTwentyBpm() {
        stubTransport(0.0, "4/4", false, false, 0.0);

        JsonObject result = handler.handle("getInfo", new JsonObject()).getAsJsonObject();

        assertEquals(20.0, result.get("bpm").getAsDouble());
    }

    @Test
    void getInfo_convertsNormalizedTempoOneToSixSixSixBpm() {
        stubTransport(1.0, "4/4", false, false, 0.0);

        JsonObject result = handler.handle("getInfo", new JsonObject()).getAsJsonObject();

        assertEquals(666.0, result.get("bpm").getAsDouble());
    }

    @Test
    void getInfo_convertsNormalizedTempoAtMidpoint() {
        // 0.5 -> halfway between 20 and 666
        stubTransport(0.5, "4/4", true, true, 8.0);

        JsonObject result = handler.handle("getInfo", new JsonObject()).getAsJsonObject();

        assertEquals(343.0, result.get("bpm").getAsDouble());
        assertEquals("4/4", result.get("timeSignature").getAsString());
        assertTrue(result.get("isPlaying").getAsBoolean());
        assertTrue(result.get("isRecording").getAsBoolean());
        assertEquals(8.0, result.get("playbackPosition").getAsDouble());
    }

    @Test
    void unknownAction_throws() {
        assertThrows(IllegalArgumentException.class, () -> handler.handle("bogus", new JsonObject()));
    }
}
