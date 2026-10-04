import assert from "node:assert/strict";
import test from "node:test";
import { AiProviderError, AiTaskProviderRegistry, createAiTaskProviderRegistry, getAiProviderConfiguration, OpenAiCompatibleTaskProvider, type AiProviderConfiguration, type AiProviderTaskRequest, type AiTaskProviderAdapter } from "./ai-news-provider.js";

const request: AiProviderTaskRequest = { taskId: "task-1", taskType: "claim_verification", articleId: "article-1", model: "mock", promptVersion: "claim-verification-v1",
  correlationId: "corr-1", instructions: "Assess evidence", input: { claim: { id: "claim-1" }, evidence: [{ id: "evidence-1", text: "passage" }] }, output: { mode: "json" },
  requiredCapabilities: ["text-generation", "structured-output"], timeoutMs: 2000, retry: { maxAttempts: 1 } };

test("OpenAI compatible provider forwards bounded structured verification input", async () => {
  const originalFetch = globalThis.fetch;
  let captured: any;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    captured = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ status: "insufficient_evidence" }) } }] }), { status: 200,
      headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const provider = new OpenAiCompatibleTaskProvider();
    const result = await provider.execute({ ...request, generation: { temperature: 0 } },
    { provider: "openai-compatible", model: "mock", baseUrl: "https://provider.invalid", apiKey: "test-only" });
    assert.deepEqual(result.output, { status: "insufficient_evidence" });
    const userPayload = JSON.parse(captured.messages[1].content);
    assert.equal(captured.model, "mock");
    assert.equal(captured.temperature, 0);
    assert.deepEqual(captured.response_format, { type: "json_object" });
    assert.deepEqual(userPayload.input.claim, { id: "claim-1" });
    assert.deepEqual(userPayload.input.evidence, [{ id: "evidence-1", text: "passage" }]);
  } finally { globalThis.fetch = originalFetch; }
});

test("generic compatible adapter accepts an arbitrary configured endpoint and returns normalized metadata", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedHeaders: HeadersInit | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input); capturedHeaders = init?.headers;
    return new Response(JSON.stringify({ id: "req-44", model: "model-actual", choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }), { status: 200 });
  }) as typeof fetch;
  try {
    const config: AiProviderConfiguration = { provider: "custom-profile", adapterType: "openai-compatible", model: "custom-model", baseUrl: "https://arbitrary.example/v1/chat/completions", apiKey: "server-secret" };
    const result = await createAiTaskProviderRegistry().get(config.provider, config.adapterType).execute({ ...request, model: config.model }, config);
    assert.equal(capturedUrl, config.baseUrl);
    assert.equal(new Headers(capturedHeaders).get("authorization"), "Bearer server-secret");
    assert.deepEqual(result.output, { ok: true });
    assert.equal(result.provider, "custom-profile");
    assert.equal(result.model, "model-actual");
    assert.equal(result.requestId, "req-44");
    assert.deepEqual(result.usage, { inputTokens: 4, outputTokens: 2, totalTokens: 6, estimatedCost: null, currency: null, providerReported: null });
  } finally { globalThis.fetch = originalFetch; }
});

test("Gemini compatible endpoint is normalized and Google-prefixed models are sent without the vendor prefix", async () => {
  const originalFetch = globalThis.fetch;
  const captured: Array<{ url: string; model: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({ url: String(input), model: JSON.parse(String(init?.body)).model });
    return new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200 });
  }) as typeof fetch;
  const baseUrls = [
    "https://generativelanguage.googleapis.com",
    "https://generativelanguage.googleapis.com/v1beta/openai/",
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
  ];
  try {
    for (const baseUrl of baseUrls) {
      const config: AiProviderConfiguration = {
        provider: "gemini",
        adapterType: "openai-compatible",
        model: "google/gemini-2.5-flash",
        baseUrl,
        apiKey: "test-only"
      };
      await new OpenAiCompatibleTaskProvider().execute({ ...request, model: config.model }, config);
    }
    assert.deepEqual(captured, baseUrls.map(() => ({
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      model: "gemini-2.5-flash"
    })));
  } finally { globalThis.fetch = originalFetch; }
});

test("a native adapter can be registered without changing task code or generic adapter registration", async () => {
  let called = false;
  const native: AiTaskProviderAdapter = { provider: "native-protocol", capabilities: { "text-generation": true }, async execute(input, config) {
    called = true; assert.equal(config.provider, "native-profile"); assert.equal(input.taskType, request.taskType);
    return { output: { native: true }, provider: config.provider, model: config.model };
  } };
  const registry = createAiTaskProviderRegistry([native]);
  const config: AiProviderConfiguration = { provider: "native-profile", adapterType: native.provider, model: "native-model", baseUrl: "", apiKey: "" };
  const result = await registry.get(config.provider, config.adapterType).execute(request, config);
  assert.equal(called, true); assert.deepEqual(result.output, { native: true });
});

