import { createHash, randomBytes } from 'node:crypto';
import type {
  GoogleSignInAttemptResponse, OpenPixoEntitlement, OpenPixoGenerationParams, OpenPixoAccountStatus, OpenPixoAuthProvider, OpenPixoUser,
  StartEmailSignInResponse, StartGoogleSignInResponse,
} from '@openpixo/contracts';
import { readOpenPixoCloudConfig, type OpenPixoCloudConfig } from './config.js';
import { AGENT_RESPONSE_TIMEOUT_MS, agentModels, agentRunUsage, assertAgentRunKey } from './agent-gateway.js';
import {
  assertJobId, assertQuoteId, assertServiceId, CLOUD_REQUEST_ID, generationJob, generationParams, generationQuote, generationReference, generationServices,
} from './cloud-media.js';
import { checkoutResponse, creditsCatalog, creditsLedger, creditsSummary, entitlementsResponse, planChangeQuote, planChangeResponse, portalResponse, storeDownloadResponse, storePurchaseResponse } from './credits.js';
import { AccountError, accountError } from './errors.js';
import { onlineResetResponse, onlineStatusResponse } from './online-cloud.js';
import { publishBeginResponse, publishFinishResponse, shareLimitResponse, shareStatusResponse, type PublishBeginInput } from './publish-cloud.js';
import { DpapiSecretStore, type SecretStore } from './secret-store.js';
import { record, SupabaseAuthError, SupabaseClient } from './supabase.js';

const ATTEMPT_TTL_MS = 10 * 60 * 1000;
const EMAIL_RESEND_MS = 60 * 1000;
const ENTITLEMENTS_TTL_MS = 30 * 1000;
const INVALID_REFRESH_CODES = new Set([
  'refresh_token_not_found', 'refresh_token_already_used', 'session_not_found', 'session_expired',
  'user_not_found', 'user_banned', 'invalid_grant',
]);

interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshAt: number;
  user: OpenPixoUser;
}

interface Attempt {
  expiresAt: number;
  revision: number;
  verifier: string | null;
  used: boolean;
  state: GoogleSignInAttemptResponse['state'];
  error: GoogleSignInAttemptResponse['error'];
}

export interface OpenPixoAccountServiceOptions {
  /** The daemon's already resolved data root. There is deliberately no fallback. */
  dataRoot: string;
  port: () => number;
  config?: OpenPixoCloudConfig | null;
  secretStore?: SecretStore;
  now?: () => number;
}

function assertPlanSku(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9_]{1,100}$/u.test(value)) throw new AccountError('BILLING_SKU_UNKNOWN');
  return value;
}

function emailAddress(value: unknown): string {
  if (typeof value !== 'string') throw new AccountError('ACCOUNT_EMAIL_INVALID');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || /[\x00-\x1f\x7f]/u.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new AccountError('ACCOUNT_EMAIL_INVALID');
  return email;
}

function requiredText(value: unknown, max = 16_384): string {
  if (typeof value !== 'string' || !value || value.length > max) throw new AccountError('CLOUD_UNAVAILABLE');
  return value;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 2048 ? value : null;
}

function cloudUser(value: unknown, provider: OpenPixoAuthProvider): OpenPixoUser {
  const user = record(value);
  const metadata = record(user.user_metadata);
  const avatar = optionalText(metadata.avatar_url ?? metadata.picture);
  return {
    id: requiredText(user.id, 128), email: emailAddress(user.email), provider,
    displayName: optionalText(metadata.full_name ?? metadata.name),
    avatarUrl: avatar && /^https:\/\//u.test(avatar) ? avatar : null,
  };
}

function authError(error: unknown, context: 'email' | 'verify' | 'login'): AccountError {
  if (!(error instanceof SupabaseAuthError)) return accountError(error);
  if (error.status === 429) return new AccountError('ACCOUNT_OTP_RATE_LIMITED', 60);
  if (error.status >= 500) return new AccountError('CLOUD_UNAVAILABLE');
  return new AccountError(context === 'email' ? 'ACCOUNT_EMAIL_INVALID'
    : context === 'verify' ? 'ACCOUNT_OTP_INVALID' : 'ACCOUNT_LOGIN_FAILED');
}

