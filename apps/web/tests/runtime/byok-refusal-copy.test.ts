// The words a BYOK preflight refusal puts on the failure card, in both locales,
// and the mapping that gets them there. The card test next to this one uses an
// identity translator, so a key missing real copy would only show up here.
import { describe, expect, it } from 'vitest';

import { en } from '../../src/i18n/locales/en';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { resolveRunErrorCardDescription, resolveRunFailureUi } from '../../src/runtime/failure-guidance';

const REFUSALS = [
  {
    code: 'BYOK_OPENCODE_UNAVAILABLE',
    runtime: 'OpenCode',
    messageKey: 'chat.runError.byokOpencodeUnavailableMessage',
  },
  {
    code: 'BYOK_CODEX_UNAVAILABLE',
    runtime: 'Codex',
    messageKey: 'chat.runError.byokCodexUnavailableMessage',
  },
] as const;

const LOCALES = [
  { name: 'en', dict: en, settingsPage: 'Settings', localCliTab: en['settings.localCli'], retryWord: /retry|try again/i },
  { name: 'zh-CN', dict: zhCN, settingsPage: '设置', localCliTab: zhCN['settings.localCli'], retryWord: /重试/ },
] as const;

describe.each(REFUSALS)('$code', ({ code, runtime, messageKey }) => {
  it.each(LOCALES)('$name says what is missing and how to fix it', ({ dict, settingsPage, localCliTab, retryWord }) => {
    const message = dict[messageKey];

    expect(message).toContain(runtime);
    // Rescan only exists on the Local CLI tab, so the sentence has to say so.
    expect(message).toContain(settingsPage);
    expect(message).toContain(localCliTab);
    // Retrying is the last step, never the first thing the card tells you.
    const retryAt = message.search(retryWord);
    expect(retryAt).toBeGreaterThan(message.indexOf(localCliTab));
  });

  it.each(LOCALES)('$name has a title that names the runtime', ({ dict }) => {
    const title = dict[resolveRunFailureUi(code, null, 'byok-opencode').titleKey];

    expect(title).toContain('{agent}');
  });

  it('maps to its own copy with Settings as the fix', () => {
    expect(resolveRunFailureUi(code, null, 'byok-opencode')).toMatchObject({
      primaryAction: 'open-settings',
      secondaryRetry: true,
      leadsWithSettings: true,
      messageKey,
      messageVars: { agent: runtime },
    });
  });

  it('wins over the raw text in the pane slot and on the persisted event', () => {
    expect(
      resolveRunErrorCardDescription({
        handedToAnotherSurface: false,
        mappedMessageKey: resolveRunFailureUi(code, null, 'byok-opencode').messageKey,
        paneError: 'raw run text',
        paneErrorCameFromARun: true,
        failedRunRawDetail: 'raw run text',
        turnEndedInTerminalFailure: true,
      }),
    ).toEqual({ render: 'mapped', messageKey });
  });
});
