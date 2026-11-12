import type Database from 'better-sqlite3';
import type { InstalledPluginRecord } from '@openpixo/contracts';
import { getInstalledPlugin } from './registry.js';

/** Resolve the exact installed record selected from the local catalogue. */
export async function resolveLocalPluginBySource(input: {
  db: Database.Database;
  id: string;
  source: string;
}): Promise<InstalledPluginRecord | null> {
  const installed = getInstalledPlugin(input.db, input.id);
  return installed?.source === input.source ? installed : null;
}
