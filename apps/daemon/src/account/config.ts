import { parseOpenPixoCloudConfig, type OpenPixoCloudConfig } from '@openpixo/contracts';

export type { OpenPixoCloudConfig };

/** Read once at daemon composition, like the other PIXO_* runtime knobs. */
export function readOpenPixoCloudConfig(env: NodeJS.ProcessEnv = process.env): OpenPixoCloudConfig | null {
  return parseOpenPixoCloudConfig(env.PIXO_CLOUD_URL, env.PIXO_CLOUD_ANON_KEY, env.PIXO_AGENT_URL);
}
