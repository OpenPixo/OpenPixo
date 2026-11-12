import type { McpServerConfig, McpTemplate } from './mcp.js';
import type { SkillContextCost } from '../prompts/skill-index.js';

export type ProjectExtensionKind = 'skill' | 'mcp';

export interface ProjectExtensionSummary {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  version: string;
  source: string;
  managed: boolean;
  available: boolean;
  /** Per-skill index line vs full workflow; tokens are approximate UTF-8 bytes / 4. */
  contextCost?: SkillContextCost;
  dependency?: { status: 'ready' | 'missing' | 'unknown'; message: string };
}

export interface ProjectExtensionCatalogItem {
  id: string;
  name: string;
  description: string;
  /** Localized display names, by locale. */
  displayName?: Record<string, string>;
  /** Localized descriptions, by locale. */
  descriptionI18n?: Record<string, string>;
}

export interface ProjectExtensionsResponse {
  skills: ProjectExtensionSummary[];
  mcpServers: ProjectExtensionSummary[];
  /**
   * Skills the agent can use in this project without anyone adding them: the ones
   * for its engine, minus what the user switched off in Settings.
   */
  defaultSkills?: ProjectExtensionCatalogItem[];
  catalog: {
    skills: ProjectExtensionCatalogItem[];
    mcpServers: ProjectExtensionCatalogItem[];
    mcpTemplates: McpTemplate[];
  };
}

export interface ImportProjectExtensionRequest {
  kind: ProjectExtensionKind;
  catalogId?: string;
  source?: string;
  server?: McpServerConfig;
}

export interface ChangeProjectExtensionRequest {
  action: 'enable' | 'disable' | 'update';
}
