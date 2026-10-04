import type { AiNewsTask, AiNewsTaskType, AiNewsUsageMetadata } from "@gito/shared";
import { env } from "../config/env.js";
import type { AiNewsTaskRepository } from "../repositories/ai-news-task-repository.js";
import { formatSafeStoryUnderstandingValidationDiagnostic, StoryUnderstandingValidationError } from "./story-understanding-contract.js";

export type AiCapability = "text-generation" | "structured-output" | "json-schema" | "json-mode" | "tool-calling" | "streaming" | "vision" | "embeddings" | "image-generation" | "audio-input" | "audio-output" | "reasoning-controls" | "batch";
export type AiProviderCapabilities = Partial<Record<AiCapability, boolean>>;

/** Server-side provider profile. `provider` is an arbitrary configured profile ID;
 * `adapterType` selects a protocol implementation, not a vendor. */
export interface AiProviderConfiguration {
  provider: string;
  adapterType?: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  capabilities?: AiProviderCapabilities;
  timeoutMs?: number;
  fallbacks?: AiProviderConfiguration[];
}

interface ProviderProfileInput { type: string; model: string; baseUrl: string; apiKeyEnv?: string; capabilities?: AiProviderCapabilities; timeoutMs?: number; fallbacks?: string[] }

/** Resolve provider profiles and per-task routes from server-only environment
 * configuration. AI_PROVIDERS_JSON maps arbitrary profile IDs to adapter types;
 * AI_TASK_ROUTES_JSON maps task types to a primary profile and optional fallbacks. */
export function getAiProviderConfiguration(taskType?: string): AiProviderConfiguration {
  try {
    const profiles = process.env.AI_PROVIDERS_JSON ? JSON.parse(process.env.AI_PROVIDERS_JSON) as Record<string, ProviderProfileInput> : null;
    const routes = process.env.AI_TASK_ROUTES_JSON ? JSON.parse(process.env.AI_TASK_ROUTES_JSON) as Record<string, string | { provider?: string; fallbacks?: string[] }> : {};
    const routeValue = taskType ? routes[taskType] : undefined;
    const route = typeof routeValue === "string" ? { provider: routeValue, fallbacks: [] } : routeValue ?? { provider: undefined, fallbacks: [] };
    const activeId = route.provider ?? process.env.AI_ACTIVE_PROVIDER ?? env.aiProvider;
    const build = (id: string): AiProviderConfiguration => {
      if (profiles && profiles[id]) {
        const profile = profiles[id]!;
        if (!profile.type || !profile.model || !profile.baseUrl) throw new Error("invalid_profile");
        const apiKey = profile.apiKeyEnv ? process.env[profile.apiKeyEnv] ?? "" : env.aiApiKey;
        const timeoutMs = typeof profile.timeoutMs === "number" && Number.isFinite(profile.timeoutMs)
          ? Math.max(1_000, Math.min(120_000, Math.trunc(profile.timeoutMs))) : undefined;
        return { provider: id, adapterType: profile.type, model: profile.model, baseUrl: profile.baseUrl, apiKey,
          capabilities: profile.capabilities, timeoutMs };
      }
      if (profiles) throw new Error("unknown_profile");
      return { provider: id, adapterType: "openai-compatible", model: env.aiModel, baseUrl: env.aiBaseUrl, apiKey: env.aiApiKey };
    };
    const primary = build(activeId);
    const fallbackIds = [...(route.fallbacks ?? []), ...(profiles?.[activeId]?.fallbacks ?? [])];
    primary.fallbacks = fallbackIds.map((id) => build(id));
    return primary;
  } catch {
    throw new AiProviderError("unavailable");
  }
}

/** Canonical GiTO request. Task-specific schemas and validators remain owned by
 * their task contracts; adapters only translate this transport-level request. */
