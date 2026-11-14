import { useId } from 'react';
import { Select } from '@openpixo/components';
import {
  AGENT_IMAGE_MODEL_AUTOMATIC,
  type AgentImageModelOption,
  type AgentImageModelsResponse,
} from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { ComposerMenuPicker, type ComposerMenuOption } from '../composer/ComposerMenuPicker';
import { Icon } from '../Icon';
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

/** One menu row per model: its name, then where it comes from or why it can't run now. */
function chipOptions(data: AgentImageModelsResponse, t: Translate): ComposerMenuOption[] {
  const now = data.automatic ? data.options.find((option) => option.id === data.automatic) : null;
  return [
    {
      id: AGENT_IMAGE_MODEL_AUTOMATIC,
      label: t('agentImageModel.automatic'),
      description: now ? t('agentImageModel.automaticNowShort', { model: optionLabel(now, t) }) : undefined,
    },
    ...data.options.map((option) => {
      const named = option.id === 'codex-image' || option.hosted;
      const source = named ? undefined : option.providerLabel;
      const unavailable = option.available ? undefined : t('agentImageModel.unavailableShort');
      return {
        id: option.id,
        label: named ? optionLabel(option, t) : option.label,
        description: [source, unavailable].filter(Boolean).join(' · ') || undefined,
      };
    }),
    // A saved pick the daemon no longer lists still shows as what is chosen.
    ...(data.selected && !data.options.some((option) => option.id === data.selected)
      ? [{ id: data.selected, label: data.selected, description: t('agentImageModel.unavailableShort') }]
      : []),
  ];
}

/** The composer's image chip beside the agent picker; edits the same pick as Settings. */
export function AgentImageModelChip() {
  const { t } = useI18n();
  const { data, saving, saveFailed, choose } = useAgentImageModels();
  if (!data) return null;
  const warning = data.selected && data.selectedUnavailable
    ? t(`agentImageModel.unavailable.${data.selectedUnavailable}` as const)
    : null;
  return (
    <span className={styles.chipSlot} data-testid="agent-image-model-chip">
      <ComposerMenuPicker
        label={t('agentImageModel.title')}
        hint={t('agentImageModel.hint')}
        title={saveFailed ? t('agentImageModel.saveFailed') : warning ?? t('agentImageModel.chipTitle')}
        testId="agent-image-model-chip-picker"
        triggerLeading={<Icon name="image" size={14} />}
        tone={warning || saveFailed ? 'warning' : undefined}
        busy={saving}
        value={data.selected ?? AGENT_IMAGE_MODEL_AUTOMATIC}
        options={chipOptions(data, t)}
        onChange={(id) => { void choose(id === AGENT_IMAGE_MODEL_AUTOMATIC ? null : id); }}
      />
    </span>
  );
}
