import { useI18n } from '../../i18n';
import { codexImageReasonKey } from '../../media/codex-image-errors';
import { studioCopy } from './copy';

export function RecipeFailure({ error, errorCode, errorReason }: { error: string; errorCode?: string | undefined; errorReason?: string | undefined }) {
  const { locale, t } = useI18n();
  const code = errorCode ?? errorReason;
  const codex = code?.startsWith('CODEX_');
  return <>
    <span>{codex ? t(codexImageReasonKey(code)) : studioCopy(locale).error}</span>
    {!codex && <details><summary>{t('game.errorDetails')}</summary><pre>{error}</pre></details>}
  </>;
}
