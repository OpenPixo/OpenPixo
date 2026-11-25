import { OPENPIXO_ACCOUNT_ERROR_CODES, PUBLISH_ERROR_CODES, type OpenPixoAccountErrorCode, type PublishErrorCode } from '@openpixo/contracts';
import type { OpenPixoCloudConfig } from './config.js';
import { AccountError, cloudServiceError, PublishCloudError } from './errors.js';

export class SupabaseAuthError extends Error {
  constructor(readonly status: number, readonly code: string, readonly grantError: string) {
    super('Supabase authentication request failed.');
  }
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export class SupabaseClient {
  constructor(readonly config: OpenPixoCloudConfig) {}

  auth(route: string, method: 'GET' | 'POST', body?: unknown, token?: string): Promise<unknown> {
    return this.request(`${this.config.url}/auth/v1/${route}`, method, body, token, true);
  }

  edge(name: string, method: 'GET' | 'POST', body?: unknown, token?: string, query = ''): Promise<unknown> {
    return this.request(`${this.config.url}/functions/v1/${name}${query}`, method, body, token, false);
  }

  /** The agent gateway, which runs apart from the Edge Functions. */
  agent(route: string, method: 'GET' | 'POST', body?: unknown, token?: string, query = ''): Promise<unknown> {
    return this.request(`${this.config.agentUrl}/agent-chat/${route}${query}`, method, body, token, false);
  }

  /**
   * Streaming POST to the agent gateway. Returns the raw response, success or not, so
   * the caller can relay a stream; only a transport failure throws.
   */
  async agentStream(route: string, body: Uint8Array, token: string, headers: Record<string, string>, signal: AbortSignal, timeoutMs: number): Promise<Response> {
    try {
      return await fetch(`${this.config.agentUrl}/agent-chat/${route}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        headers: { ...headers, apikey: this.config.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body as Uint8Array<ArrayBuffer>,
      });
    } catch {
      throw new AccountError('CLOUD_UNAVAILABLE');
    }
  }

  /**
   * The character service, on an address of its own. The raw answer is returned, success or not: the
   * character module knows its codes. Only a transport failure throws.
   */
  /** Without a token only what is open to everyone answers. */
  async character(route: string, method: string, body: unknown, token: string | null, signal?: AbortSignal): Promise<Response> {
    if (!this.config.characterUrl) throw new AccountError('ACCOUNT_NOT_CONFIGURED');
    try {
      // A form takes a model a while to fill.
      return await fetch(`${this.config.characterUrl}/v1/${route}`, {
        method, redirect: 'error', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(180_000)]),
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new AccountError('CLOUD_UNAVAILABLE'); }
  }

  private async request(url: string, method: string, body: unknown, token: string | undefined, auth: boolean): Promise<unknown> {
    try {
      const response = await fetch(url, {
        // Hosted-generation submit can take a vendor round trip; auth stays short.
        method, redirect: 'error', signal: AbortSignal.timeout(auth ? 15_000 : 30_000),
        headers: { apikey: this.config.anonKey, Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status === 204 && response.ok) return null;
      const data: unknown = await response.json().catch(() => null);
      if (response.ok) {
        if (data === null) throw withCloudFailure(cloudServiceError(), response, null);
        return data;
      }
      const value = record(data);
      if (auth) {
        throw new SupabaseAuthError(response.status,
          typeof value.error_code === 'string' ? value.error_code : '',
          typeof value.error === 'string' ? value.error : '');
      }
      const code = record(value.error).code;
      if (typeof code === 'string' && OPENPIXO_ACCOUNT_ERROR_CODES.includes(code as OpenPixoAccountErrorCode)) {
        throw withCloudFailure(code === 'CLOUD_UNAVAILABLE' ? cloudServiceError() : new AccountError(code as OpenPixoAccountErrorCode), response, code);
      }
      if (typeof code === 'string' && PUBLISH_ERROR_CODES.includes(code as PublishErrorCode)) {
        const { refusedFiles: refused, credits } = record(value.error);
        throw new PublishCloudError(code as PublishErrorCode, record(value.error).message,
          Array.isArray(refused) ? refused.filter((file): file is string => typeof file === 'string' && file.length <= 1024).slice(0, 20) : undefined,
          code === 'PUBLISH_EXTRA_GAME_REQUIRED' && typeof credits === 'number' && Number.isSafeInteger(credits) && credits > 0 ? credits : undefined);
      }
      throw withCloudFailure(response.status === 401 ? new AccountError('ACCOUNT_SIGNED_OUT') : cloudServiceError(), response, code);
    } catch (error) {
      if (error instanceof AccountError || error instanceof SupabaseAuthError || error instanceof PublishCloudError) throw error;
      const unanswered = new AccountError('CLOUD_UNAVAILABLE');
      unanswered.cloud = { status: null, code: null, requestId: null };
      throw unanswered;
    }
  }
}

const CLOUD_CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;
const CLOUD_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
/** Where a cloud answer names its request; the first one present is kept. */
const REQUEST_ID_HEADERS = ['sb-request-id', 'x-request-id', 'cf-ray'] as const;

/** Notes what the answer said about the failure, for the log. The cloud's message stays out. */
function withCloudFailure<T extends AccountError>(error: T, response: Response, code: unknown): T {
  const requestId = REQUEST_ID_HEADERS.map(name => response.headers.get(name)?.trim() ?? '').find(value => CLOUD_REQUEST_ID.test(value)) ?? null;
  error.cloud = { status: response.status, code: typeof code === 'string' && CLOUD_CODE.test(code) ? code : null, requestId };
  return error;
}
