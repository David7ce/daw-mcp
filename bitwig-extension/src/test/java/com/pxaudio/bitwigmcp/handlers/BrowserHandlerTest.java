package com.pxaudio.bitwigmcp.handlers;

import com.bitwig.extension.controller.api.*;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.pxaudio.bitwigmcp.BitwigMCPExtension;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Covers BrowserHandler's session state machine (open/setContentType/
 * setFilter/getResults/select/commit/cancel/getState) - the validation,
 * mode dispatch, and stale-session handling around the Bitwig API calls.
 * Everything here is mocked; it doesn't touch a running Bitwig instance.
 */
class BrowserHandlerTest {

    private static final String[] FILTER_COLUMNS = {
        "category", "creator", "tag", "device", "deviceType", "fileType", "location", "smartCollection"
    };

    private BitwigMCPExtension extension;
    private CursorTrack cursorTrack;
    private CursorDevice cursorDevice;
    private DeviceBank deviceBank;
    private PopupBrowser popupBrowser;
    private BrowserResultsItemBank browserResults;
    private BrowserHandler handler;

    @BeforeEach
    void setUp() {
        extension = mock(BitwigMCPExtension.class);
        cursorTrack = mock(CursorTrack.class);
        cursorDevice = mock(CursorDevice.class);
        deviceBank = mock(DeviceBank.class);
        popupBrowser = mock(PopupBrowser.class);
        browserResults = mock(BrowserResultsItemBank.class);

        when(extension.getCursorTrack()).thenReturn(cursorTrack);
        when(extension.getCursorDevice()).thenReturn(cursorDevice);
        when(extension.getDeviceBank()).thenReturn(deviceBank);
        when(extension.getPopupBrowser()).thenReturn(popupBrowser);
        when(extension.getBrowserResults()).thenReturn(browserResults);

        browserExists(false);
        handler = new BrowserHandler(extension, mock(ControllerHost.class));
    }

    private void browserExists(boolean value) {
        BooleanValue exists = mock(BooleanValue.class);
        when(exists.get()).thenReturn(value);
        when(popupBrowser.exists()).thenReturn(exists);
    }

    private void cursorDeviceExists(boolean value) {
        BooleanValue exists = mock(BooleanValue.class);
        when(exists.get()).thenReturn(value);
        when(cursorDevice.exists()).thenReturn(exists);
    }

    /** Stubs all 8 filter columns with a wildcard item; returns each wildcard's isSelected mock. */
    private Map<String, SettableBooleanValue> stubAllFilterColumns() {
        Map<String, SettableBooleanValue> wildcards = new LinkedHashMap<>();
        for (String column : FILTER_COLUMNS) {
            wildcards.put(column, stubFilterColumn(column));
        }
        return wildcards;
    }

    /** Stubs the named PopupBrowser column with a fresh wildcard item; returns its isSelected mock. */
    private SettableBooleanValue stubFilterColumn(String columnName) {
        BrowserFilterColumn column = mock(BrowserFilterColumn.class);
        BrowserFilterItem wildcard = mock(BrowserFilterItem.class);
        SettableBooleanValue isSelected = mock(SettableBooleanValue.class);
        when(wildcard.isSelected()).thenReturn(isSelected);
        when(column.getWildcardItem()).thenReturn(wildcard);

        switch (columnName) {
            case "category":        when(popupBrowser.categoryColumn()).thenReturn(column); break;
            case "creator":         when(popupBrowser.creatorColumn()).thenReturn(column); break;
            case "tag":              when(popupBrowser.tagColumn()).thenReturn(column); break;
            case "device":           when(popupBrowser.deviceColumn()).thenReturn(column); break;
            case "deviceType":       when(popupBrowser.deviceTypeColumn()).thenReturn(column); break;
            case "fileType":         when(popupBrowser.fileTypeColumn()).thenReturn(column); break;
            case "location":         when(popupBrowser.locationColumn()).thenReturn(column); break;
            case "smartCollection":  when(popupBrowser.smartCollectionColumn()).thenReturn(column); break;
            default: throw new IllegalArgumentException("Unknown filter column: " + columnName);
        }
        return isSelected;
    }

