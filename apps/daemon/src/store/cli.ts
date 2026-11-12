import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { parseArgs } from 'node:util';
import { resolveDaemonUrl } from '../daemon-url.js';
import type { ApiErrorResponse, StoreCatalogResponse, StoreInstallRequest, StoreInstallResponse, StoreItemDetail, StorePurchaseRequest, StorePurchaseResponse } from '@openpixo/contracts';

const USAGE = `${PRODUCT_CLI_NAME} store list [--kind <kind>] [--engine <engine>] [--free|--paid] [--json]
${PRODUCT_CLI_NAME} store info <name> [--json]
${PRODUCT_CLI_NAME} store buy <name> [--version <v>] [--json]
${PRODUCT_CLI_NAME} store install <name>[@version] [--project <id>] [--json]`;

export async function runStoreCli(args: string[]): Promise<void> {
  const json = args.includes('--json');
  try {
    if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(USAGE); return; }
    const command = args[0];
    if (!['list', 'info', 'install', 'buy'].includes(command!)) throw new Error(USAGE);
    const { values, positionals } = parseArgs({ args: args.slice(1), allowPositionals: true, options: {
      json: { type: 'boolean' }, kind: { type: 'string' }, engine: { type: 'string' }, version: { type: 'string' },
      free: { type: 'boolean' }, paid: { type: 'boolean' }, project: { type: 'string' }, 'daemon-url': { type: 'string' },
    } });
    if (positionals.length !== (command === 'list' ? 0 : 1) || (values.free && values.paid)) throw new Error(USAGE);
    const base = (await resolveDaemonUrl({ flagUrl: values['daemon-url'] ?? null })).replace(/\/$/, '');
    let route: string;
    let body: StoreInstallRequest | StorePurchaseRequest | undefined;
    if (command === 'list') {
      const query = new URLSearchParams();
      if (values.kind) query.set('kind', values.kind);
      if (values.engine) query.set('engine', values.engine);
      if (values.free || values.paid) query.set('pricing', values.paid ? 'paid' : 'free');
      route = `/api/store/catalog${query.size ? `?${query}` : ''}`;
    } else if (command === 'info') route = `/api/store/items/${encodeURIComponent(positionals[0]!)}`;
    else if (command === 'buy') {
      body = { name: positionals[0]!, ...(values.version !== undefined ? { version: values.version } : {}) };
      route = '/api/store/purchase';
    } else {
      const specifier = positionals[0]!;
      const at = specifier.lastIndexOf('@');
      body = { name: at > 0 ? specifier.slice(0, at) : specifier,
        ...(at > 0 ? { version: specifier.slice(at + 1) } : {}),
        ...(values.project ? { projectId: values.project } : {}) };
      route = '/api/store/install';
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: new URL(base).origin };
    if (process.env.PIXO_TOOL_TOKEN) headers.authorization = `Bearer ${process.env.PIXO_TOOL_TOKEN}`;
    const response = await fetch(`${base}${route}`, { method: body ? 'POST' : 'GET', headers,
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) {
      if (json) console.log(JSON.stringify(result)); else console.error((result as ApiErrorResponse).error?.message ?? `Request failed (${response.status})`);
      process.exitCode = 1; return;
    }
    if (json) console.log(JSON.stringify(result, null, 2));
    else if (command === 'list') console.log((result as StoreCatalogResponse).items.map(item =>
      `${item.name}@${item.version}\t${item.kind}\t${item.owned ? 'owned' : item.pricing.type === 'paid' ? `${item.pricing.credits} credits` : 'free'}${builtInNote(item)}`).join('\n'));
    else if (command === 'info') {
      const item = result as StoreItemDetail;
      console.log(`${item.title ?? item.name} (${item.name}@${item.version})\n${item.description ?? ''}\nLicense: ${item.license}\n${JSON.stringify(item.requires)}${builtInNote(item)}`);
      if (item.examples?.length) console.log(['Examples:', ...item.examples.map(example => `${example.title}\n  ${example.prompt}`)].join('\n'));
    } else if (command === 'buy') {
      const purchased = result as StorePurchaseResponse;
      console.log(`Purchased ${purchased.name}@${purchased.version} for ${purchased.creditsSpent} credits. Balance: ${purchased.balance} credits.`);
    } else {
      const installed = result as StoreInstallResponse;
      console.log(`Installed ${installed.name}@${installed.version}${installed.projectId ? ` in project ${installed.projectId}` : ''}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ error: { message } })); else console.error(message);
    process.exitCode = 1;
  }
}

/** Built-in skills need no install; say so, and whether the user switched one off (`pixo config`'s `disabledSkills`). */
function builtInNote(item: StoreCatalogResponse['items'][number]): string {
  if (!item.builtIn) return '';
  return item.builtIn.enabled ? '	built in (used automatically)' : `	built in, switched off (${item.builtIn.skillId})`;
}
