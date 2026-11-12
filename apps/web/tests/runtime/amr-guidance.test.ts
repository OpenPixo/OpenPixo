import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatModelWindowRetryAt, modelWindowLimitCopy, resolveRunFailureUi, } from '../../src/runtime/failure-guidance';



// The Home composer's send path never reaches `resolveRunFailureUi` — it fails
// before a run exists, and its catch-all prints `err.message` verbatim, which is
// how an English gateway sentence ends up on a localized Home screen. Both
// surfaces therefore read the window limit through this one helper.
describe('modelWindowLimitCopy', () => {
  it('reads the window limit and its reset instant off the upstream sentence', () => {
    expect(
      modelWindowLimitCopy(
        'You have reached the 5-hour usage limit for Kimi K2.6. Try again after 2026-08-12T06:34:47Z. This request was not charged to Wallet Credits.',
      ),
    ).toEqual({
      messageKey: 'chat.runError.modelWindowLimitMessage',
      retryAt: '2026-08-12T06:34:47Z',
    });
  });

  it('falls back to the no-time copy when no instant is readable', () => {
    expect(
      modelWindowLimitCopy('[code=model_limit_exceeded] rolling window in effect'),
    ).toEqual({ messageKey: 'chat.runError.modelWindowLimitMessageNoTime' });
  });

  it('leaves every other failure alone', () => {
    expect(modelWindowLimitCopy('Could not create project')).toBeNull();
    expect(modelWindowLimitCopy('insufficient wallet balance')).toBeNull();
    expect(modelWindowLimitCopy(null)).toBeNull();
  });
});

describe('formatModelWindowRetryAt', () => {
  it('renders the gateway instant in the reader locale', () => {
    const formatted = formatModelWindowRetryAt('2026-08-12T06:34:47Z', 'en-US');
    expect(formatted).not.toBe('2026-08-12T06:34:47Z');
    expect(formatted).toMatch(/Aug/);
  });

  it('returns the input untouched rather than rendering "Invalid Date"', () => {
    expect(formatModelWindowRetryAt('not-an-instant', 'en-US')).toBe('not-an-instant');
  });
});

/*
 * ⚠️ OPEND-2772 之后 `cloudSwitchCta` 的判据只剩**一条**:这一轮跑在谁身上。
 *
 * 它以前叫 `showSwitchCard`,由每一条映射自己挑「要不要在报错卡下面再挂一张推荐
 * 卡」。产品 2026-09-07 把 2026-08-26 的 §6.Z 推翻掉了(原话「主 cta 都是切换至
 * cloud」「8-26 推翻掉吧」),第二张卡删掉、CTA 收进报错卡的主按钮位,并且**铺到
 * 所有报错**。所以下面这批断言从 `false` 翻成 `true`(或按 agent 分)不是放宽,
 * 而是这条不变式换了主人:非 Cloud 一律 true,Cloud 一律 false。
 */
