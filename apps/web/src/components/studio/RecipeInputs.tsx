import { Button, Input, Select } from '@openpixo/components';
import type { CharacterCard, InputField, ProjectFile } from '@openpixo/contracts';
import { PluginInputsForm } from '../PluginInputsForm';
import { useI18n } from '../../i18n';
import { studioCopy } from './copy';
import styles from './StudioPanel.module.css';

export function RecipeInputs({ fields, values, files, fileLabels, characters, maxCount, onChange, onValidityChange, onNewCharacter }: {
  fields: InputField[]; values: Record<string, unknown>; files: ProjectFile[]; characters: CharacterCard[];
  /** Names to show for files that are not the game's own (pictures uploaded to 生成). */
  fileLabels?: Readonly<Record<string, string>> | undefined;
  maxCount: number;
  /** Offered right at a character field when the project has no cards yet. */
  onNewCharacter?: () => void;
  onChange: (values: Record<string, unknown>) => void; onValidityChange: (valid: boolean) => void;
}) {
  const { locale } = useI18n();
  const copy = studioCopy(locale);
  return <div className={styles.inputs}>
    <PluginInputsForm fields={fields} values={values} onChange={onChange} onValidityChange={onValidityChange}
      renderInput={(field, value, update) => {
        const text = typeof value === 'string' ? value : '';
        if (field.type === 'image-ref' || field.type === 'asset-ref' || field.type === 'file') {
          const paths = files.filter(file => field.type !== 'image-ref' || /\.(png|jpe?g|webp|gif|avif|svg|bmp)$/i.test(file.name)).map(file => file.name);
          return <Select value={text} required={field.required} onChange={event => update(event.target.value || undefined)}>
            <option value="">{copy.select}</option>
            {text && !paths.includes(text) && <option value={text}>{text}</option>}
            {paths.map(path => <option key={path} value={path}>{fileLabels?.[path] ?? path}</option>)}
          </Select>;
        }
        if (field.type === 'character-ref') return <>
          <Select value={text} required={field.required} disabled={!characters.length} onChange={event => update(event.target.value || undefined)}>
            <option value="">{characters.length ? copy.select : copy.noCharacters}</option>
            {characters.map(card => <option key={card.slug} value={card.slug}>{card.name}</option>)}
          </Select>
          {!characters.length && onNewCharacter && <Button type="button" size="sm" variant="secondary" className={styles.inlineAction}
            onClick={onNewCharacter}>{copy.addCharacter}</Button>}
        </>;
        if (field.type === 'aspect') return <Input value={text} required={field.required} placeholder="1:1"
          pattern="[0-9]+([.][0-9]+)?:[0-9]+([.][0-9]+)?" onChange={event => update(event.target.value || undefined)} />;
        if (field.type === 'count') return <Input type="number" min={1} max={maxCount} step={1} required={field.required}
          value={value == null ? '' : String(value)} onChange={event => update(event.target.value === '' ? undefined : Number(event.target.value))} />;
        return undefined;
      }} />
  </div>;
}
