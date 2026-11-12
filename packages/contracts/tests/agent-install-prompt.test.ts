import { describe, expect, it } from 'vitest';
import {
  AGENT_INSTALL_NPM_MIRROR,
  AGENT_SETUP_GUIDES,
  agentInstallPrompt,
  agentSetupGuide,
} from '../src/agent-setup.js';

describe('agentInstallPrompt', () => {
  it.each(AGENT_SETUP_GUIDES.flatMap((guide) => (['en', 'zh-CN'] as const).map((locale) => [guide.id, locale] as const)))(
    'spells out every step for %s in %s',
    (id, locale) => {
      const guide = agentSetupGuide(id)!;
      const prompt = agentInstallPrompt(guide, locale);
      expect(prompt).toContain(guide.name);
      expect(prompt).toContain(`\`${guide.versionCommand}\``);
      expect(prompt).toContain(`\`${guide.installCommand}\``);
      // A mainland user whose npm download stalls has a working fallback.
      expect(prompt).toContain(`\`${guide.installCommand} --registry=${AGENT_INSTALL_NPM_MIRROR}\``);
      // npm may be missing on a machine that has never seen a developer tool.
      expect(prompt).toContain('winget install --id OpenJS.NodeJS.LTS -e');
      // Signing in happens in a window the user can see, run by the user.
      expect(prompt).toContain(`Start-Process powershell -ArgumentList '-NoExit','-Command','${guide.signInCommand}'`);
      // It ends by sending the user back to OpenPixo to check again.
      expect(prompt).toMatch(locale === 'zh-CN' ? /重新扫描/ : /Rescan/);
    },
  );

  it('tells the AI never to type credentials and to leave the rest of the computer alone', () => {
    const codex = agentSetupGuide('codex')!;
    expect(agentInstallPrompt(codex, 'en')).toMatch(/Never type any account name or password for me/);
    expect(agentInstallPrompt(codex, 'en')).toMatch(/Do not change anything else on this computer/);
    expect(agentInstallPrompt(codex, 'zh-CN')).toMatch(/不要替我输入任何账号或密码/);
    expect(agentInstallPrompt(codex, 'zh-CN')).toMatch(/不要改动这台电脑上的其他任何东西/);
  });

  it('keeps sign-in commands free of quotes so the PowerShell window command stays valid', () => {
    for (const guide of AGENT_SETUP_GUIDES) {
      expect(guide.signInCommand).not.toMatch(/['"`]/);
    }
  });
});
