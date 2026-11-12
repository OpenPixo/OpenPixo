import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  inspectAgentExecutableResolution,
  inspectAgentExecutableResolutionAsync,
} from '../../src/runtimes/executables.js';
import {
  applyAgentLaunchEnv,
  applyAgentLaunchEnvAsync,
  resolveAgentLaunch,
  resolveAgentLaunchAsync,
} from '../../src/runtimes/launch.js';
import { minimalAgentDef, withEnvSnapshot } from './helpers/test-helpers.js';

test('async executable discovery preserves overrides, fallback order, and skipped candidates', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pixo-async-resolution-'));
  try {
    await withEnvSnapshot(['PATH', 'PIXO_AGENT_HOME', 'CODEX_BIN'], async () => {
      process.env.PATH = root;
      process.env.PIXO_AGENT_HOME = root;
      delete process.env.CODEX_BIN;
      const extension = process.platform === 'win32' ? '.cmd' : '';
      const primary = path.join(root, `codex${extension}`);
      const fallback = path.join(root, `codex-fork${extension}`);
      const override = path.join(root, `configured${extension}`);
      await Promise.all([primary, fallback, override].map(file => writeFile(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 })));
      const def = minimalAgentDef({ id: 'codex', bin: 'codex', fallbackBins: ['codex-fork'] });
      const environments: Record<string, string>[] = [{}, { CODEX_BIN: override }];
      for (const configuredEnv of environments) {
        const options = { skipPathCandidates: [primary] };
        expect(await inspectAgentExecutableResolutionAsync(def, configuredEnv, options))
          .toEqual(inspectAgentExecutableResolution(def, configuredEnv, options));
      }
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('async Codex launch discovery preserves native-package selection and child PATH', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pixo-async-native-'));
  try {
    await withEnvSnapshot(['PATH', 'PIXO_AGENT_HOME', 'CODEX_BIN'], async () => {
      process.env.PATH = root;
      process.env.PIXO_AGENT_HOME = root;
      delete process.env.CODEX_BIN;
      const extension = process.platform === 'win32' ? '.cmd' : '';
      const wrapper = path.join(root, `codex${extension}`);
      const native = path.join(root, 'node_modules', '@openai', `codex-${process.platform}-${process.arch}`, process.platform === 'win32' ? 'codex.exe' : 'codex');
      await mkdir(path.dirname(native), { recursive: true });
      await writeFile(wrapper, '#!/usr/bin/env node\n// @openai/codex wrapper\n', { mode: 0o755 });
      await writeFile(native, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const def = minimalAgentDef({ id: 'codex', bin: 'codex' });
      const launch = await resolveAgentLaunchAsync(def);
      expect(launch).toEqual(resolveAgentLaunch(def));
      expect(launch.launchPath).toBe(native);
      const env = { PATH: root };
      expect(await applyAgentLaunchEnvAsync(env, launch)).toEqual(applyAgentLaunchEnv(env, launch));
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
