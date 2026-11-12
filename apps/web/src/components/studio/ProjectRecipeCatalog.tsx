import { useEffect, useState } from 'react';
import { Button, Input } from '@openpixo/components';
import type { GameEngineId, GetMediaCapabilitiesResponse, RecipeSummary } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { Icon, type IconName } from '../Icon';
import { studioCopy } from './copy';
import { localizedRecipeCopy, missingProviderCopy } from './localization';
import { missingRecipeCapabilities } from './media-capabilities';
import { RECIPE_GROUPS, recipeGroup, recipeMatchesEngine, recipePreviewSource, type RecipeGroup } from './project-catalog';
import styles from './StudioPanel.module.css';

const GROUP_ICONS: Record<RecipeGroup, IconName> = {
  art: 'image', audio: 'volume', model3d: 'orbit', features: 'puzzle', starters: 'hammer',
};

/**
 * Recipes by what you are making, one row each. Choosing a row opens its detail
 * view in place of this list. A row says it can't run only once capabilities are
 * known, and nothing here shows a price: recipes don't spend credits.
 */
export function ProjectRecipeCatalog({ recipes, engine, engineFailed, media, unavailable, onSelect, onRetryEngine }: {
  recipes: RecipeSummary[]; engine?: GameEngineId | null; engineFailed: boolean;
  media: GetMediaCapabilitiesResponse | null; unavailable: Record<string, string>;
  onSelect: (id: string) => void; onRetryEngine: () => void;
}) {
  const { locale, t } = useI18n();
  const copy = studioCopy(locale);
  const [otherEngines, setOtherEngines] = useState(false);
  const [chosen, setChosen] = useState<RecipeGroup | null>(null);
  useEffect(() => { setOtherEngines(false); setChosen(null); }, [engine]);
  const compatible = recipes.filter(recipe => otherEngines || recipeMatchesEngine(recipe, engine));
  const groups = RECIPE_GROUPS.filter(group => compatible.some(recipe => recipeGroup(recipe) === group));
  const group = chosen && groups.includes(chosen) ? chosen : groups[0];
  const visible = compatible.filter(recipe => recipeGroup(recipe) === group);
  const someHidden = recipes.some(recipe => !recipeMatchesEngine(recipe, engine));

  return <div>
    {groups.length > 1 && <div role="group" aria-label={copy.categories} className={styles.groupTabs}>
      {groups.map(value => <Button key={value} size="sm" variant="ghost" className={styles.groupTab}
        aria-pressed={value === group} onClick={() => setChosen(value)}>{t(`studio.groups.${value}`)}</Button>)}
    </div>}
    {engineFailed && <div className={styles.engineFailed}><span>{t('studio.catalog.engineUnknown')}</span>
      <Button size="sm" variant="ghost" onClick={onRetryEngine}>{copy.retry}</Button></div>}
    {group === 'starters' && <p className={styles.starterWarning} role="note">{t('studio.catalog.starterWarning')}</p>}
    {!visible.length && <p className={styles.muted}>{copy.empty}</p>}
    <ul className={styles.recipeRows}>{visible.map(recipe => {
      const { title, description } = localizedRecipeCopy(recipe, locale);
      const preview = recipePreviewSource(recipe);
      const missing = missingRecipeCapabilities(recipe, media);
      const hint = missing.length ? missingProviderCopy(missing, locale) : unavailable[recipe.id] ? copy.needsProvider.generic : null;
      return <li key={recipe.id}>
        <Button variant="ghost" className={styles.recipeRow} data-recipe-id={recipe.id} onClick={() => onSelect(recipe.id)}>
          <span className={styles.recipeGlyph} aria-hidden="true">{preview
            ? <img src={preview} alt="" loading="lazy" /> : <Icon name={GROUP_ICONS[recipeGroup(recipe)]} size={18} />}</span>
          <span className={styles.recipeText}>
            <span className={styles.recipeTitle}>{title}</span>
            <span className={styles.recipeDescription}>{description}</span>
          </span>
          {hint && <span className={styles.recipeHint}>{hint}</span>}
        </Button>
      </li>;
    })}</ul>
    {/* With no known engine every recipe is already listed; the toggle would do nothing. */}
    {engine && engine !== 'unknown' && someHidden && <label className={styles.catalogToggle}>
      <Input type="checkbox" checked={otherEngines} onChange={event => setOtherEngines(event.target.checked)} />{t('studio.catalog.otherEngines')}</label>}
  </div>;
}