describe('resolveRunFailureUi', () => {

  // A transient 429 (no hard-quota detail) still offers Retry — the detail
  // override must not swallow the recoverable case.
  it('keeps Retry for a transient RATE_LIMITED without a hard-quota detail', () => {
    const transient = resolveRunFailureUi('RATE_LIMITED', 'rate_limit_429', 'claude');
    expect(transient).toMatchObject({
      primaryAction: 'retry',
      titleKey: 'chat.runError.title.rateLimited',
    });
  });

  // CLI-missing detected only from stderr text leaks in as the opaque
  // AGENT_EXECUTION_FAILED code; the cli_not_installed detail must still route
  // it to the same "install the CLI, then retry" card as AGENT_UNAVAILABLE.
  it('routes text-detected cli_not_installed detail to the install-CLI card', () => {
    const ui = resolveRunFailureUi('AGENT_EXECUTION_FAILED', 'cli_not_installed', 'claude');
    expect(ui).toMatchObject({
      primaryAction: 'retry',
      titleKey: 'chat.runError.title.cliMissing',
      messageKey: 'chat.runError.cliMissingMessage',
    });
  });

  // #895 long tail: lower-frequency failure_detail values the daemon already
  // classifies (timeout, empty output, stale resumed session)
  // now map to a named type + actionable copy with a plain Retry, for any agent —
  // the AGENT_EXECUTION_FAILED code alone would only show the raw stderr.
  it('maps long-tail failure_detail values to a named type + retry guidance for any agent', () => {
    const cases: Array<[string, string, string]> = [
      ['timeout', 'chat.runError.title.timedOut', 'chat.runError.timedOutMessage'],
      ['inactivity_timeout', 'chat.runError.title.timedOut', 'chat.runError.inactivityTimeoutMessage'],
      ['empty_output', 'chat.runError.title.emptyOutput', 'chat.runError.emptyOutputMessage'],
      ['session_resume_expired', 'chat.runError.title.sessionExpired', 'chat.runError.sessionExpiredMessage'],
    ];
    for (const [detail, titleKey, messageKey] of cases) {
      for (const agent of ['claude', 'codex', 'opencode', 'byok-opencode', null]) {
        expect(resolveRunFailureUi('AGENT_EXECUTION_FAILED', detail, agent)).toMatchObject({
          primaryAction: 'retry',
          titleKey,
          messageKey,
          secondaryRetry: false,
        });
      }
    }
  });

  it('suppresses only the Git Bash card while retaining its failure mapping for every agent', () => {
    for (const agent of ['claude', 'codex', 'opencode', 'byok-opencode', null]) {
      expect(resolveRunFailureUi('AGENT_EXECUTION_FAILED', 'git_bash_missing', agent)).toMatchObject({
        suppressCard: true,
        primaryAction: 'retry',
        secondaryRetry: false,
        titleKey: 'chat.runError.title.gitBashMissing',
        messageKey: 'chat.runError.gitBashMissingMessage',
      });
      expect(resolveRunFailureUi('AGENT_EXECUTION_FAILED', 'cli_not_installed', agent).suppressCard)
        .not.toBe(true);
    }
  });

  // A cpu_unsupported crash (bundled agent binary requires AVX2, this CPU has
  // none) is deterministic: retry re-runs the same binary on the same CPU, and
  // switching hosted models doesn't replace the runtime binary — the binary that
  // cannot start IS the hosted runtime. No Retry, no AMR promotion, for every
  // agent. Ladder rung 4, so the standing 〔Contact support〕 secondary is
  // promoted to primary rather than leaving a card with nothing on it.
  it('maps cpu_unsupported to update guidance without retry or switch card', () => {
    for (const agent of ['claude', 'codex', 'opencode', 'byok-opencode', null]) {
      expect(resolveRunFailureUi('AGENT_EXECUTION_FAILED', 'cpu_unsupported', agent)).toMatchObject({
        primaryAction: 'contact-support',
        titleKey: 'chat.runError.title.cpuUnsupported',
        messageKey: 'chat.runError.cpuUnsupportedMessage',
        secondaryRetry: false,
      });
    }
  });

  // os_unsupported: the bundled runtime cannot load on a Windows build older
  // than 10 1809. Same deterministic shape as cpu_unsupported — no Retry; the
  // card names the OS version so the user stops retrying and updates Windows.
  it('maps os_unsupported to Windows-version guidance without retry', () => {
    for (const agent of ['claude', 'codex', 'opencode', 'byok-opencode', null]) {
      expect(resolveRunFailureUi('AGENT_EXECUTION_FAILED', 'os_unsupported', agent)).toMatchObject({
        primaryAction: 'contact-support',
        titleKey: 'chat.runError.title.osUnsupported',
        messageKey: 'chat.runError.osUnsupportedMessage',
        secondaryRetry: false,
      });
    }
  });

  // Agent-agnostic root-cause codes (#895): each carries a named failure type +
  // actionable fix, resolved the same way for any agent, with a plain Retry and
  // no AMR promotion (these aren't "switch to hosted model" cases).
  //
  // `AGENT_RUNTIME_DEF_INVALID` used to be in this list and no longer is: the
  // user cannot self-repair a bad runtime definition and a new run re-reads the
  // same file, so it moved to ladder rung 4 (catalogue R-031: flow F10,
  // "retryable: no"). Its own assertion lives in run-error-ladder.test.ts.
  it('maps agent-agnostic root-cause codes to a named type + guidance for any agent', () => {
    const cases: Array<[string, string, string | null]> = [
      // S23 的正文以前是 null,卡面因此落到兜底那句「这次没能顺利完成」——
      // 一次**正常结束**的任务被说成失败。产品文档 S23 有终稿,现在补上了。
      [
        'ARTIFACT_NOT_FOUND',
        'chat.runError.title.artifactMissing',
        'chat.runError.artifactMissingMessage',
      ],
      ['AGENT_UNAVAILABLE', 'chat.runError.title.cliMissing', 'chat.runError.cliMissingMessage'],
      ['AGENT_PROMPT_TOO_LARGE', 'chat.runError.title.promptTooLarge', 'chat.runError.promptTooLargeMessage'],
      ['TOOL_LOOP_DETECTED', 'chat.runError.title.toolLoop', 'chat.runError.toolLoopMessage'],
      ['ROLE_MARKER_HALLUCINATION', 'chat.runError.title.outputInvalid', 'chat.runError.outputInvalidMessage'],
    ];
    for (const [code, titleKey, messageKey] of cases) {
      for (const agent of ['claude', 'codex', 'opencode', 'byok-opencode', null]) {
        const ui = resolveRunFailureUi(code, null, agent);
        expect(ui).toMatchObject({
          primaryAction: 'retry',
          titleKey,
          messageKey,
          secondaryRetry: false,
        });
      }
    }
  });

  it('localizes a classified stream disconnect instead of exposing raw SDK text', () => {
    for (const agent of ['opencode', 'byok-opencode', 'codex', 'claude', null]) {
      const ui = resolveRunFailureUi(
        'AGENT_EXECUTION_FAILED',
        'stream_disconnected',
        agent,
        'stream disconnected before completion: Transport error',
      );
      expect(ui).toMatchObject({
        primaryAction: 'retry',
        titleKey: 'chat.runError.title.connectionDropped',
        messageKey: 'chat.connectionDropped',
      });
    }
  });

  it('keeps normal retry guidance for local CLI authentication failures', () => {
    for (const agent of ['claude', 'codex', 'opencode']) {
      expect(resolveRunFailureUi('AGENT_AUTH_REQUIRED', null, agent)).toMatchObject({
        primaryAction: 'retry',
        messageKey: 'chat.runError.signInMessage.other',
        secondaryRetry: false,
      });
    }
  });
});