export interface AiProviderTaskRequest {
  taskId: string;
  taskType: AiNewsTaskType | "classification";
  articleId?: string | null;
  model: string;
  promptVersion: string;
  correlationId: string;
  instructions: string;
  input: unknown;
  content?: AiInputPart[];
  output: { mode: "json"; schema?: Record<string, unknown> };
  generation?: { temperature?: number; maxOutputTokens?: number; topP?: number };
  tools?: AiToolDefinition[];
  requiredCapabilities: AiCapability[];
  timeoutMs: number;
  retry: { maxAttempts: number };
  metadata?: Record<string, unknown>;
}

export type AiInputPart = { type: "text"; text: string } | { type: "image" | "audio"; mimeType: string; data: string } | { type: "file"; mimeType: string; uri: string };
export interface AiToolDefinition { name: string; description: string; inputSchema: Record<string, unknown> }

/** Canonical normalized response. Provider wire formats must not leave adapters. */
export interface AiProviderTaskResponse {
  output: unknown;
  text?: string;
  finishReason?: string | null;
  provider?: string;
  model?: string;
  requestId?: string | null;
  latencyMs?: number;
  usage?: AiNewsUsageMetadata | null;
  providerMetadata?: Record<string, unknown> | null;
}
export interface AiProviderExecutionMetadata { provider: string; model: string }

export interface AiProviderFailureDiagnostics {
  provider: string;
  model: string;
  url: string;
  httpStatus?: number;
  errorCode?: string;
  errorStatus?: string;
  errorType?: string;
  message?: string;
  errorBodyFormat?: "json" | "malformed_json" | "json_non_object" | "plain_text" | "empty" | "truncated" | "unreadable";
  jsonValueType?: "array" | "string" | "number" | "boolean" | "null" | "unknown";
  retryable: boolean;
}

const MAX_PROVIDER_DIAGNOSTIC_LENGTH = 2048;

export class AiProviderError extends Error {
  constructor(
    readonly code: "unavailable" | "configuration_missing" | "authentication_failed" | "access_denied" | "resource_not_found" | "rate_limited" | "request_rejected" | "upstream_unavailable" | "request_failed" | "response_invalid" | "capability_unsupported" | "timeout",
    readonly retryable = false,
    readonly diagnostics?: AiProviderFailureDiagnostics
  ) {
    super(code);
    this.name = "AiProviderError";
  }

  toDiagnosticMessage(): string | undefined {
    const detail = this.diagnostics;
    if (!detail) return undefined;
    return [
      "AI_PROVIDER_REQUEST_FAILED",
      `provider=${detail.provider}`,
      ...(detail.httpStatus == null ? [] : [`httpStatus=${detail.httpStatus}`]),
      `model=${detail.model}`,
      `url=${detail.url}`,
      ...(detail.errorCode == null ? [] : [`errorCode=${detail.errorCode}`]),
      ...(detail.errorStatus == null ? [] : [`errorStatus=${detail.errorStatus}`]),
      ...(detail.errorType == null ? [] : [`errorType=${detail.errorType}`]),
      ...(detail.errorBodyFormat == null ? [] : [`errorBodyFormat=${detail.errorBodyFormat}`]),
      ...(detail.jsonValueType == null ? [] : [`jsonValueType=${detail.jsonValueType}`]),
      ...(detail.message == null ? [] : [`message="${detail.message}"`]),
      `retryable=${detail.retryable}`
    ].join(" ").slice(0, MAX_PROVIDER_DIAGNOSTIC_LENGTH);
  }
}

export interface AiTaskProviderAdapter {
  /** Protocol/adapter key, such as `openai-compatible`; never a vendor allowlist. */
  readonly provider: string;
  readonly capabilities: AiProviderCapabilities;
  execute(request: AiProviderTaskRequest, configuration: AiProviderConfiguration): Promise<AiProviderTaskResponse>;
}

const GEMINI_OPENAI_COMPATIBLE_HOST = "generativelanguage.googleapis.com";
const GEMINI_OPENAI_COMPATIBLE_PATH = "/v1beta/openai/chat/completions";

function isGeminiOpenAiCompatibleEndpoint(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === GEMINI_OPENAI_COMPATIBLE_HOST;
  } catch {
    return false;
  }
}

