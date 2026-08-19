package com.pxaudio.bitwigmcp.handlers;

import com.bitwig.extension.controller.api.*;
import com.google.gson.*;

import com.pxaudio.bitwigmcp.BitwigMCPExtension;

import static com.pxaudio.bitwigmcp.handlers.JsonResponses.successResponse;

/**
 * Handles browser operations: open a popup browser session, filter it,
 * read results, commit or cancel.
 *
 * Each action performs one Bitwig API call and returns immediately.
 * Browser results populate asynchronously and observers cannot fire while
 * this thread is blocked, so the MCP server inserts settle delays between
 * calls rather than this handler waiting.
 */
public class BrowserHandler {
    private final BitwigMCPExtension extension;
    private final ControllerHost host;

    public BrowserHandler(BitwigMCPExtension extension, ControllerHost host) {
        this.extension = extension;
        this.host = host;
    }

    public JsonElement handle(String action, JsonObject params) {
        switch (action) {
            case "open":
                return openBrowser(params);
            case "setContentType":
                return setContentType(params);
            case "setFilter":
                return setFilter(params);
            case "getResults":
                return getResults();
            case "select":
                return selectResult(params);
            case "commit":
                return commitBrowser();
            case "cancel":
                return cancelBrowser();
            case "getState":
                return getState();
            default:
                throw new IllegalArgumentException("Unknown browser action: " + action);
        }
    }

    /**
     * Open a browser session. Cancels any stale session first so a wedged
     * popup never blocks the next call.
     *
     * mode: "end" (default) - insert at end of cursor track's device chain
     *       "position"       - insert at device chain slot (0-based "position" param)
     *       "replace"        - open against cursor device (used for preset browsing)
     */
    private JsonElement openBrowser(JsonObject params) {
        PopupBrowser browser = extension.getPopupBrowser();

        // A stale session must be cancelled before browsing again. Bitwig applies
        // the cancel synchronously here, so the subsequent browse() call below is
        // acting on a closed browser - no settle is possible from inside a handler
        // anyway, since observers cannot fire while this thread runs.
        if (browser.exists().get()) {
            browser.cancel();
        }

        String mode = params.has("mode") ? params.get("mode").getAsString() : "end";

        switch (mode) {
            case "end":
                extension.getCursorTrack().endOfDeviceChainInsertionPoint().browse();
                break;
            case "position": {
                if (!params.has("position")) {
                    throw new IllegalArgumentException("Missing 'position' parameter for mode 'position'");
                }
                int position = params.get("position").getAsInt();
                DeviceBank deviceBank = extension.getDeviceBank();
                if (position < 0 || position >= deviceBank.getSizeOfBank()) {
                    throw new IllegalArgumentException("Device position out of range: " + (position + 1));
                }
                // Bank size is the window, not the chain length. Inserting past the
                // last real device has unspecified behavior, so require that the
                // slot (or the slot just after the last device) actually exists.
                if (position > 0 && !deviceBank.getDevice(position - 1).exists().get()) {
                    throw new IllegalArgumentException(
                        "Device position " + (position + 1) + " is past the end of the chain");
                }
                deviceBank.browseToInsertDevice(position);
                break;
            }
            case "replace":
                if (!extension.getCursorDevice().exists().get()) {
                    throw new IllegalArgumentException("No device selected. Select a device in Bitwig.");
                }
                extension.getCursorDevice().replaceDeviceInsertionPoint().browse();
                break;
            default:
                throw new IllegalArgumentException("Unknown browser mode: " + mode + " (expected end, position, or replace)");
        }

        // Bitwig persists filter column selections across browser sessions, so a
        // category/creator/etc filter left over from a previous search_browser or
        // load_device call would otherwise silently narrow this one. Reset every
        // column to its wildcard item so each session starts clean.
        String[] filterNames = {"category", "creator", "tag", "device", "deviceType", "fileType", "location", "smartCollection"};
        for (String filterName : filterNames) {
            getColumn(filterName).getWildcardItem().isSelected().set(true);
        }

        return successResponse();
    }

    /**
     * Switch the browser's content type (e.g. Devices, Presets) by index
     * into contentTypeNames().
     */
    private JsonElement setContentType(JsonObject params) {
        requireOpenBrowser();

        PopupBrowser browser = extension.getPopupBrowser();
        String[] names = browser.contentTypeNames().get();

        if (params.has("index")) {
            int index = params.get("index").getAsInt();
            if (index < 0 || index >= names.length) {
                throw new IllegalArgumentException("Content type index out of range: " + index);
            }
            browser.selectedContentTypeIndex().set(index);
            return successResponse();
        }

        if (params.has("name")) {
            String wanted = params.get("name").getAsString();
            for (int i = 0; i < names.length; i++) {
                if (names[i].equalsIgnoreCase(wanted)) {
                    browser.selectedContentTypeIndex().set(i);
                    return successResponse();
                }
            }
            throw new IllegalArgumentException("Unknown content type: " + wanted
                + " (expected one of: " + String.join(", ", names) + ")");
        }

        throw new IllegalArgumentException("Missing 'index' or 'name' parameter");
    }