export class OpenPixoAccountService {
  private readonly client: SupabaseClient | null;
  private readonly store: SecretStore;
  private readonly now: () => number;
  private readonly port: () => number;
  private readonly ready: Promise<void>;
  private storageAvailable = false;
  private session: Session | null = null;
  private revision = 0;
  private closed = false;
  private persistence = Promise.resolve();
  private refreshFlight: Promise<Session | null> | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly attempts = new Map<string, Attempt>();
  private readonly emailCooldowns = new Map<string, number>();
  private entitlementsCache: { revision: number; userId: string; at: number; value: OpenPixoEntitlement[] } | undefined;
  /** Bumped by every purchase so an entitlement read that raced it is not cached. */
  private purchases = 0;
  private readonly creditListeners = new Set<() => void>();

  constructor(options: OpenPixoAccountServiceOptions) {
    const config = options.config === undefined ? readOpenPixoCloudConfig() : options.config;
    this.client = config ? new SupabaseClient(config) : null;
    this.store = options.secretStore ?? new DpapiSecretStore(options.dataRoot);
    this.now = options.now ?? (() => Date.now());
    this.port = options.port;
    this.ready = this.load();
  }

  assertConfigured(): void { this.cloud(); }

  private cloud(): SupabaseClient {
    if (!this.client) throw new AccountError('ACCOUNT_NOT_CONFIGURED');
    return this.client;
  }

  private snapshot(): OpenPixoAccountStatus {
    const availability = !this.client ? 'not_configured' : this.storageAvailable ? 'available' : 'secure_storage_unavailable';
    const user = availability === 'available' && this.session ? { ...this.session.user } : null;
    return { availability, signedIn: user !== null, user };
  }

  async status(): Promise<OpenPixoAccountStatus> {
    await this.ready;
    // Status describes local availability even when refreshing the cloud session fails.
    if (this.client && this.storageAvailable) await this.currentSession().catch(() => {});
    return this.snapshot();
  }

  private async canSignIn(): Promise<void> {
    this.assertConfigured();
    await this.ready;
    if (!this.storageAvailable) throw new AccountError('ACCOUNT_SECURE_STORAGE_UNAVAILABLE');
    if (this.closed) throw new AccountError('ACCOUNT_LOGIN_FAILED');
  }

