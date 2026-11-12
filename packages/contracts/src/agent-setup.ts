/** Vendor setup commands shared by onboarding and machine readiness checks. */
export interface AgentSetupGuide {
  id: string;
  name: string;
  installCommand: string;
  signInCommand: string;
  /** Prints a version when the CLI is installed and reachable. */
  versionCommand: string;
}

export const AGENT_SETUP_GUIDES: readonly AgentSetupGuide[] = [
  {
    id: 'codex',
    name: 'Codex CLI',
    installCommand: 'npm install -g @openai/codex',
    signInCommand: 'codex login',
    versionCommand: 'codex --version',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    signInCommand: 'claude',
    versionCommand: 'claude --version',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    installCommand: 'npm install -g opencode-ai',
    signInCommand: 'opencode auth login',
    versionCommand: 'opencode --version',
  },
];

export function agentSetupGuide(agentId: string | null | undefined): AgentSetupGuide | null {
  if (!agentId) return null;
  return AGENT_SETUP_GUIDES.find((guide) => guide.id === agentId) ?? null;
}

/** The npm mirror a mainland user falls back to; the same one the daemon uses for game dependencies. */
export const AGENT_INSTALL_NPM_MIRROR = 'https://registry.npmmirror.com';

export type AgentInstallPromptLocale = 'en' | 'zh-CN';

/**
 * A message the user pastes into an AI app they already have (Codex, WorkBuddy
 * and the like) so that app installs and signs in the CLI for them. It is for
 * people who have never opened a terminal, so every step is spelled out: the
 * receiving AI cannot ask OpenPixo anything.
 *
 * Invariants:
 * - Signing in is the user's own act. The AI opens a window the user can see
 *   and stops; it never types credentials or answers the sign-in for them.
 * - Nothing else on the computer changes: only Node.js (when npm is missing)
 *   and the one CLI are installed.
 * - It ends by sending the user back to OpenPixo to check again, which is the
 *   only thing that proves the CLI is found.
 */
export function agentInstallPrompt(
  guide: AgentSetupGuide,
  locale: AgentInstallPromptLocale,
): string {
  const install = guide.installCommand;
  const mirrored = `${install} --registry=${AGENT_INSTALL_NPM_MIRROR}`;
  const signInWindow = `Start-Process powershell -ArgumentList '-NoExit','-Command','${guide.signInCommand}'`;
  const node = 'winget install --id OpenJS.NodeJS.LTS -e';
  if (locale === 'zh-CN') {
    return [
      `请帮我在这台 Windows 电脑上安装并登录 ${guide.name}。我要在 OpenPixo（一个做游戏的软件）里用它。请你直接在终端里运行下面的命令，每做完一步告诉我结果：`,
      '',
      `1. 运行 \`${guide.versionCommand}\`。如果显示了版本号，说明已经装好了，直接跳到第 4 步。`,
      `2. 运行 \`npm --version\`。如果找不到 npm，先运行 \`${node}\` 安装 Node.js，装完后在新的终端窗口里继续。`,
      `3. 运行 \`${install}\`。如果下载很慢或失败（比如在中国大陆），改为运行 \`${mirrored}\`。`,
      `4. 登录要我自己来。请运行 \`${signInWindow}\`，打开一个我能看到的 PowerShell 窗口，然后告诉我在那个窗口（或它打开的浏览器）里完成登录。不要替我输入任何账号或密码。`,
      `5. 我说登录好了以后，再运行一次 \`${guide.versionCommand}\`，确认能用。`,
      '',
      '全部完成后告诉我：回到 OpenPixo，点「重新扫描」或「重新检查」；如果还是找不到，就完全退出 OpenPixo 再重新打开。',
      '除此之外，不要改动这台电脑上的其他任何东西。',
    ].join('\n');
  }
  return [
    `Please install and sign in to ${guide.name} on this Windows computer. I want to use it in OpenPixo, an app for making games. Run the commands below yourself in a terminal and tell me how each step went:`,
    '',
    `1. Run \`${guide.versionCommand}\`. If it prints a version number, it is already installed: skip to step 4.`,
    `2. Run \`npm --version\`. If npm is not found, install Node.js first with \`${node}\`, then continue in a new terminal window.`,
    `3. Run \`${install}\`. If the download is slow or fails (for example in mainland China), run \`${mirrored}\` instead.`,
    `4. Signing in is up to me. Run \`${signInWindow}\` to open a PowerShell window I can see, then tell me to finish signing in there (or in the browser it opens). Never type any account name or password for me.`,
    `5. When I say I have signed in, run \`${guide.versionCommand}\` again to confirm it works.`,
    '',
    'When everything is done, tell me: go back to OpenPixo and click "Rescan" or "Check again"; if it still is not found, quit OpenPixo completely and open it again.',
    'Do not change anything else on this computer.',
  ].join('\n');
}
