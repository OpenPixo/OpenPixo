import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { ChatSessionMode, } from '@openpixo/contracts';
import type { OpenPixoHostProjectImportSuccess } from '@openpixo/host';
import type {
  AgentInfo,
  ApiProtocol,
  AppConfig,
  ExecMode,
  Project,
  PromptTemplateSummary,
  ProviderModelOption,
  SkillSummary,
} from '../types';
// `EntryShell` owns the redesigned home layout (left rail + centered
// hero + recent projects + plugins). Keeping the redesign in a sibling
// component lets future rebases against upstream `EntryView` (props,
// connector lifecycle, exported helpers) stay close to a no-op here.
import {
  EntryShell,
  type OptimisticProjectCreationHandoff,
  type ProjectTitleHint,
} from './EntryShell';

import type { IntegrationTab } from './IntegrationsView';
import type { CreateInput } from './NewProjectPanel';
import type {
  PluginShareAction,
  PluginShareProjectOutcome,
} from '../state/projects';


type EntryCreateProjectInput = Omit<CreateInput, 'metadata'> & {
  metadata?: CreateInput['metadata'];
  pendingPrompt?: string;
  pluginId?: string;
  pluginType?: string;
  appliedPluginSnapshotId?: string;
  pluginInputs?: Record<string, unknown>;
  conversationMode?: ChatSessionMode;
  autoSendFirstMessage?: boolean;
  requestId?: string;
  pendingFiles?: File[];
  userWorkingDirToken?: string;
};

interface Props {
  // Shared resource catalog supports project chips and media skill routing.
  skills: SkillSummary[];
  projects: Project[];
  promptTemplates: PromptTemplateSummary[];
  agents: AgentInfo[];
  // Keep local CLI onboarding in its detecting state during the agent scan.
  agentsLoading?: boolean;



  // Execution / model-switching context forwarded to the EntryShell so the
  // sticky top-bar can expose the active CLI/BYOK + model and persist
  // changes through the same channels as the project view.
  config: AppConfig;
  providerModelsCache?: Record<string, ProviderModelOption[]>;
  onProviderModelsCacheChange?: Dispatch<SetStateAction<Record<string, ProviderModelOption[]>>>;
  integrationInitialTab?: IntegrationTab;
  daemonLive: boolean;
  onModeChange: (mode: ExecMode) => void;
  onAgentChange: (id: string) => void;
  onAgentModelChange: (
    id: string,
    choice: { model?: string; reasoning?: string; serviceTier?: string },
  ) => void;
  onApiProtocolChange: (protocol: ApiProtocol) => void;
  onApiModelChange: (model: string) => void;
  onConfigPersist: (cfg: AppConfig) => Promise<void> | void;
  onResetOnboarding?: (next: AppConfig) => void;
  /** True only when GET /api/app-config returned a real config object. */
  daemonAppConfigReady?: boolean;
  /** Non-optimistic daemon write for the silent-update preference. */
  onSilentUpdatePreferenceChange?: (allowSilentUpdates: boolean) => Promise<void>;
  onSkillsRefresh?: () => Promise<void> | void;
  onSkillsChanged?: (affectedSkillId?: string) => void;
  onRefreshAgents: () => Promise<AgentInfo[]> | AgentInfo[];
  // Per-resource loading flags. Each tab gates its own content on whichever
  // flag matches the data it renders, so a slow `/api/agents` probe does
  // not block tabs that don't need agents. Templates are not gated here —
  // the New project modal renders an empty state until they arrive (fast
  // fetch), which keeps the prop surface narrower.
  skillsLoading?: boolean;
  projectsLoading?: boolean;
  projectsLoadFailed?: boolean;
  promptTemplatesLoading?: boolean;
  onCreateProject: (input: EntryCreateProjectInput) => Promise<boolean> | boolean | void;
  /** Forwarded to EntryShell — see the prop docs there. */
  onBeginProjectCreation: (input: EntryCreateProjectInput) => OptimisticProjectCreationHandoff;

