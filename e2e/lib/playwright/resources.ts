import { recentProjectFixedStageDeckHtml } from '../../resources/recent-project-fixed-stage-deck.ts';
import { playwrightUiScenarios } from '../../resources/playwright.ts';

export function fixedStageDeckFixtureHtml(): string {
  return recentProjectFixedStageDeckHtml;
}

export type ScenarioKind = 'prototype' | 'deck' | 'hyperframes' | 'image' | 'audio' | 'template' | 'workspace';

export interface MockArtifactScenario {
  identifier: string;
  title: string;
  html: string;
  fileName: string;
  heading: string;
}

export interface ExpectedScenarioFile {
  kind?: string;
  name: string;
  previewText?: string;
}

export interface UiScenario {
  id: string;
  title: string;
  kind: ScenarioKind;
  flow?:
    | 'standard'
    | 'design-system-selection'
    | 'conversation-persistence'
    | 'file-mention'
    | 'deep-link-preview'
    | 'file-upload-send'
    | 'file-list-upload'
    | 'file-list-delete'
    | 'panel-stack-persistence'
    | 'conversation-delete-recovery'
    | 'question-form-single-selection'
    | 'question-form-submit-persistence'
    | 'question-form-single-answer'
    | 'generation-does-not-create-extra-file'
    | 'uploaded-image-renders-in-preview'
    | 'python-source-preview'
    | 'hyperframes-project-routing'
    | 'image-project-routing'
    | 'video-project-routing'
    | 'audio-project-routing'
    | 'plugin-create-import';
  automated: boolean;
  description: string;
  create: {
    projectName: string;
    mediaSurface?: 'image' | 'video' | 'audio';
    videoModel?: string;
    audioKind?: 'speech' | 'sfx';
  };
  prompt: string;
  secondaryPrompt?: string;
  mockArtifact?: MockArtifactScenario;
  expectedProjectMetadata?: Record<string, unknown>;
  expectedRunRequest?: Record<string, unknown>;
  expectedFiles?: ExpectedScenarioFile[];
  expectedPreviewText?: string;
  notes?: string[];
}

export function automatedUiScenarios(): UiScenario[] {
  return playwrightUiScenarios.filter((scenario) => scenario.automated);
}
