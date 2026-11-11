import { getSetting } from '../db.js';

export type LlmProvider = 'ollama' | 'vllm' | 'deepseek' | 'gemini';

// Reasoning models (Qwen3 and friends) emit a chain-of-thought that isn't
// part of `content` but does eat into `max_tokens`, so a tight budget leaves
// nothing for the actual answer — same failure mode as Ollama's `think`
// field, addressed the same way. `chat_template_kwargs` is vLLM's pass-through
// to the tokenizer's chat template; non-thinking models/templates ignore it.
const VLLM_NO_THINK = { chat_template_kwargs: { enable_thinking: false } };

// Gemini has the same problem, but it cannot be switched off: on Gemini 3 and
// 4 thinking is always on, and thought tokens are charged to `max_tokens`. A
// 220-token coach answer therefore came back empty. Ask for the cheapest
// reasoning level and pay for headroom on top of the answer budget instead.
const GEMINI_LOW_EFFORT = { reasoning_effort: 'low' };
// `low` is a 1024-token thinking budget on Gemini 2.5 and can run past that on
// 3.x, so reserve a couple of thousand on top of the answer budget. Output is
// billed as generated, not as reserved, so the headroom costs nothing.
const GEMINI_THINK_HEADROOM = 2048;

// DeepSeek and Gemini are hosted OpenAI-compatible APIs. They are the "cloud
// LLM" options alongside local Ollama / self-hosted vLLM. Unlike the local
// providers, their URLs have sensible defaults and the API key is the real
// "configured" signal.
const DEEPSEEK_BASE = 'https://api.deepseek.com';
// Gemini's OpenAI-compatible root (not the native `generateContent` API).
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';

export interface LlmModel { name: string; size: number; details?: { parameter_size?: string } }

export function llmProvider(): LlmProvider {
  const p = getSetting('llm_provider');
  if (p === 'vllm') return 'vllm';
  if (p === 'deepseek') return 'deepseek';
  if (p === 'gemini') return 'gemini';
  return 'ollama';
}

// API key of a hosted provider — env wins (Docker secrets), DB setting as
// fallback. Never returned to the client; the admin surface only reports
// whether one is set.
export function llmApiKey(provider: LlmProvider = llmProvider()): string | null {
  if (provider === 'deepseek') return process.env.DEEPSEEK_API_KEY || getSetting('deepseek_api_key') || null;
  if (provider === 'gemini') return process.env.GEMINI_API_KEY || getSetting('gemini_api_key') || null;
  return null;
}

// Ollama, vLLM, DeepSeek and Gemini are configured independently (own URL +
// model each), so switching the provider toggle doesn't clobber whichever one
// you aren't currently using — e.g. an Ollama box for quick local models, a
// vLLM server for a bigger one, and DeepSeek/Gemini for a cloud model,
// configured once each.
export function llmUrl(): string | null {
  const p = llmProvider();
  const url = p === 'vllm' ? getSetting('vllm_url')
    : p === 'deepseek' ? (getSetting('deepseek_url') || DEEPSEEK_BASE)
    : p === 'gemini' ? (getSetting('gemini_url') || GEMINI_BASE)
    : getSetting('ollama_url');
  return url ? url.replace(/\/$/, '') : null;
}

// Whether the currently-selected LLM is actually usable. For the hosted
// providers the URL always resolves to a default, so the API key is what makes
// them "configured"; the other two are configured once they have a URL.
export function llmConfigured(): boolean {
  const p = llmProvider();
  if (p === 'deepseek' || p === 'gemini') return !!llmApiKey(p);
  return !!llmUrl();
}

export function llmModel(): string {
  const p = llmProvider();
  if (p === 'vllm') return getSetting('vllm_model') || '';
  if (p === 'deepseek') return getSetting('deepseek_model') || 'deepseek-chat';
  // `-latest` aliases survive model retirements: `gemini-2.5-flash-lite`
  // already answers 404 "no longer available to new users" and is still listed
  // by /models, which is exactly how an admin picks a dead model. Flash-Lite
  // is also the model whose thinking fits a coach-sized budget.
  if (p === 'gemini') return getSetting('gemini_model') || 'gemini-flash-lite-latest';
  return getSetting('ollama_model') || 'gemma3:1b';
}

