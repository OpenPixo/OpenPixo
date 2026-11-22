/**
 * Cloud skills: skills OpenPixo writes and serves from its cloud, not from this repository. Any
 * signed-in account downloads them for free, and they join a run's skill index only when the run
 * uses OpenPixo's hosted models. The skills in `skills/` are unaffected: on an id clash the local
 * skill wins.
 */

/** The cloud's `skill-catalog` answer: what to download, and a short-lived grant to read it. */
export interface CloudSkillCatalogResponse {
  skills: CloudSkillCatalogEntry[];
  /** `<origin>/__skill`; files are read from `${baseUrl}/<name>/<version>/<path>`. */
  baseUrl: string;
  /** Bearer token for every file under `baseUrl`. */
  token: string;
  expiresAt: string;
}

export interface CloudSkillCatalogEntry {
  /** Folder name and skill id: lowercase words joined by hyphens. */
  name: string;
  /** The content hash the cloud gave this build; a new version means new content. */
  version: string;
  title: string;
  description: string;
}

/** `<name>/<version>/skill.json`. `files` never lists `skill.json` itself. */
export interface CloudSkillManifest {
  schema: 1;
  name: string;
  version: string;
  title: string;
  description: string;
  triggers: string[];
  files: CloudSkillFile[];
}

export interface CloudSkillFile {
  /** `SKILL.md` or a Markdown file in a lowercase folder, at most 3 deep. */
  path: string;
  size: number;
  sha256: string;
}

/** One downloaded skill, as `GET /api/cloud-skills` lists it. */
export interface CloudSkillStatus {
  name: string;
  version: string;
  title: string;
  description: string;
  /** False when a local skill with the same id is used instead. */
  active: boolean;
}

/** `GET /api/cloud-skills` and `POST /api/cloud-skills/sync`. */
export interface CloudSkillsResponse {
  skills: CloudSkillStatus[];
  /** Tools the hosted agent can call with `pixo tool`; empty when signed out or unknown. */
  tools: CloudToolInfo[];
  /** When the last sync finished, successful or not; null before the first. */
  syncedAt: string | null;
  /** Why the last sync failed, in words for the user; null when it worked. */
  error: string | null;
  signedIn: boolean;
}

/**
 * Cloud tools: one question (and an image or some text) answered in short text by a hosted model
 * whose instructions stay in the cloud. `pixo look` is the first one. Only runs on OpenPixo's
 * hosted models can call them, on the run's credits.
 */
export interface CloudToolInfo {
  id: string;
  /** One line, at most {@link CLOUD_TOOL_DESCRIPTION_MAX_CHARS} characters. */
  description: string;
  input: 'image' | 'text';
}

export const CLOUD_TOOL_DESCRIPTION_MAX_CHARS = 160;
/** Longest text a `text` tool takes. */
export const CLOUD_TOOL_TEXT_MAX_CHARS = 20_000;

/** `POST /api/tools/cloud`, with the run's tool token. */
export interface CloudToolRequest {
  /** A tool id from {@link CloudToolInfo}. */
  tool: string;
  question: string;
  /** For an `image` tool: a project file or a path game verify or playtest returned. */
  path?: string;
  /** For a `text` tool: the text to judge, up to {@link CLOUD_TOOL_TEXT_MAX_CHARS} characters. */
  text?: string;
}

export interface CloudToolResponse {
  answer: string;
  /** What this call added to the run's charge, as the cloud settled it; 0 when it did not say. */
  creditsCharged: number;
  costMicrocredits: number;
}

/** The cloud's tool list (`GET /agent-chat/tools`). */
export interface CloudToolListResponse {
  tools: CloudToolInfo[];
}

/** What the cloud's `POST /agent-chat/tools/<id>` takes; the daemon turns a path into `image`. */
export interface CloudToolCloudRequest {
  question: string;
  /** A data URL. */
  image?: string;
  text?: string;
}

/** Lowercase words joined by hyphens, as the cloud names skills and tools. */
export const CLOUD_ITEM_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
