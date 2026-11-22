import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CLOUD_ITEM_NAME, type CloudSkillCatalogEntry, type CloudSkillCatalogResponse, type CloudSkillsResponse, type CloudToolInfo,
} from '@openpixo/contracts';
import { AccountError } from '../account/errors.js';
import { listSkills, type SkillInfo } from '../skills.js';
import { downloadVerifiedFolder, type DownloadFetch } from '../store/verified-download.js';
import { CLOUD_SKILL_MANIFEST_BYTES, parseCloudSkillManifest } from './wire.js';

/**
 * Cloud skills live in `<data>/cloud-skills/<name>/`, one folder per skill, beside a `state.json`
 * that records what the last sync found. The folder is the daemon's own: Settings cannot edit or
 * delete what is in it, and a sync replaces it. A skill joins a run's skill index only on a run with
 * OpenPixo's hosted models, and never when a local skill has the same id.
 */

export interface CloudSkillsAccount {
  hasSession(): Promise<boolean>;
  skillCatalog(): Promise<CloudSkillCatalogResponse>;
  agentTools(): Promise<CloudToolInfo[]>;
}

interface SyncState {
  syncedAt: string | null;
  error: string | null;
  skills: CloudSkillCatalogEntry[];
  tools: CloudToolInfo[];
}

export class CloudSkillError extends Error {}

const STATE_FILE = 'state.json';
/** How old the last sync may be before a hosted run asks again. */
export const CLOUD_SKILLS_REFRESH_MS = 6 * 60 * 60 * 1000;
/** How long a hosted run waits for a sync before it starts with what it has. */
const RUN_WAIT_MS = 5_000;
const RETRY_AFTER_ERROR_MS = 5 * 60 * 1000;

const EMPTY: SyncState = { syncedAt: null, error: null, skills: [], tools: [] };

function failureMessage(error: unknown): string {
  if (error instanceof CloudSkillError || error instanceof AccountError) return error.message;
  return 'Cloud skills could not be updated. They will be tried again later.';
}