function getProviderRequestUrl(baseUrl: string): string {
  if (!isGeminiOpenAiCompatibleEndpoint(baseUrl)) return baseUrl;
  const url = new URL(baseUrl);
  url.pathname = GEMINI_OPENAI_COMPATIBLE_PATH;
  url.hash = "";
  return url.toString();
}

function getProviderRequestModel(model: string, baseUrl: string): string {
  return isGeminiOpenAiCompatibleEndpoint(baseUrl) ? model.replace(/^google\//i, "") : model;
}

function safeDiagnosticText(value: string, apiKey: string, requestInput: unknown, maxLength = 240): string {
  let safe = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (apiKey) safe = safe.split(apiKey).join("[REDACTED]");
  safe = safe
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\b(?:authorization|api[_ -]?key|password|cookie)\b\s*[:=]\s*[^,\s;]+/gi, "[REDACTED]");

  const redactArticleStrings = (input: unknown): void => {
    if (typeof input === "string") {
      if (input.length >= 8) safe = safe.split(input).join("[ARTICLE_CONTENT]");
    } else if (Array.isArray(input)) {
      input.forEach(redactArticleStrings);
    } else if (input && typeof input === "object") {
      Object.values(input).forEach(redactArticleStrings);
    }
  };
  redactArticleStrings(requestInput);
  return safe.slice(0, maxLength);
}

function safeDiagnosticUrl(value: string, apiKey: string, requestInput: unknown): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "[non-http provider URL]";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return safeDiagnosticText(url.toString(), apiKey, requestInput, 512);
  } catch {
    return "[invalid provider URL]";
  }
}

async function readBoundedResponseText(response: Response, maxBytes = 4096): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytesRead = 0;
  while (bytesRead < maxBytes) {
    const chunk = await reader.read();
    if (chunk.done) {
      reader.releaseLock();
      return { text: `${text}${decoder.decode()}`, truncated: false };
    }
    const remaining = maxBytes - bytesRead;
    const bytes = chunk.value.subarray(0, remaining);
    bytesRead += bytes.byteLength;
    text += decoder.decode(bytes, { stream: true });
    if (chunk.value.byteLength > remaining) break;
  }
  try { await reader.cancel(); } finally { reader.releaseLock(); }
  return { text: `${text}${decoder.decode()}`, truncated: true };
}

type ProviderErrorFields = Pick<AiProviderFailureDiagnostics, "errorCode" | "errorStatus" | "errorType" | "message" | "errorBodyFormat" | "jsonValueType">;

function getJsonValueType(value: unknown): NonNullable<AiProviderFailureDiagnostics["jsonValueType"]> {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string": return "string";
    case "number": return "number";
    case "boolean": return "boolean";
    default: return "unknown";
  }
}

