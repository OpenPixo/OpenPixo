import type { Express } from 'express';
import type { SkillInfo } from './skills.js';
import type {
  AuthorizeProjectRequest,
  AuthorizeProjectToolRequest,
} from './projects/project-access.js';

export interface HttpDeps {
  createSseResponse: (...args: any[]) => any;
  getPublicBaseUrl?: (...args: any[]) => string;
  isLocalSameOrigin: (...args: any[]) => boolean;
  requireLocalDaemonRequest: (...args: any[]) => any;
  resolvedPortRef: { current: number };
  sendApiError: (...args: any[]) => any;
  sendMulterError: (...args: any[]) => any;
}

export interface PathDeps {
  ARTIFACTS_DIR: string;
  // Bundled rendering catalogue (see specs/current/skills-and-design-templates.md).
  // Distinct from SKILLS_DIR so the EntryView Templates surface and the
  // Settings → Skills surface stay decoupled.
  DESIGN_TEMPLATES_DIR: string;
  PIXO_BIN: string;
  PLUGIN_REGISTRY_DIR: string;
  PROJECT_ROOT: string;
  PROJECTS_DIR: string;
  PROMPT_TEMPLATES_DIR: string;
  RUNTIME_DATA_DIR: string;
  RUNTIME_DATA_DIR_CANONICAL: string;
  SKILLS_DIR: string;
  // Mirror of USER_SKILLS_DIR rooted at DESIGN_TEMPLATES_DIR so user
  // imports of templates do not collide with imports of functional skills.
  USER_DESIGN_TEMPLATES_DIR: string;
  USER_SKILLS_DIR: string;
}

export interface ResourceDeps {
  FIRST_PARTY_ATOMS?: Array<any>;
  listAllSkills: () => Promise<Array<SkillInfo & { source?: string }>>;
  // Mirrors listAllSkills but scans DESIGN_TEMPLATE_ROOTS so the Templates
  // surface only sees rendering-catalogue entries.
  listAllTemplates: () => Promise<Array<SkillInfo & { source?: string }>>;
  // Spans both functional skills and design templates so cross-surface
  // resolvers (chat run system prompt, orbit template resolver,
  // /api/skills/:id/example, /api/skills/:id/assets/*) keep working when
  // a stored project.skillId points at either root.
  listAllSkillLikeEntries: () => Promise<Array<SkillInfo & { source?: string }>>;
  mimeFor: (filePath: string) => string;
}

export interface ProjectPreviewScopeDeps {
  mint: (
    projectId: string,
    options?: { readonly ttlMs?: number },
  ) => string;
  /**
   * Like `mint`, but reuses the live scope for this exact project
   * when one exists — **without renewing it**. Preview reads must be
   * byte-stable across refetches, and the scope's expiry is serialized into
   * the bridged document, so touching it here would change the served bytes
   * and reload the iframe just as a fresh id would.
   *
   * `ttlMs` therefore applies only when this call has to create a new reusable
   * scope. Keeping an in-use scope alive is `renew`'s job, driven by the
   * client's explicit renewal request, whose response is not a document.
   */
  acquire: (
    projectId: string,
    options?: { readonly ttlMs?: number },
  ) => string;
  revoke: (scope: string) => void;
  expiresAt: (projectId: string, scope: string) => number | undefined;
  /**
   * The expiry to embed in a served document — frozen for the scope's whole
   * life, unlike `expiresAt`, which `renew` moves. Use this for any body whose
   * bytes must stay identical across refetches; JSON responses keep using
   * `expiresAt`.
   */
  documentExpiresAt: (projectId: string, scope: string) => number | undefined;
  renew: (
    projectId: string,
    scope: string,
    options?: { readonly ttlMs?: number },
  ) => number | undefined;
  validate: (projectId: string, scope: string) => boolean;
}

export interface TelemetryDeps {
  resolveRunProjectKindForAnalytics: (...args: any[]) => any;
  runArtifactBaselines: any;
  runRetryEventsForAnalytics: (...args: any[]) => any;
  /** Product-result capture for request-scoped, consented analytics. */
  captureProductEvent?: (
    req: any,
    eventName: string,
    properties: Record<string, unknown>,
  ) => Promise<void> | void;
}

export interface ServerContext {
  db: any;
  design: any;
  http: HttpDeps;
  paths: PathDeps;
  ids: any;
  uploads: any;
  node: any;
  projectStore: any;
  authorizeProjectRequest: AuthorizeProjectRequest;
  authorizeProjectToolRequest: AuthorizeProjectToolRequest;
  isApiTokenAuthorization: (authorization: string | undefined) => boolean;
  projectFiles: any;
  conversations: any;
  templates: any;
  status: any;
  events: any;
  imports: any;
  exports: any;
  artifacts: any;
  documents: any;
  auth: any;
  media: any;
  appConfig: any;
  nativeDialogs: any;
  research: any;
  mcp: {
    pendingAuth: any;
    daemonUrlRef: { current: string };
    inheritedEnvironment: (baseEnv?: NodeJS.ProcessEnv) => Record<string, string>;
  };
  plugins: any;
  resources: ResourceDeps;
  projectPreviewScopes: ProjectPreviewScopeDeps;
  telemetry: TelemetryDeps;
  validation: any;
  chat: any;
  messages: any;
  agents: any;
  lifecycle: {
    isDaemonShuttingDown: () => boolean;
  };
}

export type RouteDeps<K extends keyof ServerContext> = Pick<ServerContext, K>;

export type RouteRegistrar = (app: Express, ctx: ServerContext) => void;
