import type { GameEngineId, PluginExample, RecipeSummary } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { localizedRecipeCopy } from '../studio/localization';
import { recipeMatchesEngine } from '../studio/project-catalog';
import { KIND_SPECS, GENERATE_KINDS } from './generate-request';
import { Strip } from './Showcase';
import { FadeImage, loadingFrame } from './FadeImage';
import styles from './Presets.module.css';

/** The box's own kinds are plain recipes; presets are every other media recipe. */
const PLAIN_RECIPES = new Set(GENERATE_KINDS.map(kind => KIND_SPECS[kind].recipeId));
const plainId = (id: string) => id.replace(/^openpixo\//u, '');

/** A picture of an example, served from the recipe's own folder by the daemon. */
export function recipeExampleUrl(recipeId: string, index: number, which: 'before' | 'after' | 'cover'): string {
  return `/api/recipes/${encodeURIComponent(recipeId)}/examples/${index}/${which}`;
}

/**
 * The presets 生成 offers: media recipes other than the box's plain ones. With no game,
 * only recipes for any engine that need no character; with a game, those its engine can use.
 */
export function generatePresets(recipes: readonly RecipeSummary[], game: { engine?: GameEngineId | null | undefined } | null): RecipeSummary[] {
  return recipes.filter(recipe => recipe.surface !== 'code' && recipe.surface !== 'video' && !PLAIN_RECIPES.has(plainId(recipe.id))
    && (game ? recipeMatchesEngine(recipe, game.engine) : recipe.engines.includes('any') && !recipe.needsGame));
}

/** The example a card leads with: the first one that has a picture. */
export function leadExample(recipe: Pick<RecipeSummary, 'examples'>): { example: PluginExample; index: number } | null {
  const index = (recipe.examples ?? []).findIndex(example => example.after || example.cover);
  return index < 0 ? null : { example: recipe.examples![index]!, index };
}

/** One of a preset's examples, as the box takes it: its words and its settings (做同款). */
export interface PresetSample { prompt?: string | undefined; inputs?: Record<string, unknown> | undefined }

/** The example a card leads with, worded in this language, for 做同款. */
export function presetSample(recipe: Pick<RecipeSummary, 'examples'>, locale: string): PresetSample | undefined {
  const lead = leadExample(recipe);
  if (!lead) return undefined;
  const prompt = locale.startsWith('zh') ? lead.example.prompt_i18n?.['zh-CN'] ?? lead.example.prompt : lead.example.prompt;
  return { prompt, inputs: lead.example.inputs };
}

/**
 * Presets as pictures (spec slice 3): what each makes, its name on the picture, and on
 * hover what a click does and what one costs.
 * A click is 做同款: the preset goes in the box as a tag with its example's words (when the
 * box has none of the user's) and settings. The one in the box is marked. The compact grid
 * sits in the box's 预设 panel.
 */
export function PresetCards({ recipes, onPick, activeId = null, compact = false, priceOf }: {
  recipes: readonly RecipeSummary[];
  onPick: (recipe: RecipeSummary, sample?: PresetSample) => void;
  activeId?: string | null;
  compact?: boolean;
  /** What one costs, already worded; null when not known. */
  priceOf?: ((recipe: RecipeSummary) => string | null) | undefined;
}) {
  const { t, locale } = useI18n();
  if (!recipes.length) return null;
  const cards = recipes.map(recipe => {
      const copy = localizedRecipeCopy(recipe, locale);
      const lead = leadExample(recipe);
      const after = lead ? recipeExampleUrl(recipe.id, lead.index, lead.example.after ? 'after' : 'cover') : null;
      const before = lead?.example.before ? recipeExampleUrl(recipe.id, lead.index, 'before') : null;
      const active = recipe.id === activeId;
      const price = compact ? null : priceOf?.(recipe) ?? null;
      return <li key={recipe.id}>
        <button type="button" className={styles.card} onClick={() => onPick(recipe, presetSample(recipe, locale))} aria-pressed={active}
          title={copy.description || undefined} data-testid="generate-preset" data-recipe-id={recipe.id} data-surface={recipe.surface}>
          <span className={`${styles.art} ${loadingFrame}`} data-cover={lead?.example.cover && !lead.example.after ? true : undefined}>
            {after && <FadeImage src={after} loading="lazy" className={styles.after} draggable={false} />}
            {before && <span className={styles.before}><FadeImage src={before} loading="lazy" draggable={false} /><span className={styles.beforeArrow} aria-hidden="true">→</span></span>}
          </span>
          <span className={styles.cardShade} aria-hidden="true" />
          <span className={styles.caption}>
            <span className={styles.cardTitle}>{copy.title}</span>
          </span>
          {/* What a click does, and what it costs, on hover: the card itself stays a picture. */}
          <span className={styles.use}>
            {active ? t('generate.presetInBox') : recipe.needsGame ? t('generate.presetOpen') : t('generate.makeSame')}
            {price && !active && <span className={styles.usePrice}>{price}</span>}
          </span>
        </button>
      </li>;
  });
  // On the page a strip, so it never ends on a half-empty row; in the box's panel a small grid.
  return compact ? <ul className={styles.cards} data-compact data-testid="generate-presets">{cards}</ul>
    : <Strip listClassName={styles.stripCards} testId="generate-presets" count={recipes.length}>{cards}</Strip>;
}
