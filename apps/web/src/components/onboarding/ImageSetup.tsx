// Step 1 of the "use my own tools" guide: something that can make images.
//
// Two ways, in the order most people should try them: Codex signed in with a
// ChatGPT account (no key, uses that plan), or an image API key. Codex status
// is the daemon's own answer (`GET /api/media/config`), rechecked on focus so
// running `codex login` in a terminal turns the step green on return. A key is
// proven with the free model-list call where the provider has one, and saved
// through the same `mediaProviders` config Settings › Media writes.

import { useEffect, useId, useRef, useState } from 'react';
import { Button, Input } from '@openpixo/components';
import type { MediaProviderAvailability } from '@openpixo/contracts';
import { useT } from '../../i18n';
import { codexImageReasonKey } from '../../media/codex-image-errors';
import { fetchProviderModels } from '../../providers/provider-models';
import { isStoredMediaProviderEntryPresent } from '../../state/config';
import type { AppConfig, ProviderModelsResponse } from '../../types';
import { AgentIcon } from '../AgentIcon';
import { Icon } from '../Icon';
import { AiRow, AskAiToInstall, CommandLine, ExternalLinkButton } from './AgentSetup';
import { agentSetupGuide } from './agentSetupGuide';
import { IMAGE_KEY_PROVIDERS, imageKeyProvider, type ImageKeyProvider } from './key-guides';
import { OnboardingDropdown } from './OnboardingDropdown';
import styles from './Onboarding.module.css';
import setup from './Setup.module.css';

type ImageChoice = 'codex' | 'key';

export interface ImageSetupProps {
  config: AppConfig;
  codexStatus: MediaProviderAvailability | null;
  codexChecking: boolean;
  onRecheckCodex: () => void;
  onConfigPersist: (cfg: AppConfig) => Promise<void> | void;
  /** Codex is signed in here (e.g. the desktop app) but its CLI is missing. */
  codexAppWithoutCli?: boolean;
}

type KeyCheck =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'failed'; result: ProviderModelsResponse };

/** Failures that say nothing about the key itself; the key may still be saved. */
function keyCheckInconclusive(result: ProviderModelsResponse): boolean {
  return result.kind === 'rate_limited' || result.kind === 'timeout' || result.kind === 'upstream_unavailable';
}

export function savedImageKeyProvider(config: AppConfig): ImageKeyProvider | null {
  return IMAGE_KEY_PROVIDERS.find((provider) => isStoredMediaProviderEntryPresent(config.mediaProviders?.[provider.id])) ?? null;
}

export function ImageSetup({ config, codexStatus, codexChecking, onRecheckCodex, onConfigPersist, codexAppWithoutCli = false }: ImageSetupProps) {
  const t = useT();
  const saved = savedImageKeyProvider(config);
  const [choice, setChoice] = useState<ImageChoice>(saved && codexStatus?.available !== true ? 'key' : 'codex');
  return (
    <section className={styles.agentSetup} aria-label={t('onboarding.imageStepTitle')}>
      <div className={styles.aiList} role="radiogroup" aria-label={t('onboarding.imageStepTitle')}>
        <AiRow
          checked={choice === 'codex'}
          icon={<AgentIcon id="codex" size={22} />}
          title={t('onboarding.imageCodexTitle')}
          detail={t('onboarding.imageCodexBody')}
          tag={null}
          testId="onboarding-image-codex"
          delay={0}
          onSelect={() => setChoice('codex')}
        />
        <AiRow
          checked={choice === 'key'}
          icon={<span className={styles.aiKeyIcon}><Icon name="key" size={15} /></span>}
          title={t('onboarding.imageKeyTitle')}
          detail={t('onboarding.imageKeyBody')}
          tag={null}
          testId="onboarding-image-key"
          delay={45}
          onSelect={() => setChoice('key')}
        />
      </div>
      <div className={styles.details} key={choice}>
        {choice === 'codex'
          ? <CodexImagePanel status={codexStatus} checking={codexChecking} onRecheck={onRecheckCodex} codexAppWithoutCli={codexAppWithoutCli} />
          : <ImageKeyPanel config={config} onConfigPersist={onConfigPersist} />}
      </div>
    </section>
  );
}

