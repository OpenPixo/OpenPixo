// What `POST /api/projects` records for each first-level output type on Home's
// create rail.
//
// Every entry on that rail is a product-owned automatic scenario: the user
// picks a task type, never a plugin. So the create travels as
// `pluginSelectionProvenance: 'automatic-default'` — `EntryShell` omits
// `pluginId`, and the daemon re-derives the plugin from the metadata and stamps
// an `automatic_default` scenario binding. `routes/runs.ts` reads exactly that
// per run (`projectPinIsAutomaticDefault` -> `routeApplicability`), so a card
// that forwards its plugin id instead is labelled `explicit_user` when nobody
// pinned anything.
//
// The reverse direction is pinned too: a body that DOES name a plugin stays
// `explicit_user`, because naming one is how a caller opts a project out of OD
// Next and the rollout must not be able to override that.

import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProjectMetadata, ProjectScenarioTaskProfile } from '@openpixo/contracts';
import { closeDatabase } from '../../src/db.js';
import { startServer, type StartServerOptions } from '../../src/server.js';

type StartedServer = {
  url: string;
  server: Server;
  shutdown?: () => Promise<void> | void;
};

type RailSurface = {
  chipId: string;
  metadata: Record<string, unknown>;
  /** The plugin the card applies, and the one a pick under it forwards. */
  scenarioPluginId: string;
  /** The chip's `action.inputs`, which ride along in both shapes. */
  pluginInputs?: Record<string, unknown>;
};

const CREATE_RAIL_SURFACES: RailSurface[] = [
  {
    chipId: 'hyperframes',
    metadata: { kind: 'video', intent: 'hyperframes', videoModel: 'hyperframes-html' },
    scenarioPluginId: 'example-hyperframes',
  },
  // The media composer also stamps the picked model / prompt template on the
  // metadata; neither participates in scenario routing, so they are left out.
  {
    chipId: 'image',
    metadata: { kind: 'image' },
    scenarioPluginId: 'pixo-media-generation',
    pluginInputs: {
      mediaKind: 'image',
      subject: 'a polished product concept',
      style: 'cinematic, high-quality, on-brand',
      aspect: '16:9',
    },
  },
  {
    chipId: 'video',
    metadata: { kind: 'video' },
    scenarioPluginId: 'pixo-media-generation',
    pluginInputs: {
      mediaKind: 'video',
      subject: 'a short product reveal',
      style: 'cinematic, high-quality, on-brand',
      aspect: '16:9',
    },
  },
  {
    chipId: 'audio',
    metadata: { kind: 'audio' },
    scenarioPluginId: 'pixo-media-generation',
    pluginInputs: {
      mediaKind: 'audio',
      subject: 'a concise audio identity for a product',
      style: 'clear, polished, modern',
      aspect: '16:9',
    },
  },
];

/**
 * The cards that own no OD Next route. Only these can reach the create with a
 * plugin pinned: on the other three an example pick travels as an
 * `exampleReference` and the automatic route survives.
 */
const PLUGIN_FORWARDING_SURFACES = CREATE_RAIL_SURFACES;

type CreatedProject = {
  appliedPluginSnapshotId: string | null;
  metadata: ProjectMetadata;
};

