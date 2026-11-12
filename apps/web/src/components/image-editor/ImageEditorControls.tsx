import { Input, Select } from '@openpixo/components';
import type { ImageEditOp } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { constrainCrop, type CropRect, type ImageSize } from './image-edit-preview';
import styles from './ImageEditor.module.css';

export type EditorTool = Exclude<ImageEditOp['op'], 'flip'> | 'flip-h' | 'flip-v';
export interface EditorSettings {
  tool: EditorTool; crop: CropRect; aspect: string;
  resizeMode: 'pixels' | 'percent'; width: number; height: number; percent: number; lockAspect: boolean; filter: 'nearest' | 'smooth';
  padWidth: number; padHeight: number; powerOfTwo: boolean;
}
export const aspectValue = (aspect: string) => aspect === 'free' ? null : Number(aspect.split(':')[0]) / Number(aspect.split(':')[1]);
export const initialSettings = (size: ImageSize): EditorSettings => ({
  tool: 'crop', crop: { width: size.width, height: size.height, x: 0, y: 0 }, aspect: 'free', resizeMode: 'pixels', width: size.width, height: size.height,
  percent: 100, lockAspect: true, filter: 'nearest', padWidth: size.width, padHeight: size.height, powerOfTwo: false,
});

export function pendingImageEdit(settings: EditorSettings, size: ImageSize): ImageEditOp | null {
  switch (settings.tool) {
    case 'crop': {
      const crop = settings.crop;
      return crop.x === 0 && crop.y === 0 && crop.width === size.width && crop.height === size.height ? null : { op: 'crop', ...crop };
    }
    case 'resize': return settings.resizeMode === 'percent' ? { op: 'resize', scale: settings.percent / 100, filter: settings.filter }
      : { op: 'resize', width: settings.width, height: settings.height, filter: settings.filter };
    case 'trim': return { op: 'trim' };
    case 'pad': return settings.powerOfTwo ? { op: 'pad', powerOfTwo: true } : { op: 'pad', width: settings.padWidth, height: settings.padHeight };
    case 'flip-h': return { op: 'flip', axis: 'h' };
    case 'flip-v': return { op: 'flip', axis: 'v' };
    case 'rotate': return { op: 'rotate', degrees: 90 };
  }
}

export function ImageEditorControls({ settings, size, onChange, disabled }: {
  settings: EditorSettings; size: ImageSize; onChange: (settings: EditorSettings) => void; disabled: boolean;
}) {
  const { t } = useI18n();
  const update = (patch: Partial<EditorSettings>) => onChange({ ...settings, ...patch });
  const number = (label: keyof Dict, value: number, change: (value: number) => void, min = 1, max = 8192) => <label>{t(label)}
    <Input type="number" min={min} max={max} step={1} value={value} onChange={event => change(Number(event.target.value))} />
  </label>;
  const changeCrop = (field: keyof CropRect, value: number) => {
    let crop = { ...settings.crop, [field]: Math.round(value) };
    const aspect = aspectValue(settings.aspect);
    if (aspect && field === 'width') crop.height = Math.max(1, Math.round(value / aspect));
    if (aspect && field === 'height') crop.width = Math.max(1, Math.round(value * aspect));
    crop = constrainCrop(crop, size);
    if (aspect) {
      const width = Math.max(1, Math.min(crop.width, Math.floor(crop.height * aspect)));
      crop = constrainCrop({ ...crop, width, height: Math.max(1, Math.round(width / aspect)) }, size);
    }
    update({ crop });
  };
  return <fieldset className={styles.controls} disabled={disabled}>
    {settings.tool === 'crop' && <>
      <label>{t('imageEditor.aspect')}<Select value={settings.aspect} onChange={event => {
        const aspect = aspectValue(event.target.value);
        let crop = { ...settings.crop };
        if (aspect) {
          crop.width = Math.max(1, Math.min(crop.width, Math.floor(crop.height * aspect)));
          crop.height = Math.max(1, Math.round(crop.width / aspect));
          crop = constrainCrop(crop, size);
        }
        update({ aspect: event.target.value, crop });
      }}><option value="free">{t('imageEditor.free')}</option>{['1:1', '4:3', '3:4', '16:9', '9:16'].map(aspect => <option key={aspect}>{aspect}</option>)}</Select></label>
      <div className={styles.numberGrid}>
        {number('imageEditor.cropX', settings.crop.x, value => changeCrop('x', value), 0, size.width - 1)}
        {number('imageEditor.cropY', settings.crop.y, value => changeCrop('y', value), 0, size.height - 1)}
        {number('imageEditor.cropWidth', settings.crop.width, value => changeCrop('width', value), 1, size.width - settings.crop.x)}
        {number('imageEditor.cropHeight', settings.crop.height, value => changeCrop('height', value), 1, size.height - settings.crop.y)}
      </div>
    </>}
    {settings.tool === 'resize' && <>
      <label>{t('imageEditor.resizeBy')}<Select value={settings.resizeMode} onChange={event => update({ resizeMode: event.target.value as 'pixels' | 'percent' })}>
        <option value="pixels">{t('imageEditor.pixels')}</option><option value="percent">{t('imageEditor.percent')}</option>
      </Select></label>
      {settings.resizeMode === 'percent' ? number('imageEditor.percentage', settings.percent, value => update({ percent: value }), 1, 10000) : <>
        <div className={styles.numberGrid}>
          {number('imageEditor.width', settings.width, value => update({ width: value, ...(settings.lockAspect ? { height: Math.max(1, Math.round(value * size.height / size.width)) } : {}) }))}
          {number('imageEditor.height', settings.height, value => update({ height: value, ...(settings.lockAspect ? { width: Math.max(1, Math.round(value * size.width / size.height)) } : {}) }))}
        </div>
        <label className={styles.checkbox}><Input type="checkbox" checked={settings.lockAspect} onChange={event => update({ lockAspect: event.target.checked, ...(event.target.checked ? { height: Math.max(1, Math.round(settings.width * size.height / size.width)) } : {}) })} />{t('imageEditor.lockAspect')}</label>
      </>}
      <label>{t('imageEditor.resampling')}<Select value={settings.filter} onChange={event => update({ filter: event.target.value as 'nearest' | 'smooth' })}>
        <option value="nearest">{t('imageEditor.nearest')}</option><option value="smooth">{t('imageEditor.smooth')}</option>
      </Select></label>
    </>}
    {settings.tool === 'pad' && <>
      <label className={styles.checkbox}><Input type="checkbox" checked={settings.powerOfTwo} onChange={event => update({ powerOfTwo: event.target.checked })} />{t('imageEditor.powerOfTwo')}</label>
      {!settings.powerOfTwo && <div className={styles.numberGrid}>
        {number('imageEditor.canvasWidth', settings.padWidth, value => update({ padWidth: value }), size.width)}
        {number('imageEditor.canvasHeight', settings.padHeight, value => update({ padHeight: value }), size.height)}
      </div>}
      <p className={styles.hint}>{t('imageEditor.padHint')}</p>
    </>}
    {settings.tool === 'trim' && <p className={styles.hint}>{t('imageEditor.trimHint')}</p>}
  </fieldset>;
}