    private static JsonObject params() {
        return new JsonObject();
    }

    private static JsonObject indexParam(int index) {
        JsonObject params = new JsonObject();
        params.addProperty("index", index);
        return params;
    }

    // --- open ---

    @Test
    void open_cancelsStaleSessionBeforeBrowsing() {
        browserExists(true);
        InsertionPoint insertionPoint = mock(InsertionPoint.class);
        when(cursorTrack.endOfDeviceChainInsertionPoint()).thenReturn(insertionPoint);
        stubAllFilterColumns();

        handler.handle("open", params());

        InOrder order = inOrder(popupBrowser, insertionPoint);
        order.verify(popupBrowser).cancel();
        order.verify(insertionPoint).browse();
    }

    @Test
    void open_defaultMode_browsesEndOfDeviceChain() {
        InsertionPoint insertionPoint = mock(InsertionPoint.class);
        when(cursorTrack.endOfDeviceChainInsertionPoint()).thenReturn(insertionPoint);
        stubAllFilterColumns();

        JsonElement result = handler.handle("open", params());

        verify(insertionPoint).browse();
        assertTrue(result.getAsJsonObject().get("success").getAsBoolean());
    }

    @Test
    void open_resetsEveryFilterColumnToWildcard() {
        when(cursorTrack.endOfDeviceChainInsertionPoint()).thenReturn(mock(InsertionPoint.class));
        Map<String, SettableBooleanValue> wildcards = stubAllFilterColumns();

        handler.handle("open", params());

        for (String column : FILTER_COLUMNS) {
            verify(wildcards.get(column)).set(true);
        }
    }

    @Test
    void open_modePosition_outOfRange_throws() {
        when(deviceBank.getSizeOfBank()).thenReturn(4);

        JsonObject p = params();
        p.addProperty("mode", "position");
        p.addProperty("position", 4);

        assertThrows(IllegalArgumentException.class, () -> handler.handle("open", p));
    }

    @Test
    void open_modePosition_pastEndOfChain_throws() {
        when(deviceBank.getSizeOfBank()).thenReturn(4);
        Device priorDevice = mock(Device.class);
        BooleanValue exists = mock(BooleanValue.class);
        when(exists.get()).thenReturn(false);
        when(priorDevice.exists()).thenReturn(exists);
        when(deviceBank.getDevice(1)).thenReturn(priorDevice);

        JsonObject p = params();
        p.addProperty("mode", "position");
        p.addProperty("position", 2);

        Exception e = assertThrows(IllegalArgumentException.class, () -> handler.handle("open", p));
        assertTrue(e.getMessage().contains("past the end"));
    }

    @Test
    void open_modePosition_valid_browsesToInsertDevice() {
        when(deviceBank.getSizeOfBank()).thenReturn(4);
        stubAllFilterColumns();

        JsonObject p = params();
        p.addProperty("mode", "position");
        p.addProperty("position", 0);

        handler.handle("open", p);

        verify(deviceBank).browseToInsertDevice(0);
    }

    @Test
    void open_modeReplace_noCursorDevice_throws() {
        cursorDeviceExists(false);

        JsonObject p = params();
        p.addProperty("mode", "replace");

        Exception e = assertThrows(IllegalArgumentException.class, () -> handler.handle("open", p));
        assertTrue(e.getMessage().contains("No device selected"));
    }

    @Test
    void open_modeReplace_valid_browsesReplaceInsertionPoint() {
        cursorDeviceExists(true);
        InsertionPoint insertionPoint = mock(InsertionPoint.class);
        when(cursorDevice.replaceDeviceInsertionPoint()).thenReturn(insertionPoint);
        stubAllFilterColumns();

        JsonObject p = params();
        p.addProperty("mode", "replace");

        handler.handle("open", p);

        verify(insertionPoint).browse();
    }