function CodexImagePanel({ status, checking, onRecheck, codexAppWithoutCli = false }: {
  status: MediaProviderAvailability | null;
  checking: boolean;
  onRecheck: () => void;
  codexAppWithoutCli?: boolean;
}) {
  const t = useT();
  const guide = agentSetupGuide('codex');
  if (!status) {
    return (
      <p className={styles.aiScanning} role="status">
        <Icon name="spinner" size={14} className="icon-spin" />{t('onboarding.imageCodexChecking')}
      </p>
    );
  }
  if (status.available) {
    return (
      <div className={styles.verify} data-state="success" role="status" data-testid="onboarding-image-codex-ready">
        <Icon name="check" size={15} />
        <div className={styles.verifyCopy}><p>{t('onboarding.imageCodexReady')}</p></div>
      </div>
    );
  }
  const notInstalled = status.reasonCode === 'CODEX_CLI_NOT_FOUND';
  const needsSignIn = status.reasonCode === 'CODEX_CLI_AUTH_REQUIRED';
  return (
    <div className={styles.panelBody}>
      {/* The numbered steps say the same as the reason, so the reason shows only without them. */}
      {notInstalled || needsSignIn ? null : (
        <p className={styles.panelHint} role="status">{t(codexImageReasonKey(status.reasonCode))}</p>
      )}
      {notInstalled && codexAppWithoutCli ? (
        <p className={styles.callout} data-tone="warn" role="note" data-testid="onboarding-image-codex-app-without-cli">
          {t('onboarding.codexAppWithoutCli')}
        </p>
      ) : null}
      {notInstalled || needsSignIn ? (
        <ol className={setup.howTo}>
          {notInstalled && guide ? (
            <li>
              <span>{t('onboarding.imageCodexInstall')}</span>
              <CommandLine command={guide.installCommand} />
            </li>
          ) : null}
          {guide ? (
            <li>
              <span>{t('onboarding.imageCodexSignIn')}</span>
              <CommandLine command={guide.signInCommand} />
            </li>
          ) : null}
          <li><span>{t('onboarding.imageCodexComeBack')}</span></li>
        </ol>
      ) : null}
      {(notInstalled || needsSignIn) && guide ? <AskAiToInstall agentId={guide.id} withHint /> : null}
      <Button size="sm" variant="secondary" className={setup.inlineButton} onClick={onRecheck}
        disabled={checking} aria-busy={checking || undefined}>
        <Icon name={checking ? 'spinner' : 'refresh'} size={13} className={checking ? 'icon-spin' : undefined} />
        <span>{checking ? t('onboarding.scanning') : t('onboarding.checkAgain')}</span>
      </Button>
    </div>
  );
}

