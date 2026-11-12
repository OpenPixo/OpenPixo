import { useId } from 'react';
import { Select } from '@openpixo/components';
import type { AgentImageModelOption, AgentImageModelsResponse } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { useAgentImageModels } from './agent-image-model';
import styles from './AgentImageModelPicker.module.css';

const AUTOMATIC_VALUE = '';

type Translate = ReturnType<typeof useI18n>['t'];

function optionLabel(option: AgentImageModelOption, t: Translate): string {
  if (option.id === 'codex-image') return t('agentImageModel.codexOption');
  if (option.hosted) return t('agentImageModel.hostedOption');
  return option.providerLabel ? `${option.label} · ${option.providerLabel}` : option.label;
}

function automaticLabel(data: AgentImageModelsResponse | null, t: Translate): string {
  const now = data?.automatic ? data.options.find((option) => option.id === data.automatic) : null;
  return now ? t('agentImageModel.automaticNow', { model: optionLabel(now, t) }) : t('agentImageModel.automatic');
}

function ModelOptions({ data, t }: { data: AgentImageModelsResponse | null; t: Translate }) {
  return (
    <>
      <option value={AUTOMATIC_VALUE}>{automaticLabel(data, t)}</option>
      {data?.options.map((option) => (
        <option key={option.id} value={option.id}>
          {optionLabel(option, t)}{option.available ? '' : ` (${t('agentImageModel.unavailableShort')})`}
        </option>
      ))}
    </>
  );
}

/** Settings → media: the image model the AI makes art with, apart from the chat AI. */
export function AgentImageModelSetting() {
  const { t } = useI18n();
  const { data, saving, saveFailed, choose } = useAgentImageModels();
  const headingId = useId();
  return (
    <div className={styles.setting} data-testid="agent-image-model-setting">
      <h3 id={headingId} className={styles.title}>{t('agentImageModel.title')}</h3>
      <p className={styles.hint}>{t('agentImageModel.hint')}</p>
      <Select
        className={styles.settingSelect}
        aria-labelledby={headingId}
        data-testid="agent-image-model-select"
        value={data?.selected ?? AUTOMATIC_VALUE}
        disabled={!data || saving}
        onChange={(event) => { void choose(event.target.value || null); }}
      >
        <ModelOptions data={data} t={t} />
      </Select>
      <p className={styles.hint}>
        {data?.selected && data.selectedUnavailable
          ? t(`agentImageModel.unavailable.${data.selectedUnavailable}` as const)
          : data && !data.automatic && data.options.length === 0
            ? t('agentImageModel.none')
            : t('agentImageModel.automaticHint')}
      </p>
      {saveFailed ? <p className={styles.error} role="alert">{t('agentImageModel.saveFailed')}</p> : null}
    </div>
  );
}

/** The composer's compact "生图：自动" chip beside the agent picker; edits the same pick. */
export function AgentImageModelChip() {
  const { t } = useI18n();
  const { data, saving, saveFailed, choose } = useAgentImageModels();
  if (!data) return null;
  const warning = data.selected && data.selectedUnavailable
    ? t(`agentImageModel.unavailable.${data.selectedUnavailable}` as const)
    : null;
  return (
    <label
      className={[styles.chip, warning || saveFailed ? styles.chipWarning : ''].filter(Boolean).join(' ')}
      title={saveFailed ? t('agentImageModel.saveFailed') : warning ?? t('agentImageModel.chipTitle')}
      data-testid="agent-image-model-chip"
    >
      <span className={styles.chipPrefix} aria-hidden="true">{t('agentImageModel.chipLabel')}</span>
      <select
        className={styles.chipSelect}
        aria-label={t('agentImageModel.title')}
        value={data.selected ?? AUTOMATIC_VALUE}
        disabled={saving}
        onChange={(event) => { void choose(event.target.value || null); }}
      >
        <option value={AUTOMATIC_VALUE}>{t('agentImageModel.automatic')}</option>
        {data.options.map((option) => (
          <option key={option.id} value={option.id}>
            {optionLabel(option, t)}{option.available ? '' : ` (${t('agentImageModel.unavailableShort')})`}
          </option>
        ))}
      </select>
    </label>
  );
}