    @Test
    void open_unknownMode_throws() {
        JsonObject p = params();
        p.addProperty("mode", "bogus");

        assertThrows(IllegalArgumentException.class, () -> handler.handle("open", p));
    }

    // --- setContentType ---

    @Test
    void setContentType_requiresOpenBrowser() {
        browserExists(false);

        Exception e = assertThrows(IllegalArgumentException.class,
                () -> handler.handle("setContentType", indexParam(0)));
        assertTrue(e.getMessage().contains("No browser session open"));
    }

    @Test
    void setContentType_byIndex_outOfRange_throws() {
        browserExists(true);
        StringArrayValue names = mock(StringArrayValue.class);
        when(names.get()).thenReturn(new String[] {"Devices", "Presets"});
        when(popupBrowser.contentTypeNames()).thenReturn(names);

        assertThrows(IllegalArgumentException.class, () -> handler.handle("setContentType", indexParam(2)));
    }

    @Test
    void setContentType_byIndex_valid_setsIndex() {
        browserExists(true);
        StringArrayValue names = mock(StringArrayValue.class);
        SettableIntegerValue selected = mock(SettableIntegerValue.class);
        when(names.get()).thenReturn(new String[] {"Devices", "Presets"});
        when(popupBrowser.contentTypeNames()).thenReturn(names);
        when(popupBrowser.selectedContentTypeIndex()).thenReturn(selected);

        handler.handle("setContentType", indexParam(1));

        verify(selected).set(1);
    }

    @Test
    void setContentType_byName_unknown_listsValidNamesInError() {
        browserExists(true);
        StringArrayValue names = mock(StringArrayValue.class);
        when(names.get()).thenReturn(new String[] {"Devices", "Presets"});
        when(popupBrowser.contentTypeNames()).thenReturn(names);

        JsonObject p = params();
        p.addProperty("name", "Samples");

        Exception e = assertThrows(IllegalArgumentException.class, () -> handler.handle("setContentType", p));
        assertTrue(e.getMessage().contains("Devices"));
        assertTrue(e.getMessage().contains("Presets"));
    }

    @Test
    void setContentType_byName_caseInsensitiveMatch_setsIndex() {
        browserExists(true);
        StringArrayValue names = mock(StringArrayValue.class);
        SettableIntegerValue selected = mock(SettableIntegerValue.class);
        when(names.get()).thenReturn(new String[] {"Devices", "Presets"});
        when(popupBrowser.contentTypeNames()).thenReturn(names);
        when(popupBrowser.selectedContentTypeIndex()).thenReturn(selected);

        JsonObject p = params();
        p.addProperty("name", "presets");

        handler.handle("setContentType", p);

        verify(selected).set(1);
    }

    @Test
    void setContentType_missingIndexAndName_throws() {
        browserExists(true);
        StringArrayValue names = mock(StringArrayValue.class);
        when(names.get()).thenReturn(new String[] {"Devices", "Presets"});
        when(popupBrowser.contentTypeNames()).thenReturn(names);

        assertThrows(IllegalArgumentException.class, () -> handler.handle("setContentType", params()));
    }

    // --- setFilter ---

    @Test
    void setFilter_requiresOpenBrowser() {
        browserExists(false);

        JsonObject p = params();
        p.addProperty("column", "category");
        p.addProperty("value", "Bass");

        assertThrows(IllegalArgumentException.class, () -> handler.handle("setFilter", p));
    }

    @Test
    void setFilter_missingColumn_throws() {
        browserExists(true);

        assertThrows(IllegalArgumentException.class, () -> handler.handle("setFilter", params()));
    }

