import { jsx as _jsx } from "react/jsx-runtime";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import test from "node:test";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    Event: { configurable: true, value: dom.window.Event },
    Node: { configurable: true, value: dom.window.Node }
});
const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { IptvManagementScreen } = await import("./IptvManagementScreen");
const defaultProps = {
    channels: [],
    channelPage: { items: [], page: 1, pageSize: 50, total: 0, totalPages: 1 },
    onLoadChannelPage: async () => { },
    providers: [],
    selectedProviderId: "",
    onSelectProvider: () => { },
    providerDiagnostics: {},
    onCreateProvider: async () => ({ id: "provider-1", type: "m3u", status: "active", availabilityStatus: "online", healthScore: 100, failedChannelLoads: 0, baseUrl: "https://example.com/playlist.m3u", name: "M3U Test", authType: "none", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
    onIngestM3u: async () => { },
    onSyncXtream: async () => { },
    onTestProvider: async () => ({ ok: true, message: "Provider connection is valid." }),
    onTestProviderById: undefined,
    onSetProviderStatus: async () => { },
    onStartIptvOperation: async (type, input) => ({
        id: `op-${type}-${input?.providerId ?? "x"}`,
        type: type,
        status: "queued",
        startedAt: new Date().toISOString(),
        processed: 0,
        succeeded: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        currentStage: "queued",
        currentMessage: "Operation queued.",
        cancelled: false
    }),
    onGetIptvOperation: async () => null,
    onCancelIptvOperation: async () => null,
    onRefreshIptv: async () => { }
};
test("successful M3U provider creation triggers the existing M3U catalogue sync operation", async () => {
    const startCalls = [];
    const createProvider = async () => ({
        id: "provider-1",
        type: "m3u",
        name: "M3U Test",
        baseUrl: "https://example.com/playlist.m3u",
        authType: "none",
        status: "active",
        availabilityStatus: "online",
        failedChannelLoads: 0,
        healthScore: 100,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
    const props = {
        ...defaultProps,
        onCreateProvider: createProvider,
        onTestProvider: async () => ({ ok: true, message: "Provider connection is valid." }),
        onStartIptvOperation: async (type, input) => {
            const next = { type };
            if (input)
                next.input = input;
            startCalls.push(next);
            return {
                id: `op-${type}-${input?.providerId ?? "x"}`,
                type: type,
                status: "queued",
                startedAt: new Date().toISOString(),
                processed: 0,
                succeeded: 0,
                updated: 0,
                skipped: 0,
                failed: 0,
                currentStage: "queued",
                currentMessage: "Operation queued.",
                cancelled: false
            };
        }
    };
    render(_jsx(IptvManagementScreen, { ...props }));
    fireEvent.click(screen.getByRole("button", { name: "Add an account" }));
    fireEvent.change(screen.getByPlaceholderText("Provider name"), { target: { value: "M3U Test" } });
    fireEvent.change(screen.getByPlaceholderText("https://example.com/playlist.m3u"), { target: { value: "https://example.com/playlist.m3u" } });
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "m3u" } });
    fireEvent.click(screen.getByRole("button", { name: "Create & Save" }));
    await waitFor(() => {
        assert.deepEqual(startCalls, [{ type: "m3u_import", input: { providerId: "provider-1" } }]);
    });
    cleanup();
});
test("failed M3U validation does not trigger the existing M3U catalogue sync operation", async () => {
    const startCalls = [];
    const props = {
        ...defaultProps,
        onCreateProvider: async () => ({
            id: "provider-2",
            type: "m3u",
            name: "M3U Test",
            baseUrl: "https://example.com/playlist.m3u",
            authType: "none",
            status: "active",
            availabilityStatus: "online",
            failedChannelLoads: 0,
            healthScore: 100,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }),
        onTestProvider: async () => ({ ok: false, message: "Provider validation failed." }),
        onStartIptvOperation: async (type, input) => {
            const next = { type };
            if (input)
                next.input = input;
            startCalls.push(next);
            return {
                id: `op-${type}-${input?.providerId ?? "x"}`,
                type: type,
                status: "queued",
                startedAt: new Date().toISOString(),
                processed: 0,
                succeeded: 0,
                updated: 0,
                skipped: 0,
                failed: 0,
                currentStage: "queued",
                currentMessage: "Operation queued.",
                cancelled: false
            };
        }
    };
    render(_jsx(IptvManagementScreen, { ...props }));
    fireEvent.click(screen.getByRole("button", { name: "Add an account" }));
    fireEvent.change(screen.getByPlaceholderText("Provider name"), { target: { value: "M3U Failed" } });
    fireEvent.change(screen.getByPlaceholderText("https://example.com/playlist.m3u"), { target: { value: "https://example.com/playlist.m3u" } });
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "m3u" } });
    fireEvent.click(screen.getByRole("button", { name: "Create & Save" }));
    await waitFor(() => {
        assert.match(screen.getByText("Provider validation failed.")?.textContent ?? "", /Provider validation failed\./);
    });
    assert.deepEqual(startCalls, []);
    cleanup();
});
test("Xtream provider creation continues to use the existing Xtream sync path without invoking M3U sync", async () => {
    const startCalls = [];
    const getCalls = [];
    const props = {
        ...defaultProps,
        onCreateProvider: async () => ({
            id: "xtream-1",
            type: "xtream",
            name: "Xtream Test",
            baseUrl: "https://example.com/xtream",
            authType: "basic",
            status: "active",
            availabilityStatus: "online",
            failedChannelLoads: 0,
            healthScore: 100,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            syncOperationId: "xtream-op-1"
        }),
        onTestProvider: async () => ({ ok: true, message: "Provider connection is valid." }),
        onStartIptvOperation: async (type, input) => {
            const next = { type };
            if (input)
                next.input = input;
            startCalls.push(next);
            return {
                id: `op-${type}-${input?.providerId ?? "x"}`,
                type: type,
                status: "queued",
                startedAt: new Date().toISOString(),
                processed: 0,
                succeeded: 0,
                updated: 0,
                skipped: 0,
                failed: 0,
                currentStage: "queued",
                currentMessage: "Operation queued.",
                cancelled: false
            };
        },
        onGetIptvOperation: async (operationId) => {
            getCalls.push(operationId);
            return {
                id: operationId,
                type: "xtream_channel_sync",
                status: "queued",
                startedAt: new Date().toISOString(),
                processed: 0,
                succeeded: 0,
                updated: 0,
                skipped: 0,
                failed: 0,
                currentStage: "queued",
                currentMessage: "Operation queued.",
                cancelled: false
            };
        }
    };
    render(_jsx(IptvManagementScreen, { ...props }));
    fireEvent.click(screen.getByRole("button", { name: "Add an account" }));
    fireEvent.change(screen.getByPlaceholderText("Provider name"), { target: { value: "Xtream Test" } });
    fireEvent.change(screen.getByPlaceholderText("https://example.com/playlist.m3u"), { target: { value: "https://example.com/xtream" } });
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "xtream" } });
    fireEvent.change(screen.getByPlaceholderText("Xtream username"), { target: { value: "user" } });
    fireEvent.change(screen.getByPlaceholderText("Xtream password"), { target: { value: "pass" } });
    fireEvent.click(screen.getByRole("button", { name: "Create & Save" }));
    await waitFor(() => {
        assert.deepEqual(getCalls, ["xtream-op-1"]);
        assert.deepEqual(startCalls, []);
    });
    cleanup();
});
