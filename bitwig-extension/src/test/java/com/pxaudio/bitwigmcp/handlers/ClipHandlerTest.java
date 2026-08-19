package com.pxaudio.bitwigmcp.handlers;

import com.bitwig.extension.controller.api.*;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.pxaudio.bitwigmcp.BitwigMCPExtension;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Covers ClipHandler's own logic: beat<->step unit conversion (x/dx are
 * beats on the wire but Bitwig's API takes step indices - this was a real
 * bug once, see CLAUDE.md), bounds-checking, and the iteration/filtering in
 * getNotes/clearNotesAtPitch/findEmptySlots. Pure one-line delegation
 * (setClipName, transposeClip, stopClip, setClipLength) isn't covered here -
 * there's no logic in them to break. Everything is mocked; this doesn't
 * touch a running Bitwig instance.
 */
class ClipHandlerTest {

    private BitwigMCPExtension extension;
    private TrackBank trackBank;
    private Clip cursorClip;
    private ClipHandler handler;

    private static final double STEP_SIZE = 0.25; // gridResolution=16

    @BeforeEach
    void setUp() {
        extension = mock(BitwigMCPExtension.class);
        trackBank = mock(TrackBank.class);
        cursorClip = mock(Clip.class);

        when(extension.getTrackBank()).thenReturn(trackBank);
        when(extension.getCursorClip()).thenReturn(cursorClip);
        when(extension.getStepSize()).thenReturn(STEP_SIZE);
        when(extension.getClipSteps()).thenReturn(512);
        when(extension.getClipKeys()).thenReturn(128);

        handler = new ClipHandler(extension, mock(ControllerHost.class));
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

    private ClipLauncherSlot slotWithContent(ClipLauncherSlotBank bank, int index, boolean hasContent) {
        ClipLauncherSlot slot = mock(ClipLauncherSlot.class);
        BooleanValue has = mock(BooleanValue.class);
        when(has.get()).thenReturn(hasContent);
        when(slot.hasContent()).thenReturn(has);
        when(bank.getItemAt(index)).thenReturn(slot);
        return slot;
    }

    private static JsonObject trackSlotParams(int trackIndex, int slotIndex) {
        JsonObject params = new JsonObject();
        params.addProperty("trackIndex", trackIndex);
        params.addProperty("slotIndex", slotIndex);
        return params;
    }

    private NoteStep noteOnStep() {
        NoteStep step = mock(NoteStep.class);
        when(step.state()).thenReturn(NoteStep.State.NoteOn);
        return step;
    }

    private NoteStep emptyStep() {
        NoteStep step = mock(NoteStep.class);
        when(step.state()).thenReturn(NoteStep.State.Empty);
        return step;
    }

    // --- listClips ---

    @Test
    void listClips_throwsWhenTrackDoesNotExist() {
        Track missing = trackMissing();
        when(trackBank.getItemAt(3)).thenReturn(missing);

        JsonObject params = new JsonObject();
        params.addProperty("trackIndex", 3);

        Exception e = assertThrows(IllegalArgumentException.class, () -> handler.handle("list", params));
        assertTrue(e.getMessage().contains("3"));
    }

    @Test
    void listClips_onlyIncludesSlotsWithContent() {
        Track track = trackExisting();
        ClipLauncherSlotBank slotBank = mock(ClipLauncherSlotBank.class);
        when(track.clipLauncherSlotBank()).thenReturn(slotBank);
        when(slotBank.getSizeOfBank()).thenReturn(3);
        when(trackBank.getItemAt(0)).thenReturn(track);

        slotFilled(slotBank, 0, "Intro");
        slotWithContent(slotBank, 1, false);
        slotFilled(slotBank, 2, "Verse");

        JsonObject params = new JsonObject();
        params.addProperty("trackIndex", 0);
        JsonObject result = handler.handle("list", params).getAsJsonObject();

        assertEquals(2, result.get("count").getAsInt());
        JsonArray clips = result.getAsJsonArray("clips");
        assertEquals("Intro", clips.get(0).getAsJsonObject().get("name").getAsString());
        assertEquals("Verse", clips.get(1).getAsJsonObject().get("name").getAsString());
    }

    private void slotFilled(ClipLauncherSlotBank bank, int index, String name) {
        ClipLauncherSlot slot = slotWithContent(bank, index, true);
        StringValue nameValue = mock(StringValue.class);
        when(nameValue.get()).thenReturn(name);
        when(slot.name()).thenReturn(nameValue);
        BooleanValue playing = mock(BooleanValue.class);
        BooleanValue recording = mock(BooleanValue.class);
        BooleanValue queued = mock(BooleanValue.class);
        when(slot.isPlaying()).thenReturn(playing);
        when(slot.isRecording()).thenReturn(recording);
        when(slot.isPlaybackQueued()).thenReturn(queued);
        SettableColorValue color = mock(SettableColorValue.class);
        when(slot.color()).thenReturn(color);
    }

    // --- createClip ---

    @Test
    void createClip_throwsWhenTrackDoesNotExist() {
        Track missing = trackMissing();
        when(trackBank.getItemAt(1)).thenReturn(missing);

        JsonObject params = trackSlotParams(1, 0);
        assertThrows(IllegalArgumentException.class, () -> handler.handle("create", params));
    }

    @Test
    void createClip_defaultsLengthToFourBeats() {
        Track track = trackExisting();
        when(trackBank.getItemAt(0)).thenReturn(track);

        handler.handle("create", trackSlotParams(0, 2));

        verify(track).createNewLauncherClip(2, 4);
    }

    @Test
    void createClip_usesProvidedLength() {
        Track track = trackExisting();
        when(trackBank.getItemAt(0)).thenReturn(track);

        JsonObject params = trackSlotParams(0, 2);
        params.addProperty("lengthInBeats", 8);
        handler.handle("create", params);

        verify(track).createNewLauncherClip(2, 8);
    }

    // --- getNotes ---

    @Test
    void getNotes_noSelection_returnsEmptyWithoutTouchingTheClip() {
        when(extension.getSelectedTrackIndex()).thenReturn(-1);
        when(extension.getSelectedSlotIndex()).thenReturn(-1);

        JsonObject result = handler.handle("getNotes", new JsonObject()).getAsJsonObject();

        assertEquals(0, result.get("count").getAsInt());
        assertTrue(result.get("empty").getAsBoolean());
        verifyNoInteractions(cursorClip);
    }

    @Test
    void getNotes_selectedSlotEmpty_returnsEmpty() {
        when(extension.getSelectedTrackIndex()).thenReturn(0);
        when(extension.getSelectedSlotIndex()).thenReturn(1);
        CursorTrack cursorTrack = mock(CursorTrack.class);
        ClipLauncherSlotBank slotBank = mock(ClipLauncherSlotBank.class);
        when(extension.getCursorTrack()).thenReturn(cursorTrack);
        when(cursorTrack.clipLauncherSlotBank()).thenReturn(slotBank);
        slotWithContent(slotBank, 1, false);

        JsonObject result = handler.handle("getNotes", new JsonObject()).getAsJsonObject();

        assertTrue(result.get("empty").getAsBoolean());
    }

    @Test
    void getNotes_convertsStepIndexBackToBeatsAndCapsToConfiguredSteps() {
        when(extension.getSelectedTrackIndex()).thenReturn(0);
        when(extension.getSelectedSlotIndex()).thenReturn(0);
        when(extension.getClipSteps()).thenReturn(4); // cap lower than clip length
        when(extension.getClipKeys()).thenReturn(1);  // only check y=0 to keep this cheap
        CursorTrack cursorTrack = mock(CursorTrack.class);
        ClipLauncherSlotBank slotBank = mock(ClipLauncherSlotBank.class);
        when(extension.getCursorTrack()).thenReturn(cursorTrack);
        when(cursorTrack.clipLauncherSlotBank()).thenReturn(slotBank);
        slotWithContent(slotBank, 0, true);

        SettableBeatTimeValue loopLength = mock(SettableBeatTimeValue.class);
        when(loopLength.get()).thenReturn(16.0); // 64 steps at 0.25, but capped to 4
        when(cursorClip.getLoopLength()).thenReturn(loopLength);

        NoteStep hit = noteOnStep();
        when(hit.x()).thenReturn(2);
        when(hit.y()).thenReturn(60);
        NoteStep empty = emptyStep();
        when(cursorClip.getStep(0, 2, 0)).thenReturn(hit);
        when(cursorClip.getStep(eq(0), intThat(x -> x != 2), eq(0))).thenReturn(empty);

        JsonObject result = handler.handle("getNotes", new JsonObject()).getAsJsonObject();

        assertEquals(1, result.get("count").getAsInt());
        JsonArray notes = result.getAsJsonArray("notes");
        assertEquals(0.5, notes.get(0).getAsJsonObject().get("x").getAsDouble()); // step 2 * 0.25
        verify(cursorClip, never()).getStep(anyInt(), intThat(x -> x >= 4), anyInt());
    }

    // --- setNote / clearNote: beat -> step conversion ---

    @Test
    void setNote_convertsBeatPositionToStepIndex() {
        JsonObject params = new JsonObject();
        params.addProperty("x", 1.0); // beat 1.0 -> step 4 at stepSize 0.25
        params.addProperty("y", 60);
        params.addProperty("velocity", 100);
        params.addProperty("duration", 0.5);

        handler.handle("setNote", params);

        verify(cursorClip).setStep(0, 4, 60, 100, 0.5);
    }

    @Test
    void setNote_roundsFractionalStepsAndAppliesDefaults() {
        JsonObject params = new JsonObject();
        params.addProperty("x", 0.26); // -> step 1.04 rounds to step 1
        params.addProperty("y", 60);

        handler.handle("setNote", params);

        verify(cursorClip).setStep(0, 1, 60, 100, 0.25); // default velocity 100, duration 0.25
    }

    @Test
    void clearNote_convertsBeatPositionToStepIndex() {
        JsonObject params = new JsonObject();
        params.addProperty("x", 2.0); // -> step 8
        params.addProperty("y", 64);

        handler.handle("clearNote", params);

        verify(cursorClip).clearStep(0, 8, 64);
    }

    // --- clearNotesAtPitch ---

    @Test
    void clearNotesAtPitch_onlyClearsStepsThatAreActuallyOn() {
        when(extension.getClipSteps()).thenReturn(3);
        SettableBeatTimeValue loopLength = mock(SettableBeatTimeValue.class);
        when(loopLength.get()).thenReturn(0.75); // 3 steps at 0.25
        when(cursorClip.getLoopLength()).thenReturn(loopLength);

        NoteStep hitAtZero = noteOnStep();
        NoteStep emptyAtOne = emptyStep();
        NoteStep hitAtTwo = noteOnStep();
        when(cursorClip.getStep(0, 0, 60)).thenReturn(hitAtZero);
        when(cursorClip.getStep(0, 1, 60)).thenReturn(emptyAtOne);
        when(cursorClip.getStep(0, 2, 60)).thenReturn(hitAtTwo);

        JsonObject params = new JsonObject();
        params.addProperty("pitch", 60);
        handler.handle("clearNotesAtPitch", params);

        verify(cursorClip).clearStep(0, 0, 60);
        verify(cursorClip, never()).clearStep(0, 1, 60);
        verify(cursorClip).clearStep(0, 2, 60);
    }

    // --- setNoteProperty dispatch ---

    @Test
    void setNoteVelocity_writesToTheStepAtTheConvertedIndex() {
        NoteStep step = mock(NoteStep.class);
        when(cursorClip.getStep(0, 4, 60)).thenReturn(step);

        JsonObject params = new JsonObject();
        params.addProperty("x", 1.0); // -> step 4
        params.addProperty("y", 60);
        params.addProperty("value", 0.8);
        handler.handle("setNoteVelocity", params);

        verify(step).setVelocity(0.8);
    }

    @Test
    void setNoteChance_alsoEnablesChance() {
        NoteStep step = mock(NoteStep.class);
        when(cursorClip.getStep(0, 0, 60)).thenReturn(step);

        JsonObject params = new JsonObject();
        params.addProperty("x", 0.0);
        params.addProperty("y", 60);
        params.addProperty("value", 0.5);
        handler.handle("setNoteChance", params);

        verify(step).setChance(0.5);
        verify(step).setIsChanceEnabled(true);
    }

    // --- moveNote ---

    @Test
    void moveNote_convertsBothXAndDxFromBeatsToSteps() {
        JsonObject params = new JsonObject();
        params.addProperty("x", 1.0);  // step 4
        params.addProperty("y", 60);
        params.addProperty("dx", 0.5); // step 2
        params.addProperty("dy", -12);

        handler.handle("moveNote", params);

        verify(cursorClip).moveStep(0, 4, 60, 2, -12);
    }

    @Test
    void moveNote_defaultsDxAndDyToZero() {
        JsonObject params = new JsonObject();
        params.addProperty("x", 0.0);
        params.addProperty("y", 60);

        handler.handle("moveNote", params);

        verify(cursorClip).moveStep(0, 0, 60, 0, 0);
    }

    // --- hasContent ---

    @Test
    void hasContent_throwsWhenTrackDoesNotExist() {
        Track missing = trackMissing();
        when(trackBank.getItemAt(0)).thenReturn(missing);
        assertThrows(IllegalArgumentException.class, () -> handler.handle("hasContent", trackSlotParams(0, 0)));
    }

    @Test
    void hasContent_reportsTheSlotsContentFlag() {
        Track track = trackExisting();
        ClipLauncherSlotBank slotBank = mock(ClipLauncherSlotBank.class);
        when(track.clipLauncherSlotBank()).thenReturn(slotBank);
        when(trackBank.getItemAt(0)).thenReturn(track);
        slotWithContent(slotBank, 3, true);

        JsonObject result = handler.handle("hasContent", trackSlotParams(0, 3)).getAsJsonObject();

        assertTrue(result.get("hasContent").getAsBoolean());
    }

    // --- findEmptySlots ---

    @Test
    void findEmptySlots_throwsWhenTrackDoesNotExist() {
        Track missing = trackMissing();
        when(trackBank.getItemAt(0)).thenReturn(missing);
        JsonObject params = new JsonObject();
        params.addProperty("trackIndex", 0);
        params.addProperty("startSlot", 0);
        assertThrows(IllegalArgumentException.class, () -> handler.handle("findEmptySlots", params));
    }

    @Test
    void findEmptySlots_stopsAtRequestedCountAndProjectSceneBound() {
        Track track = trackExisting();
        ClipLauncherSlotBank slotBank = mock(ClipLauncherSlotBank.class);
        when(track.clipLauncherSlotBank()).thenReturn(slotBank);
        when(trackBank.getItemAt(0)).thenReturn(track);
        when(extension.getSceneCount()).thenReturn(5); // bound below the naive bank size

        // slots 0,1,2,3,4 - 0 filled, 1-4 empty
        slotWithContent(slotBank, 0, true);
        for (int i = 1; i < 6; i++) {
            slotWithContent(slotBank, i, false); // slot 5 exists but is out of scene bound
        }

        JsonObject params = new JsonObject();
        params.addProperty("trackIndex", 0);
        params.addProperty("startSlot", 0);
        params.addProperty("count", 2);

        JsonObject result = handler.handle("findEmptySlots", params).getAsJsonObject();

        JsonArray empty = result.getAsJsonArray("emptySlots");
        assertEquals(2, empty.size());
        assertEquals(1, empty.get(0).getAsInt());
        assertEquals(2, empty.get(1).getAsInt());
        verify(slotBank, never()).getItemAt(5); // never looked past sceneCount
    }

    // --- createScene ---

    @Test
    void createScene_createsRequestedCountAndReportsNewTotal() {
        Project project = mock(Project.class);
        when(extension.getProject()).thenReturn(project);
        when(extension.getSceneCount()).thenReturn(6);

        JsonObject params = new JsonObject();
        params.addProperty("count", 3);
        JsonObject result = handler.handle("createScene", params).getAsJsonObject();

        verify(project, times(3)).createScene();
        assertEquals(3, result.get("created").getAsInt());
        assertEquals(6, result.get("sceneCount").getAsInt());
    }

    @Test
    void createScene_defaultsToOne() {
        Project project = mock(Project.class);
        when(extension.getProject()).thenReturn(project);

        handler.handle("createScene", new JsonObject());

        verify(project, times(1)).createScene();
    }

    // --- unknown action ---

    @Test
    void unknownAction_throws() {
        assertThrows(IllegalArgumentException.class, () -> handler.handle("notARealAction", new JsonObject()));
    }
}