    @Test
    void setFilter_emptyValue_selectsWildcard() {
        browserExists(true);
        SettableBooleanValue wildcardSelected = stubFilterColumn("category");

        JsonObject p = params();
        p.addProperty("column", "category");

        handler.handle("setFilter", p);

        verify(wildcardSelected).set(true);
    }

    @Test
    void setFilter_caseInsensitiveMatch_selectsTheItem() {
        browserExists(true);
        BrowserFilterItemBank bank = mock(BrowserFilterItemBank.class);
        when(extension.getBrowserFilterBank("category")).thenReturn(bank);

        BrowserFilterItem match = mock(BrowserFilterItem.class);
        BooleanValue exists = mock(BooleanValue.class);
        StringValue name = mock(StringValue.class);
        SettableBooleanValue isSelected = mock(SettableBooleanValue.class);
        when(exists.get()).thenReturn(true);
        when(name.get()).thenReturn("Bass");
        when(match.exists()).thenReturn(exists);
        when(match.name()).thenReturn(name);
        when(match.isSelected()).thenReturn(isSelected);

        when(bank.getSizeOfBank()).thenReturn(1);
        when(bank.getItemAt(0)).thenReturn(match);

        JsonObject p = params();
        p.addProperty("column", "category");
        p.addProperty("value", "bass");

        handler.handle("setFilter", p);

        verify(isSelected).set(true);
    }

    @Test
    void setFilter_noMatch_throwsWithColumnAndValue() {
        browserExists(true);
        BrowserFilterItemBank bank = mock(BrowserFilterItemBank.class);
        when(extension.getBrowserFilterBank("category")).thenReturn(bank);
        when(bank.getSizeOfBank()).thenReturn(0);

        JsonObject p = params();
        p.addProperty("column", "category");
        p.addProperty("value", "Nonexistent");

        Exception e = assertThrows(IllegalArgumentException.class, () -> handler.handle("setFilter", p));
        assertTrue(e.getMessage().contains("Nonexistent"));
        assertTrue(e.getMessage().contains("category"));
    }

    // --- getResults ---

    @Test
    void getResults_requiresOpenBrowser() {
        browserExists(false);

        assertThrows(IllegalArgumentException.class, () -> handler.handle("getResults", params()));
    }

    @Test
    void getResults_skipsNonExistentAndReportsTotalCount() {
        browserExists(true);
        BrowserResultsColumn resultsColumn = mock(BrowserResultsColumn.class);
        IntegerValue entryCount = mock(IntegerValue.class);
        when(entryCount.get()).thenReturn(2284);
        when(resultsColumn.entryCount()).thenReturn(entryCount);
        when(popupBrowser.resultsColumn()).thenReturn(resultsColumn);

        BrowserResultsItem present = mock(BrowserResultsItem.class);
        BooleanValue presentExists = mock(BooleanValue.class);
        StringValue presentName = mock(StringValue.class);
        SettableBooleanValue presentSelected = mock(SettableBooleanValue.class);
        when(presentExists.get()).thenReturn(true);
        when(presentName.get()).thenReturn("Polysynth");
        when(presentSelected.get()).thenReturn(false);
        when(present.exists()).thenReturn(presentExists);
        when(present.name()).thenReturn(presentName);
        when(present.isSelected()).thenReturn(presentSelected);

        BrowserResultsItem absent = mock(BrowserResultsItem.class);
        BooleanValue absentExists = mock(BooleanValue.class);
        when(absentExists.get()).thenReturn(false);
        when(absent.exists()).thenReturn(absentExists);

        when(browserResults.getSizeOfBank()).thenReturn(2);
        when(browserResults.getItemAt(0)).thenReturn(present);
        when(browserResults.getItemAt(1)).thenReturn(absent);

        JsonObject result = handler.handle("getResults", params()).getAsJsonObject();

        assertEquals(1, result.get("count").getAsInt());
        assertEquals(2284, result.get("totalCount").getAsInt());
        assertEquals("Polysynth", result.getAsJsonArray("results").get(0).getAsJsonObject().get("name").getAsString());
    }