/** Comma-separated CSV of fallback models, tried in order on 404 / model-not-found. */
export function llmFallbackModels(): string[] {
  const csv = getSetting('ollama_fallback_models') ?? '';
  return csv.split(',').map((s) => s.trim()).filter(Boolean);
}

// Module-level: which models we've already verified are pulled/served this
// server lifetime. Avoids hitting the models endpoint on every call.
const verifiedModels = new Set<string>();
// p95 latency ring buffer for the admin /system surface.
const latencyRing: number[] = [];
const LATENCY_RING_MAX = 50;
function recordLatency(ms: number): void {
  latencyRing.push(ms);
  if (latencyRing.length > LATENCY_RING_MAX) latencyRing.shift();
}
export function llmStats(): { count: number; p95Ms: number | null; lastError: string | null; lastModelUsed: string | null } {
  const sorted = [...latencyRing].sort((a, b) => a - b);
  const p95Idx = Math.floor(sorted.length * 0.95);
  return {
    count: sorted.length,
    p95Ms: sorted.length ? Math.round(sorted[Math.min(p95Idx, sorted.length - 1)]!) : null,
    lastError,
    lastModelUsed,
  };
}
let lastError: string | null = null;
let lastModelUsed: string | null = null;

// OpenAI-compatible providers (vLLM, DeepSeek, Gemini) speak the same dialect;
// these helpers centralize the two places they differ — where the API root is
// and the auth header (hosted providers need a Bearer key, vLLM is usually
// unauthenticated).
//
// The vLLM URL is the bare server (`http://host:8000`) and its routes live
// under `/v1` — for models *and* chat. 7.15.0 dropped the `/v1` from the model
// list, which broke "Test" on every existing vLLM setup, and adding `/v1` to
// the URL as a workaround then broke chat (`/v1/v1/…`). A vLLM URL that already
// ends in `/v1` is accepted, since that is how OpenAI base URLs are usually
// written. DeepSeek's and Gemini's URLs are already API roots. server/test/
// llm-providers pins every route.
type OpenAiLike = 'vllm' | 'deepseek' | 'gemini';
export function isOpenAiLike(provider: LlmProvider): provider is OpenAiLike {
  return provider === 'vllm' || provider === 'deepseek' || provider === 'gemini';
}
export function openAiRoot(url: string, provider: OpenAiLike): string {
  const base = url.replace(/\/+$/, '');
  return provider === 'vllm' ? `${base.replace(/\/v1$/, '')}/v1` : base;
}
function openAiEndpoint(base: string, provider: OpenAiLike, path: 'models' | 'chat/completions' = 'chat/completions'): string {
  return `${openAiRoot(base, provider)}/${path}`;
}
function openAiHeaders(provider: OpenAiLike): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = llmApiKey(provider);
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}

// Gemini's model list is the native one under the OpenAI-compatible skin, so
// ids can come back as `models/gemini-…`. Chat only accepts the bare id, so
// normalize what we hand to the admin picker.
function normalizeModelName(provider: LlmProvider, id: string): string {
  return provider === 'gemini' ? id.replace(/^models\//, '') : id;
}

// A provider that rejects a chat request explains why in the body — a retired
// model ("…no longer available to new users, use X"), a wrong key, a quota.
// `llm_http_404` on its own sends the admin hunting; keeping the provider's
// sentence makes the error actionable in Admin → System.
async function httpDetail(res: Response): Promise<string> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      // Gemini wraps the error in an array: `[{"error":{"message":"…"}}]`.
      // DeepSeek, vLLM and Ollama send the object itself.
      const parsed = JSON.parse(text) as
        | { error?: string | { message?: string }; message?: string }
        | Array<{ error?: string | { message?: string }; message?: string }>;
      const body = Array.isArray(parsed) ? parsed[0] : parsed;
      detail = typeof body?.error === 'string' ? body.error : (body?.error?.message ?? body?.message ?? '');
    } catch {
      detail = text;
    }
  } catch { /* empty or already-consumed body */ }
  return detail.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** `llm_http_404: <why the provider said no>`. */