test("requested unsupported capabilities fail explicitly before a provider request", async () => {
  const provider = new OpenAiCompatibleTaskProvider();
  await assert.rejects(() => provider.execute({ ...request, requiredCapabilities: ["vision"] },
    { provider: "arbitrary", model: "model", baseUrl: "https://provider.invalid", apiKey: "test-only" }),
  (error) => error instanceof AiProviderError && error.code === "capability_unsupported");
});

test("compatible protocol errors are normalized without exposing provider response bodies", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("provider-secret-error-body", { status: 503 })) as typeof fetch;
  try {
    await assert.rejects(() => new OpenAiCompatibleTaskProvider().execute(request,
      { provider: "arbitrary-profile", model: "model", baseUrl: "https://provider.invalid", apiKey: "secret" }),
    (error) => error instanceof AiProviderError && error.code === "upstream_unavailable" && error.retryable && !error.message.includes("secret"));
  } finally { globalThis.fetch = originalFetch; }
});

test("compatible protocol reports safe provider failure categories without returning its body", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("sensitive provider response", { status: 401 })) as typeof fetch;
  try {
    await assert.rejects(() => new OpenAiCompatibleTaskProvider().execute(request,
      { provider: "arbitrary-profile", model: "model", baseUrl: "https://provider.invalid", apiKey: "test-only" }),
    (error) => error instanceof AiProviderError && error.code === "authentication_failed" && !error.message.includes("sensitive"));
  } finally { globalThis.fetch = originalFetch; }
});

test("HTTP provider errors retain safe bounded diagnostics for common status codes", async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    { status: 404, code: "resource_not_found", retryable: false },
    { status: 401, code: "authentication_failed", retryable: false },
    { status: 403, code: "access_denied", retryable: false },
    { status: 429, code: "rate_limited", retryable: true },
    { status: 500, code: "upstream_unavailable", retryable: true },
    { status: 503, code: "upstream_unavailable", retryable: true }
  ] as const;
  const apiKey = "test-gemini-api-key";
  const authorization = "test-authorization-value";
  const password = "test-password-value";
  const articleText = "Private article content must never be returned";
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.signature123456";
  try {
    for (const current of cases) {
      const providerBody = JSON.stringify({
        error: {
          code: current.status,
          status: current.status === 404 ? "NOT_FOUND"
            : current.status === 401 ? "UNAUTHENTICATED"
              : current.status === 403 ? "PERMISSION_DENIED"
                : current.status === 429 ? "RESOURCE_EXHAUSTED"
                  : current.status === 503 ? "UNAVAILABLE" : "INTERNAL",
          type: "provider_error",
          message: `model unavailable; api_key=${apiKey}; Authorization: Bearer ${authorization}; password=${password}; ${jwt}; ${articleText}`
        }
      });
      globalThis.fetch = (async () => new Response(providerBody, { status: current.status })) as typeof fetch;
      let thrown: unknown;
      try {
        await new OpenAiCompatibleTaskProvider().execute({ ...request, input: { articleBody: articleText } }, {
          provider: "gemini",
          model: "gemini-3.8-flash",
          baseUrl: "https://user:pass@generativelanguage.googleapis.com/v1beta/openai/chat/completions?secret=query-secret#fragment",
          apiKey
        });
      } catch (error) { thrown = error; }

      assert.ok(thrown instanceof AiProviderError);
      assert.equal(thrown.code, current.code);
      assert.equal(thrown.retryable, current.retryable);
      assert.equal(thrown.diagnostics?.httpStatus, current.status);
      assert.equal(thrown.diagnostics?.errorCode, String(current.status));
      assert.equal(thrown.diagnostics?.errorStatus, current.status === 404 ? "NOT_FOUND"
        : current.status === 401 ? "UNAUTHENTICATED"
          : current.status === 403 ? "PERMISSION_DENIED"
            : current.status === 429 ? "RESOURCE_EXHAUSTED"
              : current.status === 503 ? "UNAVAILABLE" : "INTERNAL");
      assert.equal(thrown.diagnostics?.errorType, "provider_error");
      assert.match(thrown.diagnostics?.url ?? "", /^https:\/\/generativelanguage\.googleapis\.com\//);
      const diagnostic = thrown.toDiagnosticMessage() ?? "";
      for (const secret of [apiKey, authorization, password, jwt, articleText, "query-secret", "user:pass", "Authorization"]) {
        assert.equal(diagnostic.includes(secret), false, `diagnostic exposed ${secret}`);
      }
      assert.match(diagnostic, new RegExp(`httpStatus=${current.status}`));
      if (current.status >= 500) assert.match(diagnostic, /errorBodyFormat=json/);
      assert.match(diagnostic, /message=/);
      assert.ok(diagnostic.length <= 2048);
      assert.equal(String(thrown).includes(apiKey), false);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("HTTP 503 omits structured error fields containing URLs", async () => {
  const originalFetch = globalThis.fetch;
  const privateUrl = "https://user:password@provider.invalid/error?token=fake-secret";
  globalThis.fetch = (async () => new Response(JSON.stringify({
    error: { code: privateUrl, status: "UNAVAILABLE", type: "provider_error", message: `See ${privateUrl}` }
  }), { status: 503 })) as typeof fetch;
  try {
    await assert.rejects(
      () => new OpenAiCompatibleTaskProvider().execute(request, {
        provider: "gemini",
        model: "gemini-3.8-flash",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        apiKey: "test-only"
      }),
      (error) => error instanceof AiProviderError &&
        error.diagnostics?.errorStatus === "UNAVAILABLE" &&
        error.diagnostics?.errorCode === undefined &&
        error.diagnostics?.message === undefined &&
        !error.toDiagnosticMessage()?.includes(privateUrl) &&
        !error.toDiagnosticMessage()?.includes("fake-secret")
    );
  } finally { globalThis.fetch = originalFetch; }
});

test("HTTP 503 diagnostics never include the outbound request body", async () => {
  const originalFetch = globalThis.fetch;
  let outboundRequestBody = "";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    outboundRequestBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "Try again later" } }), { status: 503 });
  }) as typeof fetch;
  try {
    let thrown: unknown;
    try {
      await new OpenAiCompatibleTaskProvider().execute(request, {
        provider: "gemini",
        model: "gemini-3.8-flash",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        apiKey: "test-only"
      });
    } catch (error) { thrown = error; }
    assert.ok(thrown instanceof AiProviderError);
    assert.ok(outboundRequestBody.length > 0);
    assert.equal(thrown.toDiagnosticMessage()?.includes(outboundRequestBody), false);
  } finally { globalThis.fetch = originalFetch; }
});