    // --- select ---

    @Test
    void selectResult_requiresOpenBrowser() {
        browserExists(false);

        assertThrows(IllegalArgumentException.class, () -> handler.handle("select", indexParam(0)));
    }

    @Test
    void selectResult_outOfBounds_reportsOneBasedIndex() {
        browserExists(true);
        when(browserResults.getSizeOfBank()).thenReturn(2);

        Exception e = assertThrows(IllegalArgumentException.class, () -> handler.handle("select", indexParam(5)));
        assertTrue(e.getMessage().contains("6"), "expected 1-based index 6 in: " + e.getMessage());
    }

    @Test
    void selectResult_valid_selectsTheItem() {
        browserExists(true);
        when(browserResults.getSizeOfBank()).thenReturn(2);

        BrowserResultsItem item = mock(BrowserResultsItem.class);
        BooleanValue exists = mock(BooleanValue.class);
        SettableBooleanValue isSelected = mock(SettableBooleanValue.class);
        when(exists.get()).thenReturn(true);
        when(item.exists()).thenReturn(exists);
        when(item.isSelected()).thenReturn(isSelected);
        when(browserResults.getItemAt(1)).thenReturn(item);

        handler.handle("select", indexParam(1));

        verify(isSelected).set(true);
    }

    // --- commit / cancel ---

    @Test
    void commitBrowser_requiresOpenBrowser() {
        browserExists(false);

        assertThrows(IllegalArgumentException.class, () -> handler.handle("commit", params()));
    }

    @Test
    void commitBrowser_valid_callsCommit() {
        browserExists(true);

        handler.handle("commit", params());

        verify(popupBrowser).commit();
    }

    @Test
    void cancelBrowser_whenOpen_callsCancel() {
        browserExists(true);

        handler.handle("cancel", params());

        verify(popupBrowser).cancel();
    }

    @Test
    void cancelBrowser_whenAlreadyClosed_doesNotThrowOrCallCancel() {
        browserExists(false);

        JsonElement result = handler.handle("cancel", params());

        verify(popupBrowser, never()).cancel();
        assertTrue(result.getAsJsonObject().get("success").getAsBoolean());
    }

    // --- getState ---

    @Test
    void getState_whenClosed_returnsMinimalState() {
        browserExists(false);

        JsonObject result = handler.handle("getState", params()).getAsJsonObject();

        assertFalse(result.get("isOpen").getAsBoolean());
        assertEquals("", result.get("title").getAsString());
        assertFalse(result.has("contentTypes"));
    }

    @Test
    void getState_whenOpen_returnsFullStateWithContentTypes() {
        browserExists(true);
        StringValue title = mock(StringValue.class);
        StringValue contentType = mock(StringValue.class);
        BrowserResultsColumn resultsColumn = mock(BrowserResultsColumn.class);
        IntegerValue entryCount = mock(IntegerValue.class);
        StringArrayValue names = mock(StringArrayValue.class);

        when(title.get()).thenReturn("Browse Devices");
        when(contentType.get()).thenReturn("Devices");
        when(entryCount.get()).thenReturn(42);
        when(resultsColumn.entryCount()).thenReturn(entryCount);
        when(names.get()).thenReturn(new String[] {"Devices", "Presets"});

        when(popupBrowser.title()).thenReturn(title);
        when(popupBrowser.selectedContentTypeName()).thenReturn(contentType);
        when(popupBrowser.resultsColumn()).thenReturn(resultsColumn);
        when(popupBrowser.contentTypeNames()).thenReturn(names);

        JsonObject result = handler.handle("getState", params()).getAsJsonObject();

        assertTrue(result.get("isOpen").getAsBoolean());
        assertEquals("Browse Devices", result.get("title").getAsString());
        assertEquals(42, result.get("resultCount").getAsInt());
        assertEquals(2, result.getAsJsonArray("contentTypes").size());
    }
}