function getProviderErrorFields(text: string, truncated: boolean, apiKey: string, requestInput: unknown, includeBodyFormat: boolean): ProviderErrorFields {
  const withFormat = (format: NonNullable<AiProviderFailureDiagnostics["errorBodyFormat"]>) => includeBodyFormat ? { errorBodyFormat: format } : {};
  if (truncated) return { ...withFormat("truncated"), message: "Provider error response exceeded the diagnostic size limit" };
  if (!text.trim()) return withFormat("empty");
  try {
    const payload: unknown = JSON.parse(text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return {
        ...withFormat("json_non_object"),
        ...(includeBodyFormat ? { jsonValueType: getJsonValueType(payload) } : {}),
        message: "Malformed provider error response"
      };
    }
    const record = payload as Record<string, unknown>;
    const error = record.error && typeof record.error === "object" && !Array.isArray(record.error)
      ? record.error as Record<string, unknown>
      : record;
    const safeField = (value: string, maxLength: number) => (
      includeBodyFormat && /https?:\/\//i.test(value) ? undefined : safeDiagnosticText(value, apiKey, requestInput, maxLength)
    );
    const errorCode = typeof error.code === "string" || typeof error.code === "number"
      ? safeField(String(error.code), 80)
      : undefined;
    const errorStatus = typeof error.status === "string"
      ? safeField(error.status, 80)
      : undefined;
    const errorType = typeof error.type === "string"
      ? safeField(error.type, 80)
      : undefined;
    const message = typeof error.message === "string"
      ? safeField(error.message, 240)
      : undefined;
    return {
      ...withFormat("json"),
      ...(errorCode ? { errorCode } : {}),
      ...(errorStatus ? { errorStatus } : {}),
      ...(errorType ? { errorType } : {}),
      ...(message ? { message } : {})
    };
  } catch {
    if (/^\s*[\[{]/.test(text)) return { ...withFormat("malformed_json"), message: "Malformed provider error response" };
    if (includeBodyFormat) return { errorBodyFormat: "plain_text" };
    return { message: safeDiagnosticText(text, apiKey, requestInput) };
  }
}

/** Generic transport for any endpoint implementing the required OpenAI-compatible
 * chat-completions surface. No provider/vendor names or model names are embedded. */
export class OpenAiCompatibleTaskProvider implements AiTaskProviderAdapter {
  readonly provider: string;
  readonly capabilities: AiProviderCapabilities = { "text-generation": true, "structured-output": true, "json-mode": true };
  constructor(provider = "openai-compatible") { this.provider = provider; }

  async execute(request: AiProviderTaskRequest, configuration: AiProviderConfiguration): Promise<AiProviderTaskResponse> {
    if (!configuration.apiKey || !configuration.baseUrl || !configuration.model) throw new AiProviderError("configuration_missing");
    assertCapabilities(request, configuration, this.capabilities);
    const controller = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs || configuration.timeoutMs || 20_000);
    const requestUrl = getProviderRequestUrl(configuration.baseUrl);
    const requestModel = getProviderRequestModel(request.model, configuration.baseUrl);
    const diagnosticContext = {
      provider: safeDiagnosticText(configuration.provider, configuration.apiKey, request.input, 80),
      model: safeDiagnosticText(requestModel, configuration.apiKey, request.input, 120),
      url: safeDiagnosticUrl(requestUrl, configuration.apiKey, request.input)
    };
    try {
      const response = await fetch(requestUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${configuration.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: requestModel,
          ...(request.output.mode === "json" && supports(configuration, "json-mode", this.capabilities) ? { response_format: { type: "json_object" } } : {}),
          ...(request.generation?.temperature == null ? {} : { temperature: request.generation.temperature }),
          ...(request.generation?.maxOutputTokens == null ? {} : { max_tokens: request.generation.maxOutputTokens }),
          ...(request.generation?.topP == null ? {} : { top_p: request.generation.topP }),
          messages: [
            { role: "system", content: request.instructions || "Return JSON only." },
            { role: "user", content: JSON.stringify({ taskType: request.taskType, promptVersion: request.promptVersion, input: request.input }) }
          ]
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const code = response.status === 401 ? "authentication_failed"
          : response.status === 403 ? "access_denied"
          : response.status === 404 ? "resource_not_found"
              : response.status === 429 ? "rate_limited"
                : response.status >= 500 ? "upstream_unavailable" : "request_rejected";
        let providerBody: { text: string; truncated: boolean };
        let providerBodyReadFailed = false;
        try {
          providerBody = await readBoundedResponseText(response);
        } catch {
          providerBody = { text: "", truncated: false };
          providerBodyReadFailed = true;
        }
        const diagnostics: AiProviderFailureDiagnostics = {
          ...diagnosticContext,
          httpStatus: response.status,
          ...(providerBodyReadFailed
            ? { message: "Provider error response could not be read", ...(response.status >= 500 ? { errorBodyFormat: "unreadable" as const } : {}) }
            : getProviderErrorFields(providerBody.text, providerBody.truncated, configuration.apiKey, request.input, response.status >= 500)),
          retryable: response.status === 429 || response.status >= 500
        };
        throw new AiProviderError(code, diagnostics.retryable, diagnostics);
      }
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > 1024 * 1024) throw new AiProviderError("response_invalid");
      const responseText = await response.text();
      if (Buffer.byteLength(responseText, "utf8") > 1024 * 1024) throw new AiProviderError("response_invalid");
      let payload: { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>; id?: unknown; model?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
      try { payload = JSON.parse(responseText) as typeof payload; } catch { throw new AiProviderError("response_invalid"); }
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > 256 * 1024) throw new AiProviderError("response_invalid");
      let output: unknown;
      try { output = JSON.parse(content); } catch { throw new AiProviderError("response_invalid"); }
      return {
        output, text: content,
        finishReason: typeof payload.choices?.[0]?.finish_reason === "string" ? payload.choices[0].finish_reason : null,
        provider: configuration.provider, model: typeof payload.model === "string" ? payload.model : request.model,
        requestId: typeof payload.id === "string" ? payload.id : response.headers.get("x-request-id"), latencyMs: Date.now() - startedAt,
        usage: payload.usage ? { inputTokens: payload.usage.prompt_tokens ?? null, outputTokens: payload.usage.completion_tokens ?? null, totalTokens: payload.usage.total_tokens ?? null, estimatedCost: null, currency: null, providerReported: null } : null
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      const retryable = true;
      throw new AiProviderError(controller.signal.aborted ? "timeout" : "request_failed", retryable, { ...diagnosticContext, retryable });
    } finally { clearTimeout(timer); }
  }
}

function supports(configuration: AiProviderConfiguration, capability: AiCapability, adapterCapabilities: AiProviderCapabilities = {}): boolean {
  return adapterCapabilities[capability] === true && configuration.capabilities?.[capability] !== false;
}

function assertCapabilities(request: AiProviderTaskRequest, configuration: AiProviderConfiguration, adapterCapabilities: AiProviderCapabilities = {}): void {
  const required = new Set(request.requiredCapabilities);
  if (request.tools?.length) required.add("tool-calling");
  if (request.output.schema) required.add("json-schema");
  for (const part of request.content ?? []) {
    if (part.type === "image") required.add("vision");
    if (part.type === "audio") required.add("audio-input");
  }
  for (const capability of required) {
    if (!supports(configuration, capability, adapterCapabilities)) throw new AiProviderError("capability_unsupported");
  }
}

export class AiTaskProviderRegistry {
  private readonly adapters = new Map<string, AiTaskProviderAdapter>();

  register(adapter: AiTaskProviderAdapter): void {
    if (!adapter.provider.trim()) throw new Error("ai_provider_name_required");
    if (this.adapters.has(adapter.provider)) throw new Error("ai_provider_already_registered");
    this.adapters.set(adapter.provider, adapter);
  }

  get(_provider: string, adapterType = _provider): AiTaskProviderAdapter {
    const adapter = this.adapters.get(adapterType);
    if (!adapter) throw new AiProviderError("unavailable");
    return adapter;
  }
}

export function createAiTaskProviderRegistry(adapters: AiTaskProviderAdapter[] = []): AiTaskProviderRegistry {
  const registry = new AiTaskProviderRegistry();
  registry.register(new OpenAiCompatibleTaskProvider());
  for (const adapter of adapters) registry.register(adapter);
  return registry;
}

export type AiTaskOutputValidator = (output: unknown) => unknown;
export type AiValidatedOutputPersistence = (output: unknown, provider: AiProviderExecutionMetadata) => void;

/** Executes provider attempts through canonical requests; every attempt is run
 * through the same GiTO validator before persistence. */
export class AiNewsTaskRunner {
  constructor(private readonly repository: AiNewsTaskRepository, private readonly registry: AiTaskProviderRegistry, private readonly configuration: AiProviderConfiguration) {}

  async run(task: AiNewsTask, input: unknown, validateOutput?: AiTaskOutputValidator, persistValidatedOutput?: AiValidatedOutputPersistence): Promise<AiNewsTask> {
    const running = this.repository.start(task.id);
    const inputRecord = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const request: AiProviderTaskRequest = {
      taskId: running.id, taskType: running.taskType, articleId: running.articleId, model: running.model,
      promptVersion: running.promptVersion, correlationId: running.correlationId,
      instructions: typeof inputRecord.instructions === "string" ? inputRecord.instructions : "Return JSON only.", input,
      output: { mode: "json" }, generation: { temperature: 0 }, requiredCapabilities: ["text-generation", "structured-output"],
      timeoutMs: this.configuration.timeoutMs ?? 20_000, retry: { maxAttempts: 1 + (this.configuration.fallbacks?.length ?? 0) },
      metadata: { taskId: running.id, articleId: running.articleId, promptVersion: running.promptVersion }
    };
    const candidates = [this.configuration, ...(this.configuration.fallbacks ?? [])];
    let validationFailed = false;
    for (const [attemptIndex, configuration] of candidates.entries()) {
      let result: AiProviderTaskResponse;
      try {
        const adapter = this.registry.get(configuration.provider, configuration.adapterType ?? configuration.provider);
        assertCapabilities(request, configuration, adapter.capabilities);
        result = await adapter.execute({ ...request, model: configuration.model, timeoutMs: configuration.timeoutMs ?? request.timeoutMs }, configuration);
      } catch (error) {
        if (configuration !== candidates[candidates.length - 1]) continue;
        return this.failOrReadCurrent(
          running.id,
          error instanceof AiProviderError ? error.code : "provider_error",
          error instanceof AiProviderError ? error.toDiagnosticMessage() : undefined
        );
      }
      let output: unknown;
      try { output = validateOutput ? validateOutput(result.output) : result.output; }
      catch (error) {
        validationFailed = true;
        if (configuration !== candidates[candidates.length - 1]) continue;
        const diagnostic = error instanceof StoryUnderstandingValidationError
          ? formatSafeStoryUnderstandingValidationDiagnostic(error)
          : undefined;
        return this.failOrReadCurrent(running.id, "output_validation_failed", diagnostic);
      }
      const telemetry = { provider: result.provider ?? configuration.provider, model: result.model ?? configuration.model,
        attempt: attemptIndex + 1, validationSucceeded: true,
        ...(result.latencyMs == null ? {} : { latencyMs: result.latencyMs }), ...(result.finishReason == null ? {} : { finishReason: result.finishReason }),
        ...(result.requestId == null ? {} : { requestId: result.requestId }), ...(result.providerMetadata == null ? {} : { providerMetadata: result.providerMetadata }) };
      const usage = result.usage || Object.keys(telemetry).length > 2 ? { ...(result.usage ?? {}), providerReported: { ...(result.usage?.providerReported ?? {}), ...telemetry } } : result.usage;
      const actualProvider = { provider: result.provider ?? configuration.provider, model: result.model ?? configuration.model };
      try {
        return this.repository.complete(running.id, output, usage, persistValidatedOutput ? () => persistValidatedOutput(output, actualProvider) : undefined, actualProvider);
      } catch { return this.failOrReadCurrent(running.id, "persistence_error"); }
    }
    return this.failOrReadCurrent(running.id, validationFailed ? "output_validation_failed" : "provider_error");
  }

  private failOrReadCurrent(taskId: string, code: string, diagnostic?: string): AiNewsTask {
    try { return this.repository.fail(taskId, code, diagnostic); }
    catch {
      const latest = this.repository.getById(taskId);
      if (latest) return latest;
      throw new Error("ai_task_not_found");
    }
  }
}

/** One-shot gateway for AI workflows that do not create durable task records. */
export async function executeAiRequest(registry: AiTaskProviderRegistry, configuration: AiProviderConfiguration, request: AiProviderTaskRequest,
  validateOutput?: AiTaskOutputValidator): Promise<AiProviderTaskResponse> {
  const candidates = [configuration, ...(configuration.fallbacks ?? [])];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const adapter = registry.get(candidate.provider, candidate.adapterType ?? candidate.provider);
      assertCapabilities(request, candidate, adapter.capabilities);
      const result = await adapter.execute({ ...request, model: candidate.model, timeoutMs: candidate.timeoutMs ?? request.timeoutMs }, candidate);
      validateOutput?.(result.output);
      return result;
    } catch (error) { lastError = error; }
  }
  if (lastError instanceof AiProviderError) throw lastError;
  throw new AiProviderError("request_failed");
}
