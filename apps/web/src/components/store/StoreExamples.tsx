import { Button, Card } from '@openpixo/components';
import { resolveLocalizedText, type PluginExample } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import styles from './StoreExamples.module.css';

export function StoreExamples({ examples, styleId, onTryExample }: {
  examples: PluginExample[];
  styleId?: string;
  onTryExample?: (prompt: string, styleId?: string) => void;
}) {
  const { t, locale } = useI18n();
  if (!examples.length) return null;
  return <section className={styles.examples} aria-labelledby="store-examples-title">
    <h2 id="store-examples-title">{t('store.examples')}</h2>
    <ul>{examples.map((example, index) => {
      const prompt = resolveLocalizedText({ en: example.prompt, ...example.prompt_i18n }, locale) || example.prompt;
      return <li key={example.title + '-' + index}><Card className={styles.example}>
        <div><h3>{resolveLocalizedText({ en: example.title, ...example.title_i18n }, locale) || example.title}</h3><p>{prompt}</p></div>
        <Button variant="secondary" disabled={!onTryExample} onClick={() => {
          if (styleId) onTryExample?.(prompt, styleId);
          else onTryExample?.(prompt);
        }}>{t('store.tryInProject')}</Button>
      </Card></li>;
    })}</ul>
  </section>;
}