  private persist<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.persistence.then(operation);
    this.persistence = next.then(() => {}, () => {});
    return next;
  }

  private async load(): Promise<void> {
    if (!this.client) return;
    try {
      this.storageAvailable = await this.store.isAvailable();
      if (!this.storageAvailable) return;
      const raw = await this.store.read();
      if (raw === null || this.closed) return;
      try {
        const saved = record(JSON.parse(raw));
        if (saved.version !== 1 || saved.cloudUrl !== this.client.config.url) throw new Error('Session configuration changed.');
        const user = record(saved.user);
        if (user.provider !== 'email' && user.provider !== 'google') throw new Error('Invalid stored session.');
        const expiresAt = saved.expiresAt;
        if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) throw new Error('Invalid stored expiry.');
        this.session = {
          accessToken: requiredText(saved.accessToken), refreshToken: requiredText(saved.refreshToken),
          expiresAt, refreshAt: this.refreshAt(expiresAt),
          user: { id: requiredText(user.id, 128), email: emailAddress(user.email), provider: user.provider,
            displayName: optionalText(user.displayName), avatarUrl: optionalText(user.avatarUrl) },
        };
        this.scheduleRefresh();
      } catch {
        await this.store.clear();
      }
    } catch {
      this.storageAvailable = false;
      this.session = null;
    }
  }

  private refreshAt(expiresAt: number): number {
    return expiresAt - Math.min(60_000, Math.max(1000, (expiresAt - this.now()) / 5));
  }

  private async remoteSession(value: unknown, provider: OpenPixoAuthProvider, existingUser?: OpenPixoUser): Promise<Session> {
    const data = record(value);
    const accessToken = requiredText(data.access_token);
    const refreshToken = requiredText(data.refresh_token);
    const expiresAt = typeof data.expires_at === 'number' ? data.expires_at * 1000
      : typeof data.expires_in === 'number' ? this.now() + data.expires_in * 1000 : NaN;
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) throw new AccountError('CLOUD_UNAVAILABLE');
    const user = existingUser ?? cloudUser(await this.cloud().auth('user', 'GET', undefined, accessToken), provider);
    return { accessToken, refreshToken, expiresAt, refreshAt: this.refreshAt(expiresAt), user };
  }

  private async installSession(session: Session, revision: number, expectedSession?: Session): Promise<boolean> {
    return this.persist(async () => {
      if (this.closed || revision !== this.revision || (expectedSession && this.session !== expectedSession)) return false;
      try {
        await this.store.write(JSON.stringify({ version: 1, cloudUrl: this.cloud().config.url, ...session }));
      } catch {
        this.storageAvailable = false;
        this.session = null;
        this.stopRefresh();
        throw new AccountError('ACCOUNT_SECURE_STORAGE_UNAVAILABLE');
      }
      if (this.closed || revision !== this.revision || (expectedSession && this.session !== expectedSession)) return false;
      this.storageAvailable = true;
      this.session = session;
      this.scheduleRefresh();
      return true;
    });
  }

  private beginSignIn(): number {
    for (const attempt of this.attempts.values()) {
      if (attempt.state === 'pending') {
        attempt.used = true; attempt.verifier = null; attempt.state = 'failed'; attempt.error = 'ACCOUNT_LOGIN_FAILED';
      }
    }
    return ++this.revision;
  }

  async startEmail(value: unknown): Promise<StartEmailSignInResponse> {
    await this.canSignIn();
    const email = emailAddress(value);
    for (const [address, expiry] of this.emailCooldowns) if (expiry <= this.now()) this.emailCooldowns.delete(address);
    const nextSend = this.emailCooldowns.get(email);
    if (nextSend !== undefined || this.emailCooldowns.size >= 1000) {
      throw new AccountError('ACCOUNT_OTP_RATE_LIMITED', Math.max(1, Math.ceil(((nextSend ?? this.now() + EMAIL_RESEND_MS) - this.now()) / 1000)));
    }
    this.emailCooldowns.set(email, this.now() + EMAIL_RESEND_MS);
    try { await this.cloud().auth('otp', 'POST', { email, create_user: true }); }
    catch (error) { throw authError(error, 'email'); }
    return { resendAfterSec: EMAIL_RESEND_MS / 1000 };
  }

  async verifyEmail(emailValue: unknown, codeValue: unknown): Promise<OpenPixoAccountStatus> {
    await this.canSignIn();
    const email = emailAddress(emailValue);
    if (typeof codeValue !== 'string' || !/^\d{6,10}$/u.test(codeValue.trim())) throw new AccountError('ACCOUNT_OTP_INVALID');
    const revision = this.beginSignIn();
    try {
      const data = await this.cloud().auth('verify', 'POST', { type: 'email', email, token: codeValue.trim() });
      const session = await this.remoteSession(data, 'email');
      if (!await this.installSession(session, revision)) throw new AccountError('ACCOUNT_LOGIN_FAILED');
      return this.snapshot();
    } catch (error) { throw authError(error, 'verify'); }
  }

  async startGoogle(): Promise<StartGoogleSignInResponse> {
    await this.canSignIn();
    const port = this.port();
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AccountError('ACCOUNT_LOGIN_FAILED');
    for (const [id, attempt] of this.attempts) if (attempt.expiresAt + ATTEMPT_TTL_MS <= this.now()) this.attempts.delete(id);
    if (this.attempts.size >= 100) this.attempts.delete(this.attempts.keys().next().value!);
    const revision = this.beginSignIn();
    const attemptId = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + ATTEMPT_TTL_MS;
    this.attempts.set(attemptId, { expiresAt, revision, verifier, used: false, state: 'pending', error: null });
    const callback = new URL(`http://127.0.0.1:${port}/api/openpixo/account/callback`);
    callback.searchParams.set('attempt', attemptId);
    const url = new URL(`${this.cloud().config.url}/auth/v1/authorize`);
    url.search = new URLSearchParams({ provider: 'google', redirect_to: callback.href,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 's256' }).toString();
    return { attemptId, authorizeUrl: url.href, expiresAt: new Date(expiresAt).toISOString() };
  }

  private attempt(id: unknown): Attempt {
    const attempt = typeof id === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(id) ? this.attempts.get(id) : undefined;
    if (!attempt) throw new AccountError('ACCOUNT_LOGIN_EXPIRED');
    if (attempt.state === 'pending' && attempt.expiresAt <= this.now()) {
      attempt.state = 'expired'; attempt.verifier = null; attempt.used = true;
    }
    return attempt;
  }

  async googleAttempt(id: unknown): Promise<GoogleSignInAttemptResponse> {
    await this.canSignIn();
    const attempt = this.attempt(id);
    if (attempt.state === 'completed' && (attempt.revision !== this.revision || !this.session)) {
      return { state: 'failed', error: 'ACCOUNT_LOGIN_FAILED', account: null };
    }
    return { state: attempt.state, error: attempt.error, account: attempt.state === 'completed' ? this.snapshot() : null };
  }

  async completeGoogle(id: unknown, code: unknown, providerError = false): Promise<void> {
    await this.canSignIn();
    const attempt = this.attempt(id);
    if (attempt.state === 'expired' || attempt.expiresAt <= this.now()) throw new AccountError('ACCOUNT_LOGIN_EXPIRED');
    if (attempt.used || !attempt.verifier || attempt.revision !== this.revision) throw new AccountError('ACCOUNT_LOGIN_FAILED');
    const verifier = attempt.verifier;
    // Consume synchronously, before the first network await, including failed callbacks.
    attempt.used = true; attempt.verifier = null;
    try {
      if (providerError || typeof code !== 'string' || !code || code.length > 4096 || /[\s\x00-\x1f]/u.test(code)) {
        throw new AccountError('ACCOUNT_LOGIN_FAILED');
      }
      const data = await this.cloud().auth('token?grant_type=pkce', 'POST', { auth_code: code, code_verifier: verifier });
      const session = await this.remoteSession(data, 'google');
      if (attempt.expiresAt <= this.now()) throw new AccountError('ACCOUNT_LOGIN_EXPIRED');
      if (!await this.installSession(session, attempt.revision)) throw new AccountError('ACCOUNT_LOGIN_FAILED');
      attempt.state = 'completed';
    } catch (error) {
      const failure = authError(error, 'login');
      attempt.state = failure.code === 'ACCOUNT_LOGIN_EXPIRED' ? 'expired' : 'failed';
      attempt.error = attempt.state === 'failed' ? failure.code : null;
      throw failure;
    }
  }

  private stopRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  private scheduleRefresh(retryMs?: number): void {
    this.stopRefresh();
    if (this.closed || !this.storageAvailable || !this.session) return;
    this.refreshTimer = setTimeout(() => { void this.refresh().catch(() => {}); },
      Math.min(2_147_483_647, Math.max(1000, retryMs ?? this.session.refreshAt - this.now())));
    this.refreshTimer.unref();
  }

  private async currentSession(): Promise<Session | null> {
    if (this.refreshFlight) return this.refreshFlight;
    if (this.session && this.now() >= this.session.refreshAt) return this.refresh();
    return this.session;
  }

  private refresh(): Promise<Session | null> {
    if (this.refreshFlight) return this.refreshFlight;
    const session = this.session;
    if (!session || this.closed) return Promise.resolve(null);
    const revision = this.revision;
    let retry = false;
    this.refreshFlight = (async () => {
      try {
        const data = await this.cloud().auth('token?grant_type=refresh_token', 'POST', { refresh_token: session.refreshToken });
        const next = await this.remoteSession(data, session.user.provider, session.user);
        return await this.installSession(next, revision, session) ? next : this.session;
      } catch (error) {
        if (error instanceof SupabaseAuthError && (error.grantError === 'invalid_grant' || INVALID_REFRESH_CODES.has(error.code))) {
          if (this.session === session) await this.clearSession(revision);
          return this.session;
        }
        retry = true;
        throw error instanceof SupabaseAuthError ? new AccountError('CLOUD_UNAVAILABLE') : accountError(error);
      }
    })().finally(() => {
      this.refreshFlight = undefined;
      this.scheduleRefresh(retry ? 30_000 : undefined);
    });
    return this.refreshFlight;
  }

  private async clearSession(expectedRevision?: number): Promise<void> {
    if (expectedRevision !== undefined && expectedRevision !== this.revision) return;
    this.beginSignIn();
    this.session = null;
    this.stopRefresh();
    try { await this.persist(() => this.store.clear()); }
    catch {
      this.storageAvailable = false;
      throw new AccountError('ACCOUNT_SECURE_STORAGE_UNAVAILABLE');
    }
  }

  async signOut(): Promise<OpenPixoAccountStatus> {
    await this.ready;
    const token = this.session?.accessToken;
    await this.clearSession();
    // Local removal is already complete, even if the cloud cannot revoke this session.
    if (token && this.client) await this.client.auth('logout?scope=local', 'POST', undefined, token).catch(() => {});
    return this.snapshot();
  }

  private edge(name: string, method: 'GET' | 'POST', body?: unknown, query = ''): Promise<unknown> {
    return this.withSession(token => this.cloud().edge(name, method, body, token, query));
  }

  private async withSession(send: (token: string) => Promise<unknown>): Promise<unknown> {
    await this.canSignIn();
    const session = await this.currentSession();
    if (!session) throw new AccountError('ACCOUNT_SIGNED_OUT');
    const revision = this.revision;
    try {
      const result = await send(session.accessToken);
      if (revision !== this.revision || this.session?.user.id !== session.user.id || this.closed) throw new AccountError('ACCOUNT_SIGNED_OUT');
      return result;
    } catch (error) {
      if (error instanceof AccountError && error.code === 'ACCOUNT_SIGNED_OUT' && this.session?.accessToken === session.accessToken) {
        await this.clearSession(revision);
      }
      throw error;
    }
  }

  async balance() { return creditsSummary(await this.edge('credits', 'GET')); }
  async ledger(limit: number, cursor?: string) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor !== undefined) query.set('cursor', cursor);
    return creditsLedger(await this.edge('credits-ledger', 'GET', undefined, `?${query}`));
  }
  async catalog() { return creditsCatalog(await this.cloud().edge('catalog', 'GET')); }
  async checkout(value: unknown) {
    this.assertConfigured();
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(value)) throw new AccountError('BILLING_SKU_UNKNOWN');
    return checkoutResponse(await this.edge('create-checkout', 'POST', { sku: value }));
  }
  async portal() { return portalResponse(await this.edge('billing-portal', 'POST')); }

  /** What changing to this plan would charge, grant and when. Reads only. */
  async planChangePreview(value: unknown) {
    this.assertConfigured();
    return planChangeQuote(await this.edge('plan-change', 'POST', { action: 'preview', sku: assertPlanSku(value) }));
  }

  /** Charges the saved card for an upgrade. The cloud refuses any charge other than `expectedChargeMinor`. */
  async planChangeApply(value: unknown, expectedChargeMinor: unknown) {
    this.assertConfigured();
    if (!Number.isSafeInteger(expectedChargeMinor) || (expectedChargeMinor as number) < 0) throw new AccountError('BILLING_PLAN_QUOTE_CHANGED');
    try {
      return planChangeResponse(await this.edge('plan-change', 'POST', { action: 'apply', sku: assertPlanSku(value), expectedChargeMinor }));
    } finally { this.creditsChanged(); }
  }

  /** Abandons an upgrade waiting for verification, or undoes a pending downgrade. */
  async planChangeCancel() {
    this.assertConfigured();
    try { return planChangeResponse(await this.edge('plan-change', 'POST', { action: 'cancel' })); }
    finally { this.creditsChanged(); }
  }

  /** Spends credits on one Workshop item; the cloud prices it by SKU and charges an owned item only once. */
  async storePurchase(sku: string) {
    this.assertConfigured();
    if (!/^workshop\.[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(sku) || sku.length > 100) throw new AccountError('BILLING_SKU_UNKNOWN');
    try { return storePurchaseResponse(await this.edge('store-purchase', 'POST', { sku })); }
    finally { this.purchases++; this.entitlementsCache = undefined; this.creditsChanged(); }
  }

  /** A short-lived link to an owned Workshop pack. The cloud checks ownership; nothing is charged. */
  async storeDownload(itemName: string, version: string) {
    this.assertConfigured();
    if (!/^openpixo\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(itemName) || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/u.test(version)) {
      throw new AccountError('BILLING_SKU_UNKNOWN');
    }
    return storeDownloadResponse(await this.edge('store-download', 'POST', { itemName, version }), itemName, version);
  }

  /**
   * Called whenever this daemon did something that moves the balance, wherever it came from: a run
   * in another project, an agent's `pixo media generate`, the CLI. The UI re-reads on it, so nothing
   * has to poll while nothing is being spent.
   */
  onCreditsChanged(listener: () => void): () => void {
    this.creditListeners.add(listener);
    return () => { this.creditListeners.delete(listener); };
  }

  creditsChanged(): void {
    for (const listener of this.creditListeners) {
      try { listener(); } catch { /* a closed stream must not break spending */ }
    }
  }

  /** Briefly cached for catalogue reads; a sign-in change or a purchase invalidates it. */
  async entitlements(): Promise<OpenPixoEntitlement[]> {
    const cached = this.entitlementsCache;
    if (cached && cached.revision === this.revision && cached.userId === this.session?.user.id
      && this.now() - cached.at < ENTITLEMENTS_TTL_MS) return cached.value;
    const revision = this.revision;
    const purchases = this.purchases;
    const value = entitlementsResponse(await this.edge('store-entitlements', 'GET'));
    const userId = this.session?.user.id;
    if (userId && revision === this.revision && purchases === this.purchases) this.entitlementsCache = { revision, userId, at: this.now(), value };
    return value;
  }

  // --- Public links and room usage. The cloud owns rules, quotas and billing; see specs/current/publish-and-rooms.md.

  /** Opens an upload session. A retry after a failed upload reuses `shareId` and so keeps the link. */
  async publishBegin(input: PublishBeginInput) {
    this.assertConfigured();
    return publishBeginResponse(await this.edge('publish-begin', 'POST', input));
  }

  async publishFinish(shareId: string, version: number) {
    this.assertConfigured();
    return publishFinishResponse(await this.edge('publish-finish', 'POST', { shareId, version }));
  }

  async shareStatus(shareId?: string) {
    this.assertConfigured();
    return shareStatusResponse(await this.edge('share-status', 'GET', undefined, shareId ? `?shareId=${encodeURIComponent(shareId)}` : ''));
  }

  async shareRemove(shareId: string): Promise<void> {
    this.assertConfigured();
    await this.edge('share-remove', 'POST', { shareId });
  }

  async shareLimit(shareId: string, monthlyCreditLimit: number) {
    this.assertConfigured();
    return shareLimitResponse(await this.edge('share-limit', 'POST', { shareId, monthlyCreditLimit }));
  }

  // --- A published game's online features; see specs/current/online-features.md.

  async onlineStatus(shareId: string) {
    this.assertConfigured();
    return onlineStatusResponse(await this.edge('online-status', 'GET', undefined, `?shareId=${encodeURIComponent(shareId)}`));
  }

  /** Deletes every player and save of the published game. Only the creator's own request reaches this. */
  async onlineReset(shareId: string): Promise<void> {
    this.assertConfigured();
    onlineResetResponse(await this.edge('online-reset', 'POST', { shareId }));
  }

  // --- Hosted generation. The cloud prices, reserves and settles; these only relay validated DTOs.

  /** Public catalogue; works signed out so the UI can show prices first. */
  async generationServices() {
    this.assertConfigured();
    // `v=3` asks for every surface and every 3D tier. Without a version the cloud lists only what
    // app 1.0.0 can read; `v=2` is what 1.0.1 asks for, which has the medium 3D tier alone.
    return generationServices(await this.cloud().edge('generation-services', 'GET', undefined, undefined, '?v=3'));
  }

  async generationQuote(service: unknown, params: unknown) {
    this.assertConfigured();
    return generationQuote(await this.edge('generation-quote', 'POST', { service: assertServiceId(service), params: generationParams(params) }));
  }

  /** Registers a reference image by hash; returns an upload URL only when the file is not there yet. */
  async generationReference(sha256: string, mime: 'image/png' | 'image/jpeg' | 'image/webp', bytes: number) {
    this.assertConfigured();
    if (!/^[0-9a-f]{64}$/u.test(sha256) || !Number.isSafeInteger(bytes) || bytes < 1) throw new AccountError('GENERATION_PARAMS_INVALID');
    const result = generationReference(await this.edge('generation-reference', 'POST', { sha256, mime, bytes, delivery: 'direct' }));
    if (result.sha256 !== sha256) throw new AccountError('CLOUD_UNAVAILABLE');
    return result;
  }

  /** Idempotent per `idempotencyKey`: a retry returns the original job and never pays twice. */
  async generationSubmit(input: { quoteId: string; idempotencyKey: string; service: string; params: OpenPixoGenerationParams }) {
    this.assertConfigured();
    if (!CLOUD_REQUEST_ID.test(input.idempotencyKey)) throw new AccountError('GENERATION_PARAMS_INVALID');
    const job = generationJob(await this.edge('generation-submit', 'POST', { quoteId: assertQuoteId(input.quoteId),
      idempotencyKey: input.idempotencyKey, service: assertServiceId(input.service), params: generationParams(input.params), delivery: 'direct' }));
    this.creditsChanged();
    return job;
  }

  async generationJob(jobId: string) {
    this.assertConfigured();
    const job = generationJob(await this.edge('generation-status', 'GET', undefined, `?job=${encodeURIComponent(assertJobId(jobId))}`));
    // The hold settles when the job ends, and this is the daemon's first sight of that.
    if (job.state === 'succeeded' || job.state === 'failed') this.creditsChanged();
    return job;
  }

  // --- Hosted agent. The cloud meters and settles; the daemon only relays the stream.

  /** Public catalogue; works signed out so the UI can show prices first. */
  async agentModels() {
    this.assertConfigured();
    // v=2: a cloud answers older daemons with the shape they can parse.
    return agentModels(await this.cloud().agent('models', 'GET', undefined, undefined, '?v=2'));
  }

  async agentRunUsage(runKey: string) {
    this.assertConfigured();
    const run = assertAgentRunKey(runKey);
    return agentRunUsage(await this.withSession(token => this.cloud().agent('usage', 'GET', undefined, token, `?run=${encodeURIComponent(run)}`)));
  }

  /** True when a session exists locally; does not contact the cloud. */
  async hasSession(): Promise<boolean> {
    await this.ready;
    return Boolean(this.client && this.storageAvailable && this.session);
  }

  /**
   * One chat-completions request for the in-app agent, sent with the signed-in
   * user's session. The raw cloud response is returned for the caller to relay.
   */
  async agentCompletion(runKey: string, body: Uint8Array, signal: AbortSignal): Promise<Response> {
    await this.canSignIn();
    const session = await this.currentSession();
    if (!session) throw new AccountError('ACCOUNT_SIGNED_OUT');
    const revision = this.revision;
    const response = await this.cloud().agentStream('chat/completions', body, session.accessToken,
      { 'x-openpixo-run': assertAgentRunKey(runKey), Accept: 'text/event-stream, application/json' }, signal, AGENT_RESPONSE_TIMEOUT_MS);
    if (response.status === 401 && this.session?.accessToken === session.accessToken) await this.clearSession(revision);
    return response;
  }

  /** The cloud's own origin, which alone may use plain http and storage headers. */
  cloudOrigin(): string | null { return this.client?.config.url ?? null; }

  close(): void {
    this.closed = true;
    this.beginSignIn();
    this.stopRefresh();
  }
}