  onCreatePluginShareProject: (
    pluginId: string,
    action: PluginShareAction,
    locale?: string,
  ) => Promise<PluginShareProjectOutcome>;
  onImportFolder?: (baseDir: string) => Promise<void> | void;
  onImportFolderResponse?: (response: OpenPixoHostProjectImportSuccess) => Promise<void> | void;
  onOpenProject: (
    id: string,
    fileName?: string,
    projectTitleHint?: ProjectTitleHint,
  ) => Promise<boolean> | boolean | void;
  onDeleteProject: (id: string) => void;
  onDuplicateProject?: (id: string) => Promise<void> | void;
  onRenameProject: (id: string, name: string) => void;
  onProjectsRefresh?: () => Promise<void> | void;
  onOpenSettings: (section?: 'execution' | 'doctor' | 'media' | 'integrations' | 'mcpClient' | 'language' | 'appearance' | 'notifications' | 'projectLocations' | 'about' | 'account' | 'gameEngines') => void;
  onCompleteOnboarding: () => void;
  onSignedOut?: () => void | Promise<void>;

  artifactUpgradeSlot?: ReactNode;
}

function normalizedSearchValue(value: string | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function EntryView({
  skills,
  projects,
  promptTemplates,
  agents,
  agentsLoading,


  config,
  providerModelsCache,
  onProviderModelsCacheChange,
  integrationInitialTab,
  daemonLive,
  onModeChange,
  onAgentChange,
  onAgentModelChange,
  onApiProtocolChange,
  onApiModelChange,
  onConfigPersist,
  onResetOnboarding,
  daemonAppConfigReady = false,
  onSilentUpdatePreferenceChange,
  onSkillsRefresh,
  onSkillsChanged,
  onRefreshAgents,
  skillsLoading = false,
  projectsLoading = false,
  projectsLoadFailed = false,
  promptTemplatesLoading: _promptTemplatesLoading = false,
  onCreateProject,
  onBeginProjectCreation,

  onCreatePluginShareProject,
  onImportFolder,
  onImportFolderResponse,
  onOpenProject,
  onDeleteProject,
  onDuplicateProject,
  onRenameProject,
  onProjectsRefresh,
  onOpenSettings,
  onCompleteOnboarding,
  onSignedOut,

  artifactUpgradeSlot,
}: Props) {

  return (
    <EntryShell
      skills={skills}
      projects={projects}
      promptTemplates={promptTemplates}
      {...(integrationInitialTab ? { integrationInitialTab } : {})}
      skillsLoading={skillsLoading}
      projectsLoading={projectsLoading}
      projectsLoadFailed={projectsLoadFailed}
      config={config}
      providerModelsCache={providerModelsCache}
      onProviderModelsCacheChange={onProviderModelsCacheChange}
      agents={agents}
      {...(agentsLoading !== undefined ? { agentsLoading } : {})}


      daemonLive={daemonLive}
      onModeChange={onModeChange}
      onAgentChange={onAgentChange}
      onAgentModelChange={onAgentModelChange}
      onApiProtocolChange={onApiProtocolChange}
      onApiModelChange={onApiModelChange}
      onConfigPersist={onConfigPersist}
      onResetOnboarding={onResetOnboarding}
      daemonAppConfigReady={daemonAppConfigReady}
      onSilentUpdatePreferenceChange={onSilentUpdatePreferenceChange}
      onSkillsRefresh={onSkillsRefresh}
      onSkillsChanged={onSkillsChanged}
          onRefreshAgents={onRefreshAgents}
      onCreateProject={onCreateProject}
      onBeginProjectCreation={onBeginProjectCreation}

      onCreatePluginShareProject={onCreatePluginShareProject}
      {...(onImportFolder ? { onImportFolder } : {})}
      {...(onImportFolderResponse ? { onImportFolderResponse } : {})}
      onOpenProject={onOpenProject}
      onDeleteProject={onDeleteProject}
      onDuplicateProject={onDuplicateProject}
      onRenameProject={onRenameProject}
      onProjectsRefresh={onProjectsRefresh}
      onOpenSettings={onOpenSettings}
      onCompleteOnboarding={onCompleteOnboarding}


    />
  );
}