async function httpError(res: Response, label = 'llm_http'): Promise<Error> {
  const detail = await httpDetail(res);
  return new Error(detail ? `${label}_${res.status}: ${detail}` : `${label}_${res.status}`);
}

/** List models available on the configured host, normalized across providers.
 *  Ollama exposes its native `/api/tags`; vLLM (`/v1/models`), DeepSeek
 *  (`/models`) and Gemini (`/v1beta/openai/models`) expose the
 *  OpenAI-compatible list (one entry per served model). */
export async function testConnection(url: string, provider: LlmProvider = llmProvider()): Promise<{ ok: true; models: LlmModel[] } | { ok: false; error: string }> {
  const base = url.replace(/\/$/, '');
  try {
    if (isOpenAiLike(provider)) {
      if (provider !== 'vllm' && !llmApiKey(provider)) return { ok: false, error: `${provider}_api_key_missing` };
      const res = await fetch(openAiEndpoint(base, provider, 'models'), {
        headers: provider === 'vllm' ? undefined : { Authorization: `Bearer ${llmApiKey(provider) ?? ''}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { ok: false, error: httpStatus(await httpDetail(res), res.status) };
      const data = (await res.json()) as { data?: { id: string }[] };
      return { ok: true, models: (data.data ?? []).map((m) => ({ name: normalizeModelName(provider, m.id), size: 0 })) };
    }
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, error: httpStatus(await httpDetail(res), res.status) };
    const data = (await res.json()) as { models?: LlmModel[] };
    return { ok: true, models: data.models ?? [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Check whether a given model is available on the configured host. Caches
 *  positive results so repeated calls are cheap. Returns false on any error
 *  (caller falls back to next model). */
export async function ensureModel(model: string): Promise<boolean> {
  if (verifiedModels.has(model)) return true;
  const url = llmUrl();
  if (!url) return false;
  const res = await testConnection(url);
  if (!res.ok) return false;
  const ok = res.models.some((m) => m.name === model || m.name.split(':')[0] === model.split(':')[0]);
  if (ok) verifiedModels.add(model);
  return ok;
}

/** Resolve which model to use, walking the fallback chain. Returns the first
 *  model that's actually present; falls back to the configured default if
 *  none of the fallback list is present (the call will then fail loudly,
 *  which is the right surface — admin needs to know to pull/serve a model). */
export async function resolveModel(preferred?: string): Promise<string> {
  const want = preferred ?? llmModel();
  if (await ensureModel(want)) return want;
  for (const m of llmFallbackModels()) {
    if (await ensureModel(m)) return m;
  }
  return want;
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

interface ChatOpts {
  model?: string; temperature?: number; topP?: number; numPredict?: number;
  signal?: AbortSignal; hardTimeoutMs?: number; idleTimeoutMs?: number; fallback?: boolean;
}

// Streams response chunks. Calls `onChunk` per token batch.
// Hard timeout (default 120s) and idle timeout (default 30s) ensure silent
// failures (model loading forever, network hung) become loud errors.
export async function chatStream(messages: ChatMessage[], onChunk: (text: string) => void, opts: ChatOpts = {}): Promise<void> {
  if (!llmConfigured()) throw new Error('llm_not_configured');
  const url = llmUrl()!;
  const provider = llmProvider();
  const model = (opts.fallback === false) ? (opts.model ?? llmModel()) : await resolveModel(opts.model);
  lastModelUsed = model;
  const _started = Date.now();
  const hardMs = opts.hardTimeoutMs ?? 120_000;
  const idleMs = opts.idleTimeoutMs ?? 30_000;

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const hardTimer = setTimeout(() => ac.abort(new Error('llm_hard_timeout')), hardMs);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  function bumpIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => ac.abort(new Error('llm_idle_timeout')), idleMs);
  }
  bumpIdle();

  try {
    if (isOpenAiLike(provider)) {
      const body: Record<string, unknown> = {
        model, messages, stream: true,
        temperature: opts.temperature ?? 0.3,
        top_p: opts.topP ?? 0.9,
        max_tokens: (opts.numPredict ?? 220) + (provider === 'gemini' ? GEMINI_THINK_HEADROOM : 0),
      };
      if (provider === 'vllm') Object.assign(body, VLLM_NO_THINK);
      if (provider === 'gemini') Object.assign(body, GEMINI_LOW_EFFORT);
      const res = await fetch(openAiEndpoint(url, provider), {
        method: 'POST',
        headers: openAiHeaders(provider),
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok) throw await httpError(res);
      if (!res.body) throw new Error('llm_empty_body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bumpIdle();
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line || !line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const obj = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[]; error?: { message?: string } };
            if (obj.error) throw new Error(`llm_${obj.error.message ?? 'error'}`);
            const text = obj.choices?.[0]?.delta?.content;
            if (text) onChunk(text);
          } catch (err) {
            if ((err as Error).message?.startsWith('llm_')) throw err;
            // ignore malformed JSON lines
          }
        }
      }
    } else {
      const res = await fetch(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, messages, stream: true,
          // Reasoning models (gemma4, gpt-oss, …) emit a chain-of-thought into
          // `message.thinking` and only put the final answer into
          // `message.content`. With a tight num_predict that CoT eats the whole
          // budget and the user sees an empty stream. The coach is a faithful
          // FACTS renderer, not an analyst — disable reasoning everywhere.
          // Non-reasoning models silently ignore this flag.
          think: false,
          options: {
            temperature: opts.temperature ?? 0.3,
            top_p: opts.topP ?? 0.9,
            num_predict: opts.numPredict ?? 220,
          },
        }),
        signal: ac.signal,
      });
      if (!res.ok) throw await httpError(res);
      if (!res.body) throw new Error('llm_empty_body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bumpIdle();
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const obj = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string };
            if (obj.error) throw new Error(`llm_${obj.error}`);
            const text = obj.message?.content;
            if (text) onChunk(text);
          } catch (err) {
            if ((err as Error).message?.startsWith('llm_')) throw err;
            // ignore malformed JSON lines
          }
        }
      }
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    clearTimeout(hardTimer);
    if (idleTimer) clearTimeout(idleTimer);
    opts.signal?.removeEventListener('abort', onAbort);
    recordLatency(Date.now() - _started);
  }
}

// Non-streaming JSON-mode call. Used for batched game review where we need
// structured output (per-move comments + summary) in one response. Ollama's
// `format: "json"` and the OpenAI-compatible `response_format:
// {type:"json_object"}` both constrain the model to valid JSON; we still
// parse defensively.
export async function chatJson<T = unknown>(
  messages: ChatMessage[],
  opts: { model?: string; temperature?: number; numPredict?: number; signal?: AbortSignal; timeoutMs?: number; fallback?: boolean } = {},
): Promise<T> {
  if (!llmConfigured()) throw new Error('llm_not_configured');
  const url = llmUrl()!;
  const provider = llmProvider();
  const model = (opts.fallback === false) ? (opts.model ?? llmModel()) : await resolveModel(opts.model);
  lastModelUsed = model;
  const _started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 180_000;

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ac.abort(new Error('llm_hard_timeout')), timeoutMs);
  try {
    let raw: string;
    if (isOpenAiLike(provider)) {
      const body: Record<string, unknown> = {
        model, messages, stream: false,
        response_format: { type: 'json_object' },
        temperature: opts.temperature ?? 0.2,
        max_tokens: (opts.numPredict ?? 1500) + (provider === 'gemini' ? GEMINI_THINK_HEADROOM : 0),
      };
      if (provider === 'vllm') Object.assign(body, VLLM_NO_THINK);
      if (provider === 'gemini') Object.assign(body, GEMINI_LOW_EFFORT);
      const res = await fetch(openAiEndpoint(url, provider), {
        method: 'POST',
        headers: openAiHeaders(provider),
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok) throw await httpError(res);
      const data = await res.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
      if (data.error) throw new Error(`llm_${data.error.message ?? 'error'}`);
      raw = data.choices?.[0]?.message?.content ?? '';
    } else {
      const res = await fetch(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, messages, stream: false,
          format: 'json',
          think: false,
          options: {
            temperature: opts.temperature ?? 0.2,
            num_predict: opts.numPredict ?? 1500,
          },
        }),
        signal: ac.signal,
      });
      if (!res.ok) throw await httpError(res);
      const data = await res.json() as { message?: { content?: string }; error?: string };
      if (data.error) throw new Error(`llm_${data.error}`);
      raw = data.message?.content ?? '';
    }
    // Some models still wrap JSON in fences despite the json-mode request. Strip them.
    const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch (err) {
      throw new Error(`llm_bad_json: ${(err as Error).message}: ${cleaned.slice(0, 200)}`);
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
    recordLatency(Date.now() - _started);
  }
}

/** chatJson with a single retry on bad-JSON. The retry adds a "your previous
 *  reply was not valid JSON" addendum, which small models respond to well. */
export async function chatJsonRetry<T = unknown>(
  messages: ChatMessage[],
  opts: { model?: string; temperature?: number; numPredict?: number; signal?: AbortSignal; timeoutMs?: number; fallback?: boolean } = {},
): Promise<T> {
  try {
    return await chatJson<T>(messages, opts);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (!msg.startsWith('llm_bad_json')) throw err;
    const retried: ChatMessage[] = [
      ...messages,
      { role: 'user', content: 'Your previous reply was not valid JSON. Reply ONLY with the JSON object, no surrounding text.' },
    ];
    return chatJson<T>(retried, opts);
  }
}

/** `HTTP 404: <why>` — the shape `testModel` reports. */
function httpStatus(detail: string, status: number): string {
  return detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
}

// Quick smoke test of a single model — sends a tiny prompt and reports timing.
export async function testModel(url: string, model: string, timeoutMs = 30_000, provider: LlmProvider = llmProvider()): Promise<{ ok: boolean; latencyMs: number; sample?: string; error?: string }> {
  const base = url.replace(/\/$/, '');
  const start = Date.now();
  try {
    if (isOpenAiLike(provider)) {
      const body: Record<string, unknown> = {
        model,
        messages: [{ role: 'user', content: 'Reply with exactly the word OK and nothing else.' }],
        stream: false,
        temperature: 0.1,
      };
      if (provider === 'vllm') Object.assign(body, VLLM_NO_THINK);
      if (provider === 'gemini') Object.assign(body, GEMINI_LOW_EFFORT);
      const res = await fetch(openAiEndpoint(base, provider), {
        method: 'POST',
        headers: openAiHeaders(provider),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) return { ok: false, latencyMs, error: httpStatus(await httpDetail(res), res.status) };
      const data = await res.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
      if (data.error) return { ok: false, latencyMs, error: data.error.message };
      const sample = (data.choices?.[0]?.message?.content ?? '').trim().slice(0, 80);
      return { ok: !!sample, latencyMs, sample };
    }
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly the word OK and nothing else.' }],
        stream: false,
        options: { temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) return { ok: false, latencyMs, error: httpStatus(await httpDetail(res), res.status) };
    const data = await res.json() as { message?: { content?: string }; error?: string };
    if (data.error) return { ok: false, latencyMs, error: data.error };
    const sample = (data.message?.content ?? '').trim().slice(0, 80);
    return { ok: !!sample, latencyMs, sample };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
  }
}
