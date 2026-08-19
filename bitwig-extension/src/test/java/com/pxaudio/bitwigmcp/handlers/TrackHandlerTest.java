package com.pxaudio.bitwigmcp.handlers;

import com.bitwig.extension.controller.api.*;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.pxaudio.bitwigmcp.BitwigMCPExtension;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Covers TrackHandler's own logic: existence validation before every
 * mutating call (getValidatedTrack), volume/pan clamping to 0-1, the
 * create-type dispatch table, and the setImmediately-not-set regression
 * guard (set() is silently discarded by the controller take-over strategy -
 * see DeviceHandler.setParameter for the same class of bug). Everything is
 * mocked; this doesn't touch a running Bitwig instance.
 *
 * Note: a stubbing helper (e.g. trackMissing()) must never be passed
 * directly as an argument to another mock's .thenReturn(...) - that leaves
 * the outer stub "open" while the helper's own when() call starts, which
 * throws Mockito's UnfinishedStubbingException (see ClipHandlerTest for the
 * full story). Always assign to a local variable first.
 */
class TrackHandlerTest {

    private BitwigMCPExtension extension;
    private TrackBank trackBank;
    private TrackHandler handler;

    @BeforeEach
    void setUp() {
        extension = mock(BitwigMCPExtension.class);
        trackBank = mock(TrackBank.class);
        when(extension.getTrackBank()).thenReturn(trackBank);

        handler = new TrackHandler(extension, mock(ControllerHost.class));
    }

    private Track trackExisting() {
        Track track = mock(Track.class);
        BooleanValue exists = mock(BooleanValue.class);
        when(exists.get()).thenReturn(true);
        when(track.exists()).thenReturn(exists);
        return track;
    }

    private Track trackMissing() {
        Track track = mock(Track.class);
        BooleanValue exists = mock(BooleanValue.class);
        when(exists.get()).thenReturn(false);
        when(track.exists()).thenReturn(exists);
        return track;
    }

    private static JsonObject indexParam(int index) {
        JsonObject params = new JsonObject();
        params.addProperty("index", index);
        return params;
    }

    // --- list ---

    @Test
    void list_onlyIncludesExistingTracks() {
        Track a = trackExisting();
        stubTrackFields(a, "Bass");
        Track b = trackMissing();
        Track c = trackExisting();
        stubTrackFields(c, "Drums");
        when(trackBank.getSizeOfBank()).thenReturn(3);
        when(trackBank.getItemAt(0)).thenReturn(a);
        when(trackBank.getItemAt(1)).thenReturn(b);
        when(trackBank.getItemAt(2)).thenReturn(c);

        JsonObject result = handler.handle("list", new JsonObject()).getAsJsonObject();

        assertEquals(2, result.get("count").getAsInt());
        JsonArray tracks = result.getAsJsonArray("tracks");
        assertEquals("Bass", tracks.get(0).getAsJsonObject().get("name").getAsString());
        assertEquals("Drums", tracks.get(1).getAsJsonObject().get("name").getAsString());
    }

    private void stubTrackFields(Track track, String name) {
        SettableStringValue nameValue = mock(SettableStringValue.class);
        when(nameValue.get()).thenReturn(name);
        when(track.name()).thenReturn(nameValue);
        StringValue trackType = mock(StringValue.class);
        when(track.trackType()).thenReturn(trackType);
        Parameter volume = mock(Parameter.class);
        when(track.volume()).thenReturn(volume);
        Parameter pan = mock(Parameter.class);
        when(track.pan()).thenReturn(pan);
        SettableBooleanValue mute = mock(SettableBooleanValue.class);
        when(track.mute()).thenReturn(mute);
        SoloValue solo = mock(SoloValue.class);
        when(track.solo()).thenReturn(solo);
        SettableBooleanValue arm = mock(SettableBooleanValue.class);
        when(track.arm()).thenReturn(arm);
        SettableColorValue color = mock(SettableColorValue.class);
        when(track.color()).thenReturn(color);
    }

    // --- get ---

    @Test
    void get_throwsWhenTrackDoesNotExist() {
        Track missing = trackMissing();
        when(trackBank.getItemAt(2)).thenReturn(missing);

        Exception e = assertThrows(IllegalArgumentException.class, () -> handler.handle("get", indexParam(2)));
        assertTrue(e.getMessage().contains("2"));
    }

    @Test
    void get_missingIndexParam_throws() {
        assertThrows(IllegalArgumentException.class, () -> handler.handle("get", new JsonObject()));
    }

    // --- create ---

    @Test
    void createTrack_dispatchesByType() {
        Application app = mock(Application.class);
        when(extension.getApplication()).thenReturn(app);

        JsonObject params = new JsonObject();
        params.addProperty("type", "audio");
        params.addProperty("position", 3);
        handler.handle("create", params);

        verify(app).createAudioTrack(3);
        verify(app, never()).createInstrumentTrack(anyInt());
    }

    @Test
    void createTrack_typeIsCaseInsensitive() {
        Application app = mock(Application.class);
        when(extension.getApplication()).thenReturn(app);

        JsonObject params = new JsonObject();
        params.addProperty("type", "FX");
        handler.handle("create", params);

        verify(app).createEffectTrack(-1); // default position
    }

    @Test
    void createTrack_defaultsToInstrumentAtTheEnd() {
        Application app = mock(Application.class);
        when(extension.getApplication()).thenReturn(app);

        handler.handle("create", new JsonObject());

        verify(app).createInstrumentTrack(-1);
    }

