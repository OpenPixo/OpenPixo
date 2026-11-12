import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { GAME_SETUP_CLI_USAGE, gameSetupFromCliFlags } from './setup-cli.js';
import type {
  ApiErrorResponse,
  CheckGameTargetRequest,
  CheckGameTargetResponse,
  CreateGameFromTemplateRequest,
  GameTemplatesResponse,
  CreateGameFromTemplateResponse,
} from '@openpixo/contracts';

interface Flags {
  [setupFlag: string]: string | boolean | undefined;
  template?: string;
  dir?: string;
  name?: string;
  json?: boolean;
  'create-parent'?: boolean;
}

export type GameTemplateCliCommand = 'game-templates' | 'create-game' | 'check-game';

export async function runGameTemplateProjectCli(
  command: GameTemplateCliCommand,
  flags: Flags,
  deps: {
    base: string;
    requestHeaders: Record<string, string>;
    mintImportToken: (baseDir: string) => Promise<string | null>;
  },
): Promise<void> {
  try {
    let input: CreateGameFromTemplateRequest | CheckGameTargetRequest | undefined;
    let endpoint = '/api/game-templates';
    const headers: Record<string, string> = { ...deps.requestHeaders };
    if (command === 'create-game') {
      if (!flags.template || !flags.dir || !flags.name) {
        throw new Error(`Usage: ${PRODUCT_CLI_NAME} project create-game --template <id> --dir <absolute parent> --name <name> [--create-parent] [setup flags] [--json]

${GAME_SETUP_CLI_USAGE}`);
      }
      const setup = await gameSetupFromCliFlags(flags);
      input = { templateId: flags.template, parentDir: flags.dir, name: flags.name,
        ...(flags['create-parent'] === true ? { createParent: true } : {}), ...(setup ? { setup } : {}) };
      endpoint = '/api/projects/game-from-template';
    } else if (command === 'check-game') {
      if (!flags.dir || !flags.name) {
        throw new Error(`Usage: ${PRODUCT_CLI_NAME} project check-game --dir <absolute parent> --name <name> [--create-parent] [--json]`);
      }
      input = { parentDir: flags.dir, name: flags.name, ...(flags['create-parent'] === true ? { createParent: true } : {}) };
      endpoint = '/api/projects/game-from-template/check';
    }
    if (input) {
      // The check inspects the token without spending it; create spends it.
      const token = await deps.mintImportToken(input.parentDir);
      if (token) headers['x-pixo-desktop-import-token'] = token;
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(`${deps.base}${endpoint}`, {
      method: input ? 'POST' : 'GET', headers,
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
    const body = await response.json();
    if (!response.ok) {
      const error = (body as ApiErrorResponse)?.error;
      const details = error?.details;
      const reasonCode = details && typeof details === 'object' && !Array.isArray(details) ? details.reasonCode : undefined;
      throw Object.assign(new Error(error?.message ?? `Game template request failed (${response.status})`), { code: error?.code, reasonCode });
    }
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    } else if (command === 'game-templates') {
      for (const template of (body as GameTemplatesResponse).templates) {
        console.log(`${template.id}\t${template.name}\t${template.description}`);
      }
    } else if (command === 'check-game') {
      const result = body as CheckGameTargetResponse;
      const detail = result.nameProblem ?? result.message;
      console.log(`${result.status}${result.target ? `\t${result.target}` : ''}${detail ? `\t${detail}` : ''}`);
    } else {
      const result = body as CreateGameFromTemplateResponse;
      console.log(`[project] created ${result.project.id} (conversation ${result.conversationId})\n${result.project.metadata?.baseDir ?? ''}`);
      if (result.git?.status === 'skipped') console.log('Git was not found; the game was created without an initial commit.');
      if (result.git?.status === 'failed') console.log(`Initial git commit failed: ${result.git.message ?? result.git.reasonCode}`);
    }
    if (command === 'check-game' && (body as CheckGameTargetResponse).status !== 'available') process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (flags.json) process.stdout.write(`${JSON.stringify({ error: { message, code: (error as { code?: string }).code, reasonCode: (error as { reasonCode?: string }).reasonCode } })}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