    /**
     * Select an item in a named filter column by its display name.
     * Passing no "value" (or an empty one) selects the column's wildcard
     * item, clearing that filter.
     */
    private JsonElement setFilter(JsonObject params) {
        requireOpenBrowser();

        if (!params.has("column")) {
            throw new IllegalArgumentException("Missing 'column' parameter");
        }
        String columnName = params.get("column").getAsString();
        BrowserFilterColumn column = getColumn(columnName);

        String value = params.has("value") ? params.get("value").getAsString() : "";
        if (value.isEmpty()) {
            column.getWildcardItem().isSelected().set(true);
            return successResponse();
        }

        BrowserFilterItemBank bank = extension.getBrowserFilterBank(columnName);
        for (int i = 0; i < bank.getSizeOfBank(); i++) {
            BrowserItem item = bank.getItemAt(i);
            if (item.exists().get() && item.name().get().equalsIgnoreCase(value)) {
                item.isSelected().set(true);
                return successResponse();
            }
        }

        throw new IllegalArgumentException("No '" + value + "' entry in browser column: " + columnName);
    }

    private BrowserFilterColumn getColumn(String name) {
        PopupBrowser browser = extension.getPopupBrowser();
        switch (name) {
            case "category":        return browser.categoryColumn();
            case "creator":         return browser.creatorColumn();
            case "tag":             return browser.tagColumn();
            case "device":          return browser.deviceColumn();
            case "deviceType":      return browser.deviceTypeColumn();
            case "fileType":        return browser.fileTypeColumn();
            case "location":        return browser.locationColumn();
            case "smartCollection": return browser.smartCollectionColumn();
            default:
                throw new IllegalArgumentException("Unknown browser column: " + name
                    + " (expected category, creator, tag, device, deviceType, fileType, location, or smartCollection)");
        }
    }

    /**
     * Read the results column. Returns 0-based indices; the MCP server
     * converts them to 1-based for the user.
     */
    private JsonElement getResults() {
        requireOpenBrowser();

        BrowserResultsItemBank bank = extension.getBrowserResults();
        JsonArray results = new JsonArray();

        for (int i = 0; i < bank.getSizeOfBank(); i++) {
            BrowserItem item = bank.getItemAt(i);
            if (item.exists().get()) {
                JsonObject obj = new JsonObject();
                obj.addProperty("index", i);
                obj.addProperty("name", item.name().get());
                obj.addProperty("isSelected", item.isSelected().get());
                results.add(obj);
            }
        }

        JsonObject result = new JsonObject();
        result.add("results", results);
        result.addProperty("count", results.size());
        result.addProperty("totalCount", extension.getPopupBrowser().resultsColumn().entryCount().get());
        return result;
    }

    private JsonElement selectResult(JsonObject params) {
        requireOpenBrowser();

        if (!params.has("index")) {
            throw new IllegalArgumentException("Missing 'index' parameter");
        }
        int index = params.get("index").getAsInt();

        BrowserResultsItemBank bank = extension.getBrowserResults();
        if (index < 0 || index >= bank.getSizeOfBank()) {
            throw new IllegalArgumentException("Result does not exist at index: " + (index + 1));
        }

        BrowserItem item = bank.getItemAt(index);
        if (!item.exists().get()) {
            throw new IllegalArgumentException("Result does not exist at index: " + (index + 1));
        }

        item.isSelected().set(true);
        return successResponse();
    }

    private JsonElement commitBrowser() {
        requireOpenBrowser();
        extension.getPopupBrowser().commit();
        return successResponse();
    }

    /**
     * Cancel is deliberately tolerant of an already-closed browser: it is
     * the escape hatch the MCP server calls from failure paths.
     */
    private JsonElement cancelBrowser() {
        PopupBrowser browser = extension.getPopupBrowser();
        if (browser.exists().get()) {
            browser.cancel();
        }
        return successResponse();
    }

    private JsonElement getState() {
        PopupBrowser browser = extension.getPopupBrowser();
        boolean isOpen = browser.exists().get();

        JsonObject result = new JsonObject();
        result.addProperty("isOpen", isOpen);
        result.addProperty("title", isOpen ? browser.title().get() : "");
        result.addProperty("contentType", isOpen ? browser.selectedContentTypeName().get() : "");
        result.addProperty("resultCount", isOpen ? browser.resultsColumn().entryCount().get() : 0);

        if (isOpen) {
            JsonArray types = new JsonArray();
            for (String name : browser.contentTypeNames().get()) {
                types.add(name);
            }
            result.add("contentTypes", types);
        }

        return result;
    }

    private void requireOpenBrowser() {
        if (!extension.getPopupBrowser().exists().get()) {
            throw new IllegalArgumentException("No browser session open. Call browser.open first.");
        }
    }
}
