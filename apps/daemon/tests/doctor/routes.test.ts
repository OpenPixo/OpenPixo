import type { Express, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { registerDoctorRoutes } from '../../src/routes/doctor.js';
import type { DoctorProbes } from '../../src/doctor/checks.js';

vi.mock('../../src/doctor/probes.js', () => ({ createDoctorProbes: vi.fn() }));

describe('GET /api/doctor', () => {
  it('uses the local-request gate and returns the fresh report from stubbed read-only probes', async () => {
    const get = vi.fn();
    const requireLocalDaemonRequest = vi.fn();
    const probes: DoctorProbes = {
      agents: async () => [], engineTool: async () => ({ available: false, configured: false }),
      ffmpeg: async () => ({ source: 'bundled' }), providers: async () => ({ image: false, audio: false }),
    };
    const probeFactory = vi.fn(() => probes);
    registerDoctorRoutes({ get } as unknown as Express, {
      paths: { RUNTIME_DATA_DIR: 'unused-isolated-data-root', PROJECT_ROOT: 'unused-project-root' }, http: { requireLocalDaemonRequest }, probes: probeFactory,
    });
    const [route, gate, handler] = get.mock.calls[0]!;
    expect(route).toBe('/api/doctor');
    expect(gate).toBe(requireLocalDaemonRequest);
    const json = vi.fn();
    const setHeader = vi.fn();
    await handler({} as Request, { json, setHeader } as unknown as Response);
    expect(probeFactory).toHaveBeenCalledOnce();
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    const response = json.mock.calls[0]![0];
    expect(response.checks).toHaveLength(9);
    expect(response.checks.map((check: { group: string }) => check.group)).toEqual([
      'agents', 'agents', 'agents', 'engines', 'engines', 'engines', 'media-tools', 'providers', 'providers',
    ]);
    await handler({} as Request, { json, setHeader } as unknown as Response);
    expect(probeFactory).toHaveBeenCalledTimes(2);
  });
});
