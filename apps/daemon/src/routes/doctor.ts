import type { Express, RequestHandler } from 'express';
import { checkEnvironment, type DoctorProbes } from '../doctor/checks.js';
import { createDoctorProbes } from '../doctor/probes.js';

export interface RegisterDoctorRoutesDeps {
  paths: { RUNTIME_DATA_DIR: string; PROJECT_ROOT: string };
  http: { requireLocalDaemonRequest: RequestHandler };
  /** Tests replace local-machine probes without touching user configuration. */
  probes?: () => DoctorProbes;
}

export function registerDoctorRoutes(app: Express, deps: RegisterDoctorRoutesDeps): void {
  app.get('/api/doctor', deps.http.requireLocalDaemonRequest, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await checkEnvironment(deps.probes?.() ?? createDoctorProbes(deps.paths.RUNTIME_DATA_DIR, deps.paths.PROJECT_ROOT)));
  });
}
