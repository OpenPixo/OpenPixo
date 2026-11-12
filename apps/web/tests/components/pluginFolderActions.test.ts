import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { describe, expect, it } from 'vitest';
import { buildPluginFolderAgentActionPrompt } from '../../src/components/files/pluginFolderActions';

const FOLDER = 'generated-plugin';

describe('buildPluginFolderAgentActionPrompt', () => {
  describe('install', () => {
    it('mentions the folder path and the supported install CLI', () => {
      const prompt = buildPluginFolderAgentActionPrompt(FOLDER, 'install');
      expect(prompt).toContain(`Plugin folder: \`${FOLDER}\``);
      expect(prompt).toContain(`${PRODUCT_CLI_NAME} plugin install --source`);
    });
  });

  describe('publish (repo-publish flow)', () => {
    const prompt = buildPluginFolderAgentActionPrompt(FOLDER, 'publish');

    it('delegates repo publishing to the deterministic plugin CLI helper', () => {
      expect(prompt).toContain(`Plugin folder: \`${FOLDER}\``);
      expect(prompt).toContain(`"$PIXO_NODE_BIN" "$PIXO_BIN" plugin publish-repo ${FOLDER}`);
      expect(prompt).toMatch(/current gh login|target is not hard-coded/i);
    });

    it('states the CLI-owned responsibilities instead of re-listing shell steps', () => {
      expect(prompt).toContain('gh api user --jq .login');
      expect(prompt).toContain('--owner');
      expect(prompt).toMatch(/last-resort fallback/i);
      expect(prompt).toMatch(/placeholder owners are rejected/i);
      expect(prompt).toMatch(/manifest repo normalization/i);
      expect(prompt).toMatch(/repo existence check/i);
      expect(prompt).toMatch(/repo create\/update/i);
      expect(prompt).toMatch(/final verification/i);
    });

    it('hard-bans mid-turn clarification + auto-install + force-push + retry', () => {
      expect(prompt).toContain('<question-form>');
      expect(prompt).toMatch(/fire-and-forget|clarification UI that waits/i);
      expect(prompt).toMatch(/do not try to install/i);
      expect(prompt).toMatch(/do not force-push|--force/i);
      expect(prompt).toMatch(/do not retry/i);
    });

    it('interpolates the actual folder path into the CLI command', () => {
      // Sanity check that template-string interpolation didn't regress into
      // literal `${folderPath}` substrings.
      expect(prompt).toContain(`plugin publish-repo ${FOLDER}`);
      expect(prompt).not.toContain('${folderPath}');
    });

    it('ends by handing the repo URL back to chat', () => {
      expect(prompt).toMatch(/final repo URL printed by the CLI/i);
    });
  });
});
