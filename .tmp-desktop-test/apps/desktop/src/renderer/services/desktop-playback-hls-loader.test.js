import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopPlaybackLoader } from "./desktop-playback-hls-loader.js";
test("HLS loader sends logical resources through playback IPC", async () => {
    let request;
    const playback = {
        read: async (input) => {
            request = input;
            return { sessionId: "session-1", requestId: input.requestId, resourceType: "segment", contentType: "video/mp2t", data: new TextEncoder().encode("bytes").buffer, done: true };
        }
    };
    const Loader = createDesktopPlaybackLoader(playback, "session-1");
    const loader = new Loader({});
    let success;
    loader.load({ url: "gito-resource://resource-abc", type: "fragment" }, {}, { onSuccess: (data) => { success = data; }, onError: () => assert.fail("loader should succeed") });
    for (let attempt = 0; attempt < 20 && !success; attempt += 1)
        await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(request.sessionId, "session-1");
    assert.equal(request.resourceId, "resource-abc");
    assert.equal(request.resourceType, "segment");
    assert.equal(new TextDecoder().decode(success.data), "bytes");
});
test("HLS loader rejects provider URLs instead of forwarding them", () => {
    const Loader = createDesktopPlaybackLoader({ read: async () => { throw new Error("unexpected"); } }, "session-1");
    const loader = new Loader({});
    let failed = false;
    loader.load({ url: "https://provider.invalid/secret.m3u8", type: "manifest" }, {}, { onSuccess: () => assert.fail("provider URL must be rejected"), onError: () => { failed = true; } });
    assert.equal(failed, true);
});