export class CloudSkillsService {
  private state: SyncState = EMPTY;
  private loaded: Promise<void> | null = null;
  private running: Promise<CloudSkillsResponse> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: {
    dir: string;
    account: CloudSkillsAccount;
    /** The ids of the local skills, which win over a cloud skill of the same id. */
    localSkillIds: () => Promise<readonly string[]>;
    fetch?: DownloadFetch;
    now?: () => Date;
  }) {}

  private now(): Date { return this.options.now?.() ?? new Date(); }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const value = JSON.parse(await readFile(path.join(this.options.dir, STATE_FILE), 'utf8')) as Partial<SyncState>;
        this.state = {
          syncedAt: typeof value.syncedAt === 'string' ? value.syncedAt : null,
          error: typeof value.error === 'string' ? value.error : null,
          skills: Array.isArray(value.skills) ? value.skills.filter((skill) => CLOUD_ITEM_NAME.test(String(skill?.name))) : [],
          tools: Array.isArray(value.tools) ? value.tools : [],
        };
      } catch { this.state = EMPTY; }
    })();
    return this.loaded;
  }

  private async save(): Promise<void> {
    await mkdir(this.options.dir, { recursive: true });
    const file = path.join(this.options.dir, STATE_FILE);
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(this.state, null, 2)}\n`);
    await rename(temp, file);
  }

  /** What is downloaded, which tools the cloud offers, and how the last sync went. */
  async status(): Promise<CloudSkillsResponse> {
    await this.load();
    const local = new Set(await this.options.localSkillIds().catch(() => []));
    return {
      skills: this.state.skills.map(({ name, version, title, description }) => ({ name, version, title, description, active: !local.has(name) })),
      tools: this.state.tools,
      syncedAt: this.state.syncedAt,
      error: this.state.error,
      signedIn: await this.options.account.hasSession().catch(() => false),
    };
  }

  /** One sync at a time; a call during a sync shares its result. */
  sync(): Promise<CloudSkillsResponse> {
    this.running ??= this.syncOnce().finally(() => { this.running = null; });
    return this.running;
  }

  private async syncOnce(): Promise<CloudSkillsResponse> {
    await this.load();
    if (!await this.options.account.hasSession().catch(() => false)) {
      // Signed out: keep what is downloaded; hosted runs need an account anyway.
      return this.status();
    }
    try {
      const [catalog, tools] = await Promise.all([this.options.account.skillCatalog(), this.options.account.agentTools()]);
      const installed = new Map(this.state.skills.map((skill) => [skill.name, skill.version]));
      const kept: CloudSkillCatalogEntry[] = [];
      let firstError: unknown = null;
      for (const entry of catalog.skills) {
        const target = path.join(this.options.dir, entry.name);
        const present = await stat(path.join(target, 'SKILL.md')).then((info) => info.isFile(), () => false);
        if (installed.get(entry.name) === entry.version && present) { kept.push(entry); continue; }
        try {
          await downloadVerifiedFolder({
            baseUrl: `${catalog.baseUrl}/${entry.name}/${encodeURIComponent(entry.version)}`, token: catalog.token,
            manifestPath: 'skill.json', manifestBytes: CLOUD_SKILL_MANIFEST_BYTES,
            parseManifest: (value) => parseCloudSkillManifest(value, entry, (message) => new CloudSkillError(message)),
            target, label: 'The skill', fail: (message) => new CloudSkillError(message),
            ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
          });
          kept.push(entry);
        } catch (error) {
          firstError ??= error;
          // An older copy that is still on disk keeps working until a download succeeds.
          const old = this.state.skills.find((skill) => skill.name === entry.name);
          if (old && present) kept.push(old);
        }
      }
      await this.removeUnlisted(new Set(catalog.skills.map((skill) => skill.name)));
      this.state = { syncedAt: this.now().toISOString(), error: firstError ? failureMessage(firstError) : null, skills: kept, tools };
    } catch (error) {
      this.state = { ...this.state, syncedAt: this.now().toISOString(), error: failureMessage(error) };
    }
    await this.save().catch(() => {});
    return this.status();
  }

  private async removeUnlisted(listed: ReadonlySet<string>): Promise<void> {
    let entries;
    try { entries = await readdir(this.options.dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !CLOUD_ITEM_NAME.test(entry.name) || listed.has(entry.name)) continue;
      await rm(path.join(this.options.dir, entry.name), { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Brings a stale or missing list up to date for a hosted run, waiting a few seconds at most. */
  private async fresh(): Promise<void> {
    await this.load();
    const last = this.state.syncedAt ? Date.parse(this.state.syncedAt) : Number.NaN;
    const age = this.now().getTime() - last;
    // A failed sync is retried by the next run after a few minutes, not by every run.
    if (Number.isFinite(last) && age < (this.state.error ? RETRY_AFTER_ERROR_MS : CLOUD_SKILLS_REFRESH_MS)) return;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      this.sync().catch(() => undefined),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, RUN_WAIT_MS); timer.unref?.(); }),
    ]);
    if (timer) clearTimeout(timer);
  }

  /** The cloud skills a hosted run is told about: downloaded, listed, and not shadowed by a local skill. */
  async skillsForHostedRun(): Promise<SkillInfo[]> {
    await this.fresh();
    const listed = new Set(this.state.skills.map((skill) => skill.name));
    if (listed.size === 0) return [];
    const local = new Set(await this.options.localSkillIds().catch(() => []));
    const skills = await listSkills([this.options.dir]).catch(() => [] as SkillInfo[]);
    return skills.filter((skill) => listed.has(path.basename(skill.dir)) && skill.id === path.basename(skill.dir) && !local.has(skill.id));
  }

  /** The cloud tools a hosted run may call. */
  async toolsForHostedRun(): Promise<CloudToolInfo[]> {
    await this.fresh();
    return this.state.tools;
  }

  /** Syncs now when signed in, then every {@link CLOUD_SKILLS_REFRESH_MS}. */
  start(): void {
    if (this.timer) return;
    void this.sync().catch(() => {});
    this.timer = setInterval(() => { void this.sync().catch(() => {}); }, CLOUD_SKILLS_REFRESH_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
