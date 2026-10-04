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
    await provider.execute(request,
    { provider: "openai-compatible", model: "mock", baseUrl: "https://provider.invalid", apiKey: "test-only" });
    const userPayload = JSON.parse(captured.messages[1].content);
    assert.equal(captured.model, "mock");
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