test("HTTP 503 plain text and malformed JSON expose only a bounded response-format category", async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [
    { body: "Internal backend detail including private source text", expectedFormat: "plain_text" },
    { body: '{"error":{"message":"internal backend detail"', expectedFormat: "malformed_json" }
  ] as const;
  try {
    for (const { body, expectedFormat } of bodies) {
      globalThis.fetch = (async () => new Response(body, { status: 503 })) as typeof fetch;
      let thrown: unknown;
      try {
        await new OpenAiCompatibleTaskProvider().execute(request, {
          provider: "gemini",
          model: "gemini-3.8-flash",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
          apiKey: "test-only"
        });
      } catch (error) { thrown = error; }
      assert.ok(thrown instanceof AiProviderError);
      assert.equal(thrown.code, "upstream_unavailable");
      assert.equal(thrown.retryable, true);
      assert.equal(thrown.diagnostics?.errorBodyFormat, expectedFormat);
      const diagnostic = thrown.toDiagnosticMessage() ?? "";
      assert.ok(diagnostic.length <= 2048);
      assert.equal(diagnostic.includes(body), false);
      if (expectedFormat === "plain_text") assert.equal(thrown.diagnostics?.message, undefined);
      if (expectedFormat === "malformed_json") assert.equal(thrown.diagnostics?.message, "Malformed provider error response");
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("HTTP 503 oversized error bodies are truncated without persisting their contents", async () => {
  const originalFetch = globalThis.fetch;
  const body = JSON.stringify({ error: { message: "provider detail ".repeat(1000) } });
  globalThis.fetch = (async () => new Response(body, { status: 503 })) as typeof fetch;
  try {
    let thrown: unknown;
    try {
      await new OpenAiCompatibleTaskProvider().execute(request, {
        provider: "gemini",
        model: "gemini-3.8-flash",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        apiKey: "test-only"
      });
    } catch (error) { thrown = error; }
    assert.ok(thrown instanceof AiProviderError);
    assert.equal(thrown.diagnostics?.errorBodyFormat, "truncated");
    assert.equal(thrown.diagnostics?.message, "Provider error response exceeded the diagnostic size limit");
    const diagnostic = thrown.toDiagnosticMessage() ?? "";
    assert.ok(diagnostic.length <= 2048);
    assert.equal(diagnostic.includes(body), false);
    assert.equal(diagnostic.includes("provider detail"), false);
  } finally { globalThis.fetch = originalFetch; }
});

test("malformed provider error body produces a safe diagnostic without its response content", async () => {
  const originalFetch = globalThis.fetch;
  const body = '{"error":{"message":"secret malformed response';
  globalThis.fetch = (async () => new Response(body, { status: 404 })) as typeof fetch;
  try {
    await assert.rejects(
      () => new OpenAiCompatibleTaskProvider().execute(request, {
        provider: "gemini",
        model: "gemini-3.8-flash",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        apiKey: "test-only"
      }),
      (error) => error instanceof AiProviderError &&
        error.code === "resource_not_found" &&
        error.diagnostics?.message === "Malformed provider error response" &&
        !error.toDiagnosticMessage()?.includes("secret malformed response")
    );
  } finally { globalThis.fetch = originalFetch; }
});

test("plain-text provider errors retain only bounded sanitized message text", async () => {
  const originalFetch = globalThis.fetch;
  const apiKey = "test-plain-text-api-key";
  const authorization = "test-plain-text-authorization";
  globalThis.fetch = (async () => new Response(
    `model unavailable Authorization: Bearer ${authorization} api_key=${apiKey}`,
    { status: 404 }
  )) as typeof fetch;
  try {
    await assert.rejects(
      () => new OpenAiCompatibleTaskProvider().execute(request, {
        provider: "gemini",
        model: "gemini-3.8-flash",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        apiKey
      }),
      (error) => error instanceof AiProviderError &&
        error.diagnostics?.message?.startsWith("model unavailable") === true &&
        !error.toDiagnosticMessage()?.includes(apiKey) &&
        !error.toDiagnosticMessage()?.includes(authorization) &&
        !error.toDiagnosticMessage()?.includes("Authorization")
    );
  } finally { globalThis.fetch = originalFetch; }
});

test("provider timeout retains safe request diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  })) as typeof fetch;
  try {
    await assert.rejects(
      () => new OpenAiCompatibleTaskProvider().execute({ ...request, timeoutMs: 10 }, {
        provider: "gemini",
        model: "gemini-3.8-flash",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        apiKey: "test-only"
      }),
      (error) => error instanceof AiProviderError &&
        error.code === "timeout" &&
        error.retryable &&
        error.diagnostics?.httpStatus === undefined &&
        /retryable=true/.test(error.toDiagnosticMessage() ?? "")
    );
  } finally { globalThis.fetch = originalFetch; }
});

test("provider profiles and task routes select arbitrary profiles without provider allowlists", () => {
  const oldProfiles = process.env.AI_PROVIDERS_JSON;
  const oldRoutes = process.env.AI_TASK_ROUTES_JSON;
  const oldSecret = process.env.AI_TEST_PROVIDER_KEY;
  process.env.AI_PROVIDERS_JSON = JSON.stringify({ profileA: { type: "openai-compatible", model: "model-a", baseUrl: "https://a.invalid/chat", apiKeyEnv: "AI_TEST_PROVIDER_KEY" },
    profileB: { type: "native-example", model: "model-b", baseUrl: "https://b.invalid", apiKeyEnv: "AI_TEST_PROVIDER_KEY" } });
  process.env.AI_TASK_ROUTES_JSON = JSON.stringify({ story_understanding: { provider: "profileB", fallbacks: ["profileA"] } });
  process.env.AI_TEST_PROVIDER_KEY = "test-only";
  try {
    const selected = getAiProviderConfiguration("story_understanding");
    assert.equal(selected.provider, "profileB"); assert.equal(selected.adapterType, "native-example"); assert.equal(selected.apiKey, "test-only");
    assert.equal(selected.fallbacks?.[0]?.provider, "profileA");
  } finally {
    if (oldProfiles === undefined) delete process.env.AI_PROVIDERS_JSON; else process.env.AI_PROVIDERS_JSON = oldProfiles;
    if (oldRoutes === undefined) delete process.env.AI_TASK_ROUTES_JSON; else process.env.AI_TASK_ROUTES_JSON = oldRoutes;
    if (oldSecret === undefined) delete process.env.AI_TEST_PROVIDER_KEY; else process.env.AI_TEST_PROVIDER_KEY = oldSecret;
  }
});
