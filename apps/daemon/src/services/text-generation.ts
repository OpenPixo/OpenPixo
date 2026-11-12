import { googleGenerateContentUrl } from '../integrations/google-models.js';
type TextProviderProtocol = 'anthropic' | 'openai' | 'azure' | 'google' | 'ollama';

const INPUT_BODY_CAP_BYTES = 384 * 1024;

export const DEFAULT_TIMEOUT_MS = 120_000;

export class TextGenerationError extends Error {
  status: number;
  rawText: string;
  constructor(status: number, rawText: string, message?: string) {
    super(message || `upstream Anthropic returned ${status}`);
    this.name = 'TextGenerationError';
    this.status = status;
    this.rawText = rawText;
  }
}

export function appendVersionedApiPath(baseUrl: string, suffix: string): string {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = /\/v\d+(\/|$)/.test(pathname) ? `${pathname}${suffix}` : `${pathname}/v1${suffix}`;
  return url.toString();
}

export interface TextGenerationCallParams {
  protocol: TextProviderProtocol;
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  systemPrompt: string;
  userPrompt: string;
  apiVersion?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof globalThis.fetch;
  /** Test-only: skip the inter-attempt sleep so retries are instant. */
  _sleepMs?: (ms: number) => Promise<void>;
}

export type AnthropicCallParams = Omit<TextGenerationCallParams, 'protocol' | 'apiVersion'>;

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface TextGenerationHttpRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function buildAzureChatCompletionsUrl(baseUrl: string, model: string, apiVersion?: string): {
  url: string;
  usesVersionedOpenAIPath: boolean;
} {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, '');
  const usesVersionedOpenAIPath = /\/openai\/v\d+(?:$|\/)/.test(basePath);
  const version =
    apiVersion && apiVersion.trim()
      ? apiVersion.trim()
      : usesVersionedOpenAIPath
        ? ''
        : '2024-10-21';
  url.pathname = usesVersionedOpenAIPath
    ? `${basePath}/chat/completions`
    : `${basePath}/openai/deployments/${encodeURIComponent(model)}/chat/completions`;
  if (usesVersionedOpenAIPath && !version) {
    url.searchParams.delete('api-version');
  }
  if (version) {
    url.searchParams.set('api-version', version);
  }
  return { url: url.toString(), usesVersionedOpenAIPath };
}

function buildTextProviderRequest(params: TextGenerationCallParams): TextGenerationHttpRequest {
  const payloadMessages = [
    { role: 'system', content: params.systemPrompt },
    { role: 'user', content: params.userPrompt },
  ];

  if (params.protocol === 'anthropic') {
    return {
      url: appendVersionedApiPath(params.baseUrl, '/messages'),
      headers: {
        'content-type': 'application/json',
        'x-api-key': params.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: params.model,
        max_tokens: params.maxTokens,
        system: params.systemPrompt,
        messages: [{ role: 'user', content: params.userPrompt }],
        stream: false,
      },
    };
  }

  if (params.protocol === 'openai') {
    return {
      url: appendVersionedApiPath(params.baseUrl, '/chat/completions'),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${params.apiKey}`,
      },
      body: {
        model: params.model,
        messages: payloadMessages,
        max_tokens: params.maxTokens,
        stream: false,
      },
    };
  }

  if (params.protocol === 'azure') {
    const { url, usesVersionedOpenAIPath } = buildAzureChatCompletionsUrl(
      params.baseUrl,
      params.model,
      params.apiVersion,
    );
    return {
      url,
      headers: {
        'content-type': 'application/json',
        'api-key': params.apiKey,
      },
      body: {
        ...(usesVersionedOpenAIPath ? { model: params.model } : {}),
        messages: payloadMessages,
        max_tokens: params.maxTokens,
        stream: false,
      },
    };
  }

  if (params.protocol === 'google') {
    return {
      url: googleGenerateContentUrl(params.baseUrl, params.model),
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': params.apiKey,
      },
      body: {
        contents: [
          {
            role: 'user',
            parts: [{ text: params.userPrompt }],
          },
        ],
        systemInstruction: {
          parts: [{ text: params.systemPrompt }],
        },
        generationConfig: {
          maxOutputTokens: params.maxTokens,
        },
      },
    };
  }

  const clean = params.baseUrl.replace(/\/+$/, '').replace(/\/api\/?$/, '');
  return {
    url: `${clean}/api/chat`,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${params.apiKey}`,
    },
    body: {
      model: params.model,
      messages: payloadMessages,
      stream: false,
      options: { num_predict: params.maxTokens },
    },
  };
}

function providerLabel(protocol: TextProviderProtocol): string {
  if (protocol === 'google') return 'Google Gemini';
  if (protocol === 'openai') return 'OpenAI';
  if (protocol === 'azure') return 'Azure OpenAI';
  if (protocol === 'ollama') return 'Ollama';
  return 'Anthropic';
}

