import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { describe, expect, it } from 'vitest';

import { buildAgentGuideMarkdown } from '../../src/components/use-everywhere/agent-guide';
import { GUIDE_SECTIONS } from '../../src/components/use-everywhere/sections';

describe('buildAgentGuideMarkdown', () => {
  it('emits a top-level header and the setup checklist by default', () => {
    const md = buildAgentGuideMarkdown();
    expect(md).toMatch(/^# OpenPixo — agent setup guide/);
    expect(md).toContain('## Setup checklist');
    expect(md).toContain('http://127.0.0.1:7456/api/health');
    expect(md).toContain('http://127.0.0.1:7456/api/mcp/install-info');
  });

  it('substitutes the daemonUrl into every default snippet URL', () => {
    const md = buildAgentGuideMarkdown({ daemonUrl: 'http://localhost:9999' });
    expect(md).toContain('http://localhost:9999/api/health');
    expect(md).toContain('http://localhost:9999/api/mcp/install-info');
    expect(md).not.toContain('http://127.0.0.1:7456');
  });

  it('strips a trailing slash on the daemonUrl so URLs do not double up', () => {
    const md = buildAgentGuideMarkdown({ daemonUrl: 'http://example.test:1234/' });
    expect(md).toContain('http://example.test:1234/api/health');
    expect(md).not.toContain('http://example.test:1234//api/health');
  });

  it('includes every guide section heading', () => {
    const md = buildAgentGuideMarkdown();
    for (const section of GUIDE_SECTIONS) {
      expect(md).toContain(`## ${section.heading}`);
    }
  });

  it('renders fenced code blocks that match each snippet language', () => {
    const md = buildAgentGuideMarkdown();
    const fenceCount = (md.match(/```/g) ?? []).length;
    expect(fenceCount % 2).toBe(0);
    expect(fenceCount).toBeGreaterThan(GUIDE_SECTIONS.length * 2);
    expect(md).toContain('```bash');
    expect(md).toContain('```json');
    expect(md).toContain('```yaml');
  });

  it('documents the current project create plus run start CLI flow', () => {
    const md = buildAgentGuideMarkdown();
    expect(md).toContain(`${PRODUCT_CLI_NAME} project import-folder`);
    expect(md).toContain(`${PRODUCT_CLI_NAME} run start`);
    expect(md).toContain('--conversation "$CONVERSATION_ID"');
    expect(md).toContain('[form answers - discovery]');
    expect(md).toContain(`${PRODUCT_CLI_NAME} files list "$PROJECT_ID"`);
    expect(md).not.toContain(`${PRODUCT_CLI_NAME} run \\\n  --plugin`);
    expect(md).not.toContain("--prompt 'A 10-slide investor pitch");
  });

  it('surfaces version and CLI hints in the checklist when supplied', () => {
    const md = buildAgentGuideMarkdown({
      versionHint: '0.42.0',
      cliHint: `/usr/local/bin/${PRODUCT_CLI_NAME}`,
    });
    expect(md).toContain('Reported OpenPixo version: `0.42.0`');
    expect(md).toContain(`The user reported \`${PRODUCT_CLI_NAME}\` at: \`/usr/local/bin/${PRODUCT_CLI_NAME}\``);
  });

  it('omits hint sentences when the corresponding option is not provided', () => {
    const md = buildAgentGuideMarkdown();
    expect(md).not.toContain('Reported OpenPixo version');
    expect(md).not.toContain(`The user reported \`${PRODUCT_CLI_NAME}\` at`);
  });

  it('always closes with a Reference URLs section', () => {
    const md = buildAgentGuideMarkdown({ daemonUrl: 'http://example.test:5555' });
    expect(md).toContain('## Reference URLs');
    expect(md).toContain('- Daemon: `http://example.test:5555`');
    expect(md).toContain('- MCP install info: `http://example.test:5555/api/mcp/install-info`');
  });

  it(`uses daemon install-info for the MCP config instead of assuming ${PRODUCT_CLI_NAME} is on PATH`, () => {
    const md = buildAgentGuideMarkdown({
      daemonUrl: 'http://127.0.0.1:7456',
      mcpInstallInfo: {
        command: 'C:\\Program Files\\OpenPixo\\OpenPixo.exe',
        args: [
          'C:\\Program Files\\OpenPixo\\resources\\app\\apps\\daemon\\dist\\cli.js',
          'mcp',
        ],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          PIXO_DATA_DIR: 'C:\\Users\\Ada\\AppData\\Roaming\\OpenPixo',
        },
      },
    });

    expect(md).toContain('"command": "C:\\\\Program Files\\\\OpenPixo\\\\OpenPixo.exe"');
    expect(md).toContain(
      '"C:\\\\Program Files\\\\OpenPixo\\\\resources\\\\app\\\\apps\\\\daemon\\\\dist\\\\cli.js"',
    );
    expect(md).toContain('"ELECTRON_RUN_AS_NODE": "1"');
    expect(md).toContain('"PIXO_DATA_DIR": "C:\\\\Users\\\\Ada\\\\AppData\\\\Roaming\\\\OpenPixo"');
    expect(md).not.toContain(`"command": "${PRODUCT_CLI_NAME}"`);
  });

  it('does not rewrite CLI snippets with POSIX env prefixes for Windows packaged installs', () => {
    const md = buildAgentGuideMarkdown({
      daemonUrl: 'http://127.0.0.1:7456',
      mcpInstallInfo: {
        command: 'C:\\Program Files\\OpenPixo\\OpenPixo.exe',
        args: [
          'C:\\Program Files\\OpenPixo\\resources\\app\\apps\\daemon\\dist\\cli.js',
          'mcp',
        ],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          PIXO_DATA_DIR: 'C:\\Users\\Ada\\AppData\\Roaming\\OpenPixo',
        },
      },
    });

    expect(md).toContain('"command": "C:\\\\Program Files\\\\OpenPixo\\\\OpenPixo.exe"');
    expect(md).toContain('"ELECTRON_RUN_AS_NODE": "1"');
    expect(md).toContain(`${PRODUCT_CLI_NAME} skills list --json`);
    expect(md).not.toMatch(/^\s*ELECTRON_RUN_AS_NODE=1\s+PIXO_DATA_DIR=/m);
  });
});
