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
        if (data === null) throw cloudServiceError();
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
        throw code === 'CLOUD_UNAVAILABLE' ? cloudServiceError() : new AccountError(code as OpenPixoAccountErrorCode);
      }
      if (typeof code === 'string' && PUBLISH_ERROR_CODES.includes(code as PublishErrorCode)) {
        const { refusedFiles: refused, credits } = record(value.error);
        throw new PublishCloudError(code as PublishErrorCode, record(value.error).message,
          Array.isArray(refused) ? refused.filter((file): file is string => typeof file === 'string' && file.length <= 1024).slice(0, 20) : undefined,
          code === 'PUBLISH_EXTRA_GAME_REQUIRED' && typeof credits === 'number' && Number.isSafeInteger(credits) && credits > 0 ? credits : undefined);
      }
      throw response.status === 401 ? new AccountError('ACCOUNT_SIGNED_OUT') : cloudServiceError();
    } catch (error) {
      if (error instanceof AccountError || error instanceof SupabaseAuthError || error instanceof PublishCloudError) throw error;
      throw new AccountError('CLOUD_UNAVAILABLE');
    }
  }
}