export async function callTextProviderWithRetry(
  params: TextGenerationCallParams,
): Promise<Response> {
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  const sleep = params._sleepMs ?? defaultSleep;
  const request = buildTextProviderRequest(params);
  const body = JSON.stringify(request.body);

  for (let attempt = 0; attempt <= 1; attempt += 1) {
    const init: RequestInit = {
      method: 'POST',
      headers: request.headers,
      body,
      redirect: 'error',
    };
    if (params.signal) init.signal = params.signal;
    const response = await fetchImpl(request.url, init);
    if (response.ok) return response;

    const transient = response.status === 429 || response.status >= 500;
    if (!transient || attempt === 1) {
      const text = await response.text().catch(() => '');
      throw new TextGenerationError(
        response.status,
        text,
        `upstream ${providerLabel(params.protocol)} returned ${response.status}`,
      );
    }
    // Linear backoff: 1s on attempt 0. Two retries would extend to 2s on
    // attempt 1 — kept at one retry to stay within the daemon's blocking-
    // fast posture for `/finalize`.
    await sleep(1000 * (attempt + 1));
  }
  // Loop above always returns or throws within two iterations. This is
  // unreachable; satisfies TypeScript control-flow analysis.
  throw new Error('callTextProviderWithRetry: unreachable');
}

export async function callAnthropicWithRetry(
  params: AnthropicCallParams,
): Promise<Response> {
  return callTextProviderWithRetry({ ...params, protocol: 'anthropic' });
}

export function extractResponseText(
  payload: unknown,
  protocol: TextProviderProtocol = 'anthropic',
): string {
  if (!payload || typeof payload !== 'object') {
    throw new TextGenerationError(
      502,
      '',
      `upstream ${providerLabel(protocol)} response was not an object`,
    );
  }

  let out = '';

  if (protocol === 'anthropic') {
    const content = (payload as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      throw new TextGenerationError(
        502,
        '',
        'upstream Anthropic response had no content array',
      );
    }
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as { type?: unknown; text?: unknown };
      if (b.type === 'text' && typeof b.text === 'string') out += b.text;
    }
  } else if (protocol === 'openai' || protocol === 'azure') {
    const choices = (payload as { choices?: unknown }).choices;
    if (!Array.isArray(choices)) {
      throw new TextGenerationError(
        502,
        '',
        `upstream ${providerLabel(protocol)} response had no choices array`,
      );
    }
    for (const choice of choices) {
      if (!choice || typeof choice !== 'object') continue;
      const message = (choice as { message?: { content?: unknown }; text?: unknown }).message;
      if (typeof message?.content === 'string') out += message.content;
      if (typeof (choice as { text?: unknown }).text === 'string') {
        out += (choice as { text: string }).text;
      }
    }
  } else if (protocol === 'google') {
    const candidates = (payload as { candidates?: unknown }).candidates;
    if (!Array.isArray(candidates)) {
      throw new TextGenerationError(
        502,
        '',
        'upstream Google Gemini response had no candidates array',
      );
    }
    for (const candidate of candidates) {
      const parts = (candidate as { content?: { parts?: unknown } } | null)?.content?.parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
          out += (part as { text: string }).text;
        }
      }
    }
  } else {
    const message = (payload as { message?: { content?: unknown } }).message;
    if (typeof message?.content === 'string') out += message.content;
  }

  if (out.length === 0) {
    throw new TextGenerationError(
      502,
      '',
      `upstream ${providerLabel(protocol)} response contained no text`,
    );
  }
  return out;
}

export function truncateTranscriptForPrompt(jsonl: string): string {
  const buf = Buffer.from(jsonl, 'utf8');
  if (buf.byteLength <= INPUT_BODY_CAP_BYTES) return jsonl;

  const lines = jsonl.split('\n');
  const header = lines[0] ?? '';
  const body = lines.slice(1);

  const markerLine = '{"kind":"truncated","reason":"size","omittedBytes":__N__}';
  const reservedBytes =
    Buffer.byteLength(header + '\n', 'utf8') +
    Buffer.byteLength(markerLine + '\n', 'utf8') +
    64;
  const perSideBudget = Math.floor((INPUT_BODY_CAP_BYTES - reservedBytes) / 2);

  const headLines: string[] = [];
  let headBytes = 0;
  let headIndex = 0;
  for (; headIndex < body.length; headIndex += 1) {
    const line = body[headIndex] ?? '';
    const lineBytes = Buffer.byteLength(line + '\n', 'utf8');
    if (headBytes + lineBytes > perSideBudget) break;
    headLines.push(line);
    headBytes += lineBytes;
  }

  const tailLines: string[] = [];
  let tailBytes = 0;
  for (let i = body.length - 1; i >= headIndex; i -= 1) {
    const line = body[i] ?? '';
    const lineBytes = Buffer.byteLength(line + '\n', 'utf8');
    if (tailBytes + lineBytes > perSideBudget) break;
    tailLines.unshift(line);
    tailBytes += lineBytes;
  }

  if (headLines.length + tailLines.length >= body.length) {
    // Head + tail covers the whole body — no truncation needed beyond the
    // marker reservation. Return verbatim.
    return [header, ...headLines, ...tailLines].join('\n');
  }

  const without = [header, ...headLines, ...tailLines].join('\n');
  const omittedBytes = buf.byteLength - Buffer.byteLength(without, 'utf8');
  const marker = markerLine.replace('__N__', String(omittedBytes));
  return [header, ...headLines, marker, ...tailLines].join('\n');
}
