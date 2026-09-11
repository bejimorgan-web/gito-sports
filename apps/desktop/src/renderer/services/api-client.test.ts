import test from "node:test";
import assert from "node:assert/strict";

import { request, setAccessToken } from "./api-client";

test("request attaches the current bearer token to protected API requests", async () => {
  const originalFetch = globalThis.fetch;
  let capturedInit: RequestInit | undefined;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedInit = init;
    return new Response(JSON.stringify([{ id: "provider-1" }]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    setAccessToken("dummy-token");
    const result = await request("/iptv/providers");

    assert.deepEqual(result, [{ id: "provider-1" }]);
    assert.equal((capturedInit?.headers as Record<string, string>)?.authorization, "Bearer dummy-token");
  } finally {
    setAccessToken(null);
    globalThis.fetch = originalFetch;
  }
});