async function createProject(
  url: string,
  label: string,
  body: Record<string, unknown>,
): Promise<CreatedProject> {
  const response = await fetch(`${url}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: `restore-entry-${label}-${process.hrtime.bigint()}`,
      name: `restore entry ${label}`,
      conversationMode: 'design',
      skipDiscoveryBrief: true,
      ...body,
    }),
  });
  if (response.status !== 200) {
    throw new Error(`${label} create -> ${response.status}: ${await response.text()}`);
  }
  const parsed = await response.json() as {
    appliedPluginSnapshotId?: string | null;
    project?: { metadata?: ProjectMetadata; appliedPluginSnapshotId?: string | null };
  };
  return {
    appliedPluginSnapshotId:
      parsed.project?.appliedPluginSnapshotId ?? parsed.appliedPluginSnapshotId ?? null,
    metadata: (parsed.project?.metadata ?? {}) as ProjectMetadata,
  };
}

/** What the card itself sends: metadata and inputs, never a plugin id. */
function automaticDefaultBody(surface: RailSurface): Record<string, unknown> {
  return {
    metadata: surface.metadata,
    ...(surface.pluginInputs ? { pluginInputs: surface.pluginInputs } : {}),
  };
}

/** What a pick made under the card sends: the plugin it just applied. */
function forwardedPluginBody(surface: RailSurface): Record<string, unknown> {
  return {
    metadata: surface.metadata,
    pluginId: surface.scenarioPluginId,
    ...(surface.pluginInputs ? { pluginInputs: surface.pluginInputs } : {}),
  };
}

describe('create-rail scenario binding', () => {
  let started: StartedServer | null = null;

  async function daemon(): Promise<StartedServer> {
    started = await startServer(
      { port: 0, returnServer: true } as StartServerOptions,
    ) as StartedServer;
    return started;
  }

  afterEach(async () => {
    if (started) {
      await Promise.resolve(started.shutdown?.());
      if (started.server.listening) {
        await new Promise<void>((resolve) => started!.server.close(() => resolve()));
      }
    }
    started = null;
    closeDatabase();
  });

  it('stamps an automatic_default binding for every entry on the create rail', async () => {
    const { url } = await daemon();
    for (const surface of CREATE_RAIL_SURFACES) {
      const project = await createProject(url, surface.chipId, automaticDefaultBody(surface));
      expect(project.metadata.scenarioBinding, surface.chipId).toMatchObject({
        schemaVersion: 1,
        provenance: 'automatic_default',
        pluginId: surface.scenarioPluginId,
        snapshotId: project.appliedPluginSnapshotId,
      });
    }

    const retiredWebgl = await createProject(url, 'retired-webgl', {
      metadata: { kind: 'prototype', intent: 'webgl-experience' },
    });
    expect(retiredWebgl.appliedPluginSnapshotId).toBeNull();
    expect(retiredWebgl.metadata.scenarioBinding).toBeUndefined();
  });

  it('binds exactly the plugin each card advertises', async () => {
    // Dropping the plugin id is only safe while the daemon re-derives the same
    // plugin from the metadata the card stamps. HyperFrames needs its local
    // composition workflow rather than the generic media scenario.
    const { url } = await daemon();
    for (const surface of PLUGIN_FORWARDING_SURFACES) {
      const project = await createProject(url, surface.chipId, automaticDefaultBody(surface));
      expect(project.metadata.scenarioBinding?.pluginId, surface.chipId)
        .toBe(surface.scenarioPluginId);
    }
  });

  // The reverse direction. A pick made UNDER a card — an example/preset card,
  // a plugin card's 「使用」 — forwards the plugin it applied, and that must
  // still read as user authority: it is how a caller opts a project out of OD
  // Next. Nobody may "fix" a create-rail defect by softening this.
  it('keeps a named plugin recorded as user authority', async () => {
    const { url } = await daemon();
    for (const surface of PLUGIN_FORWARDING_SURFACES) {
      const project = await createProject(
        url,
        `${surface.chipId}-pinned`,
        forwardedPluginBody(surface),
      );
      expect(project.metadata.scenarioBinding, surface.chipId).toMatchObject({
        provenance: 'explicit_user',
        pluginId: surface.scenarioPluginId,
        snapshotId: project.appliedPluginSnapshotId,
      });
    }

    const namedPluginOnUnboundProject = await createProject(url, 'named-plugin', {
      metadata: { kind: 'prototype' },
      pluginId: 'example-hyperframes',
    });
    expect(namedPluginOnUnboundProject.metadata.scenarioBinding).toMatchObject({
      provenance: 'explicit_user',
      pluginId: 'example-hyperframes',
    });
  });

});
