// Hover preview panel for the composer "+" → Plugins flyout.
//
// The plugin list shows only a sparkle + name; committing to a plugin
// from a bare name is a guess. This panel is the second-level surface
// that fills in the gap: hovering (or arrow-defaulting to) a plugin
// renders its live preview hero plus the title, the trust badge, and
// the description, so the choice is informed before
// the user clicks.
//
// It reuses the plugins-home preview stack (`inferPluginPreview` +
// `PreviewSurface`) so the hero looks identical to the gallery tile,
// and the localization helpers so the copy follows the active locale.

import { useMemo } from 'react';
import type { InstalledPluginRecord } from '@openpixo/contracts';
import { PreviewSurface } from './plugins-home/cards/PreviewSurface';
import {
  localizePluginDescription,
  localizePluginTitle,
} from './plugins-home/localization';
import { inferPluginPreview } from './plugins-home/preview';
import { TrustBadge } from './TrustBadge';

export function ComposerPluginPreview({
  record,
  locale,
}: {
  record: InstalledPluginRecord;
  locale: string;
}) {
  const preview = useMemo(
    () => inferPluginPreview(record, {}),
    [record],
  );
  const title = localizePluginTitle(locale, record);
  const description = localizePluginDescription(locale, record);

  return (
    <div className="plus-menu__preview" data-plugin-id={record.id}>
      <div className="plus-menu__preview-meta">
        <div className="plus-menu__preview-title-row">
          <span className="plus-menu__preview-title" title={title}>
            {title}
          </span>
          <TrustBadge trust={record.trust} />
        </div>
        {description ? (
          <p className="plus-menu__preview-desc">{description}</p>
        ) : null}
      </div>
      <div className="plus-menu__preview-hero">
        {/* `eager` mounts media/iframe immediately — the panel is already a
            deliberate hover, so there is no off-screen cost to defer. */}
        <PreviewSurface
          pluginId={record.id}
          pluginTitle={title}
          preview={preview}
          eager
        />
      </div>
    </div>
  );
}