    @Test
    void createTrack_unknownType_throwsWithoutTouchingApplication() {
        Application app = mock(Application.class);
        when(extension.getApplication()).thenReturn(app);

        JsonObject params = new JsonObject();
        params.addProperty("type", "bogus");

        assertThrows(IllegalArgumentException.class, () -> handler.handle("create", params));
        verifyNoInteractions(app);
    }

    // --- delete ---

    @Test
    void deleteTrack_removesAnExistingTrack() {
        Track track = trackExisting();
        when(trackBank.getItemAt(0)).thenReturn(track);

        handler.handle("delete", indexParam(0));

        verify(track).deleteObject();
    }

    @Test
    void deleteTrack_throwsWhenTrackDoesNotExist() {
        Track missing = trackMissing();
        when(trackBank.getItemAt(4)).thenReturn(missing);

        assertThrows(IllegalArgumentException.class, () -> handler.handle("delete", indexParam(4)));
    }

    // --- setName / setVolume / setPan / setMute / setSolo / setArm / select ---

    @Test
    void setName_throwsWhenTrackDoesNotExist() {
        Track missing = trackMissing();
        when(trackBank.getItemAt(0)).thenReturn(missing);

        JsonObject params = indexParam(0);
        params.addProperty("name", "Bass");
        assertThrows(IllegalArgumentException.class, () -> handler.handle("setName", params));
    }

    @Test
    void setName_setsTheNameOnAnExistingTrack() {
        Track track = trackExisting();
        when(trackBank.getItemAt(0)).thenReturn(track);
        SettableStringValue settableName = mock(SettableStringValue.class);
        when(track.name()).thenReturn(settableName);

        JsonObject params = indexParam(0);
        params.addProperty("name", "Bass");
        handler.handle("setName", params);

        verify(settableName).set("Bass");
    }

    @Test
    void setVolume_clampsAboveOneAndWritesImmediately() {
        Track track = trackExisting();
        Parameter volume = mock(Parameter.class);
        when(track.volume()).thenReturn(volume);
        when(trackBank.getItemAt(0)).thenReturn(track);

        JsonObject params = indexParam(0);
        params.addProperty("volume", 1.5);
        handler.handle("setVolume", params);

        verify(volume).setImmediately(1.0);
        verify(volume, never()).set(anyDouble());
    }

    @Test
    void setVolume_clampsBelowZero() {
        Track track = trackExisting();
        Parameter volume = mock(Parameter.class);
        when(track.volume()).thenReturn(volume);
        when(trackBank.getItemAt(0)).thenReturn(track);

        JsonObject params = indexParam(0);
        params.addProperty("volume", -0.3);
        handler.handle("setVolume", params);

        verify(volume).setImmediately(0.0);
    }

    @Test
    void setPan_writesImmediatelyWithinRange() {
        Track track = trackExisting();
        Parameter pan = mock(Parameter.class);
        when(track.pan()).thenReturn(pan);
        when(trackBank.getItemAt(0)).thenReturn(track);

        JsonObject params = indexParam(0);
        params.addProperty("pan", 0.75);
        handler.handle("setPan", params);

        verify(pan).setImmediately(0.75);
        verify(pan, never()).set(anyDouble());
    }

    @Test
    void setMute_throwsWhenTrackDoesNotExist() {
        Track missing = trackMissing();
        when(trackBank.getItemAt(0)).thenReturn(missing);

        JsonObject params = indexParam(0);
        params.addProperty("mute", true);
        assertThrows(IllegalArgumentException.class, () -> handler.handle("setMute", params));
    }

    @Test
    void setMute_setsTheValue() {
        Track track = trackExisting();
        SettableBooleanValue mute = mock(SettableBooleanValue.class);
        when(track.mute()).thenReturn(mute);
        when(trackBank.getItemAt(0)).thenReturn(track);

        JsonObject params = indexParam(0);
        params.addProperty("mute", true);
        handler.handle("setMute", params);

        verify(mute).set(true);
    }

    @Test
    void setSolo_setsTheValue() {
        Track track = trackExisting();
        SoloValue solo = mock(SoloValue.class);
        when(track.solo()).thenReturn(solo);
        when(trackBank.getItemAt(0)).thenReturn(track);

        JsonObject params = indexParam(0);
        params.addProperty("solo", true);
        handler.handle("setSolo", params);

        verify(solo).set(true);
    }

    @Test
    void setArm_setsTheValue() {
        Track track = trackExisting();
        SettableBooleanValue arm = mock(SettableBooleanValue.class);
        when(track.arm()).thenReturn(arm);
        when(trackBank.getItemAt(0)).thenReturn(track);

        JsonObject params = indexParam(0);
        params.addProperty("arm", false);
        handler.handle("setArm", params);

        verify(arm).set(false);
    }

    @Test
    void select_selectsAnExistingTrackInTheMixer() {
        Track track = trackExisting();
        when(trackBank.getItemAt(0)).thenReturn(track);

        handler.handle("select", indexParam(0));

        verify(track).selectInMixer();
    }

    @Test
    void select_throwsWhenTrackDoesNotExist() {
        Track missing = trackMissing();
        when(trackBank.getItemAt(0)).thenReturn(missing);

        assertThrows(IllegalArgumentException.class, () -> handler.handle("select", indexParam(0)));
    }

    // --- unknown action ---

    @Test
    void unknownAction_throws() {
        assertThrows(IllegalArgumentException.class, () -> handler.handle("notARealAction", new JsonObject()));
    }
}