function ImageKeyPanel({ config, onConfigPersist }: Pick<ImageSetupProps, 'config' | 'onConfigPersist'>) {
  const t = useT();
  const keyId = useId();
  const hintId = useId();
  const saved = savedImageKeyProvider(config);
  const [providerId, setProviderId] = useState<ImageKeyProvider['id']>(saved?.id ?? 'openai');
  const provider = imageKeyProvider(providerId) ?? IMAGE_KEY_PROVIDERS[0]!;
  const [apiKey, setApiKey] = useState('');
  const [visible, setVisible] = useState(false);
  const [check, setCheck] = useState<KeyCheck>({ status: 'idle' });
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const savedEntry = config.mediaProviders?.[provider.id];
  const hasSaved = isStoredMediaProviderEntryPresent(savedEntry);
  const savedTail = savedEntry?.apiKeyTail?.trim() || savedEntry?.apiKey?.trim().slice(-4) || '';

  async function save() {
    const map = { ...(config.mediaProviders ?? {}) };
    const previous = map[provider.id];
    map[provider.id] = {
      ...(previous ?? {}),
      apiKey: apiKey.trim(),
      baseUrl: previous?.baseUrl?.trim() || provider.baseUrl,
      ...(previous?.model ? { model: previous.model } : {}),
    };
    setApiKey('');
    setCheck({ status: 'idle' });
    await onConfigPersist({ ...config, mediaProviders: map });
  }

  async function checkAndSave() {
    const key = apiKey.trim();
    if (!key || check.status === 'running') return;
    if (!provider.verify) { await save(); return; }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setCheck({ status: 'running' });
    let result: ProviderModelsResponse;
    try {
      result = await fetchProviderModels({ ...provider.verify, apiKey: key }, controller.signal);
    } catch {
      return; // Aborted: the user changed provider or left.
    }
    if (controller.signal.aborted) return;
    if (result.ok) { await save(); return; }
    setCheck({ status: 'failed', result });
  }

  const failure = check.status === 'failed' ? check.result : null;
  const failureKey = !failure ? null
    : failure.kind === 'auth_failed' || failure.kind === 'forbidden' ? 'onboarding.imageKeyRejected'
      : keyCheckInconclusive(failure) ? 'onboarding.imageKeyCheckLater'
        : 'onboarding.imageKeyCheckFailed';

  return (
    <div className={styles.panelBody}>
      <OnboardingDropdown
        label={t('onboarding.imageKeyProvider')}
        placeholder={provider.label}
        value={provider.id}
        options={IMAGE_KEY_PROVIDERS.map((item) => ({ value: item.id, label: item.label }))}
        onChange={(value) => {
          request.current?.abort();
          setProviderId(value as ImageKeyProvider['id']);
          setApiKey('');
          setCheck({ status: 'idle' });
        }}
      />
      {hasSaved ? (
        <div className={styles.verify} data-state="success" role="status" data-testid="onboarding-image-key-ready">
          <Icon name="check" size={15} />
          <div className={styles.verifyCopy}>
            <p>{t('onboarding.imageKeySaved', { provider: provider.label, tail: savedTail ? ` …${savedTail}` : '' })}</p>
          </div>
        </div>
      ) : null}
      <ol className={setup.howTo} aria-label={t('onboarding.whereKeyTitle')}>
        <li>
          <span>{t('onboarding.whereKeyOpen', { host: provider.consoleHost })}</span>
          <ExternalLinkButton href={provider.consoleUrl}>{t('onboarding.openSite', { host: provider.consoleHost })}</ExternalLinkButton>
        </li>
        <li><span>{t(provider.howTo)}</span></li>
        <li><span>{t('onboarding.whereKeyPaste')}</span></li>
      </ol>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={keyId}>
          {hasSaved ? t('onboarding.imageKeyReplace') : t('settings.apiKey')}
        </label>
        <span className={styles.fieldRow}>
          <Input
            id={keyId}
            className={styles.input}
            type={visible ? 'text' : 'password'}
            placeholder={provider.placeholder}
            value={apiKey}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={hintId}
            aria-invalid={failureKey === 'onboarding.imageKeyRejected' || undefined}
            onChange={(event) => { setApiKey(event.target.value); if (check.status === 'failed') setCheck({ status: 'idle' }); }}
            onKeyDown={(event) => { if (event.key === 'Enter') void checkAndSave(); }}
          />
          <Button size="sm" variant="ghost" onClick={() => setVisible((current) => !current)}>
            {visible ? t('settings.hide') : t('settings.show')}
          </Button>
        </span>
        <span id={hintId} className={styles.fieldHint}>
          {t(provider.verify ? 'onboarding.imageKeyHintVerify' : 'onboarding.imageKeyHintNoVerify', { provider: provider.label })}
        </span>
      </div>
      {failure && failureKey ? (
        <div className={styles.verify} data-state={keyCheckInconclusive(failure) ? 'warn' : 'error'} role="alert">
          <Icon name="alert-triangle" size={15} />
          <div className={styles.verifyCopy}>
            <p>{t(failureKey, { detail: failure.detail ?? '' })}</p>
            {keyCheckInconclusive(failure) ? (
              <Button size="sm" variant="ghost" className={setup.inlineButton} onClick={() => void save()}>
                {t('onboarding.imageKeySaveAnyway')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <Button variant="secondary" className={setup.inlineButton} data-testid="onboarding-image-key-save"
        disabled={!apiKey.trim() || check.status === 'running'} aria-busy={check.status === 'running' || undefined}
        onClick={() => void checkAndSave()}>
        {check.status === 'running' ? <Icon name="spinner" size={14} className="icon-spin" /> : null}
        <span>{check.status === 'running' ? t('onboarding.imageKeyChecking')
          : provider.verify ? t('onboarding.imageKeyCheckSave') : t('onboarding.imageKeySave')}</span>
      </Button>
    </div>
  );
}
