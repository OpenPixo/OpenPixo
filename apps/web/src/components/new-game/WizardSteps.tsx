import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, Input, Textarea } from '@openpixo/components';
import {
  GAME_ART_SOURCES,
  GAME_CONTROL_SCHEMES,
  GAME_EXPERIENCE_LEVELS,
  GAME_LANGUAGES,
  GAME_PLAYER_MODES,
  GAME_SCOPES,
  GAME_SETUP_LIMITS,
  type ArtStyle,
  type GameControlScheme,
  type GameExperience,
  type GameLanguage,
  type GamePerspective,
  type GamePlayerMode,
  type GameScope,
} from '@openpixo/contracts';
import { Check, ChevronDown, Gamepad2, ImagePlus, Mountain, Plus, Sparkles, Sprout, Trophy, X, Zap } from 'lucide-react';
import { useT } from '../../i18n';
import type { Dict } from '../../i18n/types';
import {
  FEATURED_GENRES,
  GENRE_GROUPS,
  PIXEL_SIZES,
  REFERENCE_MAX_BYTES,
  draftResolution,
  genreValue,
  integerScaleTo1080p,
  isFeaturedGenre,
  perspectiveDimension,
  perspectivesFor,
  resolutionChoices,
  suggestedSetup,
  type GenrePreset,
  type StepProblem,
  type WizardDraft,
  type WizardReference,
  type WizardStepId,
} from './wizard-state';
import { onRadioGroupKeyDown, radioTabIndex } from './radio-keys';
import styles from './GameSetupWizard.module.css';

type Update = (patch: Partial<WizardDraft>) => void;

export const PROBLEM_KEYS: Record<StepProblem, keyof Dict> = {
  experience: 'game.wizard.problem.experience', scope: 'game.wizard.problem.scope',
  title: 'game.wizard.problem.title', genre: 'game.wizard.problem.genre', perspective: 'game.wizard.problem.perspective',
  players: 'game.wizard.problem.players', languages: 'game.wizard.problem.languages',
  template: 'game.wizard.problem.template', engine: 'game.wizard.problem.engine', style: 'game.wizard.problem.style',
  direction: 'game.wizard.problem.direction', resolution: 'game.wizard.problem.resolution',
  controls: 'game.wizard.problem.controls', name: 'game.dialog.invalidName',
};

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter(item => item !== value) : [...list, value];
}

/** Cards enter one after another; `--i` is the card's place in that order. */
function stagger(index: number): CSSProperties {
  return { ['--i' as string]: Math.min(index, 12) } as CSSProperties;
}

function Label({ children, optional }: { children: ReactNode; optional?: boolean }) {
  const t = useT();
  return <>{children}{optional ? <span className={styles.optional}>{t('game.wizard.optional')}</span> : null}</>;
}

/**
 * One large selectable card: an icon or small drawing, a title, a one-line
 * hint, and a check mark that animates in when chosen. `radio` cards sit in a
 * `role="radiogroup"`; `checkbox` cards toggle.
 */
export function ChoiceCard({ role = 'radio', checked, onSelect, title, meta, hint, icon, index = 0, tabIndex, extra, testId }: {
  role?: 'radio' | 'checkbox'; checked: boolean; onSelect: () => void; title: ReactNode; meta?: ReactNode; hint?: ReactNode;
  icon?: ReactNode; index?: number; tabIndex?: 0 | -1; extra?: ReactNode; testId?: string;
}) {
  return (
    <button type="button" role={role} aria-checked={checked} tabIndex={tabIndex} className={styles.choice} style={stagger(index)}
      onClick={onSelect} data-testid={testId}>
      {icon ? <span className={styles.choiceIcon} aria-hidden="true">{icon}</span> : null}
      <span className={styles.choiceText}>
        <span className={styles.choiceTitle}>
          <strong>{title}</strong>
          {meta ? <span className={styles.choiceMeta}>{meta}</span> : null}
        </span>
        {hint ? <span className={styles.choiceHint}>{hint}</span> : null}
        {extra}
      </span>
      <span className={styles.choiceCheck} aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
    </button>
  );
}

/**
 * Secondary options, folded away under "More settings". The body stays mounted
 * and animates with the shared `.accordion-collapsible`; while folded it is
 * inert, so focus and screen readers skip it. `reveal` opens it when something
 * inside needs the user (a missing answer).
 */
export function MoreSettings({ children, label, defaultOpen = false, reveal = false, testId }: {
  children: ReactNode; label?: string; defaultOpen?: boolean; reveal?: boolean; testId?: string;
}) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (reveal) setOpen(true); }, [reveal]);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (open) body.removeAttribute('inert'); else body.setAttribute('inert', '');
  }, [open]);
  return (
    <div className={styles.more} data-open={open} data-testid={testId}>
      <button type="button" className={styles.moreToggle} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
        <ChevronDown size={15} aria-hidden="true" className={styles.moreChevron} />
        {label ?? t('game.wizard.more')}
      </button>
      <div id={id} ref={bodyRef} className={`accordion-collapsible${open ? ' open' : ''}`} aria-hidden={!open}>
        <div className="accordion-collapsible-inner">
          <div className={styles.moreBody}>{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * A labelled row of compact toggles; `multiple` makes them checkboxes, otherwise
 * a radio group.
 */
function ChipGroup<T extends string>({ label, values, selected, multiple, labelFor, onToggle, optional, invalid, hint }: {
  label: string; values: readonly T[]; selected: readonly T[]; multiple?: boolean;
  labelFor: (value: T) => string; onToggle: (value: T) => void; optional?: boolean; invalid?: boolean; hint?: ReactNode;
}) {
  const id = useId();
  const anySelected = values.some(value => selected.includes(value));
  return (
    <fieldset className={styles.field}>
      <legend id={id} className={styles.label}><Label optional={optional}>{label}</Label></legend>
      <div className={styles.chips} role={multiple ? 'group' : 'radiogroup'} aria-labelledby={id} data-invalid={invalid || undefined}
        onKeyDown={multiple ? undefined : onRadioGroupKeyDown}>
        {values.map((value, index) => {
          const on = selected.includes(value);
          return (
            <button key={value} type="button" className={styles.chip} data-selected={on}
              role={multiple ? 'checkbox' : 'radio'} aria-checked={on} tabIndex={multiple ? undefined : radioTabIndex(on, index, anySelected)}
              onClick={() => onToggle(value)}>
              {multiple ? <span className={styles.chipTick} aria-hidden="true"><Check size={12} strokeWidth={2.5} /></span> : null}
              {labelFor(value)}
            </button>
          );
        })}
      </div>
      {hint}
    </fieldset>
  );
}

/** A checkbox with a title and one line of explanation; `brand` marks the primary choice. */
export function ToggleRow({ checked, onChange, title, hint, disabled, tone }: {
  checked: boolean; onChange: (checked: boolean) => void; title: string; hint: string; disabled?: boolean; tone?: 'brand';
}) {
  return (
    <label className={styles.toggleRow} data-tone={tone}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
      <span>
        <strong>{title}</strong>
        <span className={styles.hint}>{hint}</span>
      </span>
    </label>
  );
}

/** The question each screen asks. The last one saves instead of creating, and an existing project picks no engine. */
export function stepLabelKey(id: WizardStepId, mode: 'create' | 'edit', kind: 'step' | 'stepHint', beginner = false): keyof Dict {
  if (mode === 'edit' && (id === 'review' || id === 'setup')) return `game.wizard.${kind}.${id}Edit` as keyof Dict;
  if (kind === 'stepHint' && beginner && (id === 'view' || id === 'setup')) return `game.wizard.stepHint.${id}Beginner`;
  return `game.wizard.${kind}.${id}` as keyof Dict;
}

// ---------- experience ----------

const EXPERIENCE_ICONS: Record<GameExperience, ReactNode> = {
  first: <Sprout size={22} strokeWidth={1.75} />,
  some: <Gamepad2 size={22} strokeWidth={1.75} />,
  experienced: <Trophy size={22} strokeWidth={1.75} />,
};

export function ExperienceStep({ value, onChange, invalid }: { value: GameExperience | null; onChange: (value: GameExperience) => void; invalid: boolean }) {
  const t = useT();
  return (
    <div className={styles.cardsStack} role="radiogroup" aria-label={t('game.wizard.step.experience')} data-invalid={invalid || undefined}
      onKeyDown={onRadioGroupKeyDown}>
      {GAME_EXPERIENCE_LEVELS.map((level, index) => (
        <ChoiceCard key={level} checked={value === level} onSelect={() => onChange(level)} index={index}
          tabIndex={radioTabIndex(value === level, index, value !== null)} icon={EXPERIENCE_ICONS[level]}
          title={t(`game.wizard.experience.${level}` as keyof Dict)} hint={t(`game.wizard.experienceHint.${level}` as keyof Dict)} />
      ))}
    </div>
  );
}

// ---------- size ----------

const SCOPE_ICONS: Record<GameScope, ReactNode> = {
  quick: <Zap size={22} strokeWidth={1.75} />,
  crafted: <Sparkles size={22} strokeWidth={1.75} />,
  long: <Mountain size={22} strokeWidth={1.75} />,
};

export function SizeStep({ draft, update, showProblems }: { draft: WizardDraft; update: Update; showProblems: boolean }) {
  const t = useT();
  const long = draft.scope === 'long';
  return (
    <>
      <div className={styles.cardsStack} role="radiogroup" aria-label={t('game.wizard.step.size')} data-invalid={showProblems && !draft.scope || undefined}
        onKeyDown={onRadioGroupKeyDown}>
        {GAME_SCOPES.map((scope, index) => (
          <ChoiceCard key={scope} checked={draft.scope === scope} onSelect={() => update({ scope })} index={index}
            tabIndex={radioTabIndex(draft.scope === scope, index, draft.scope !== '')} icon={SCOPE_ICONS[scope]}
            title={t(`game.wizard.scope.${scope}` as keyof Dict)} meta={t(`game.wizard.scopeTime.${scope}` as keyof Dict)}
            hint={t(`game.wizard.scopeHint.${scope}` as keyof Dict)} />
        ))}
      </div>
      {/* Kept mounted so it folds away rather than vanishing when the size changes. */}
      <div className={`accordion-collapsible${long ? ' open' : ''}`} aria-hidden={!long} data-testid="size-long-options">
        <div className="accordion-collapsible-inner">
          {long ? (
            <MoreSettings defaultOpen={draft.steamLater}>
              <ToggleRow checked={draft.steamLater} onChange={steamLater => update({ steamLater })}
                title={t('game.wizard.steamLater')} hint={t('game.wizard.steamLaterHint')} />
            </MoreSettings>
          ) : null}
        </div>
      </div>
    </>
  );
}

// ---------- concept ----------

/** A featured genre's picture, or a calm empty frame with a small icon when the image is missing or fails. */
function GenreArt({ genre }: { genre: GenrePreset }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={styles.genreArt} data-failed={failed || undefined}>
      {failed
        ? <Gamepad2 size={22} strokeWidth={1.5} aria-hidden="true" />
        : <img src={`/new-game/genres/${genre}.webp`} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />}
    </span>
  );
}

/**
 * The concept screen. Everyone sees the featured genres as picture cards, each
 * with its plain one-line explanation on the card. Every other genre, and
 * "something else", is a chip under "More types", which opens by itself when
 * the draft already holds one of them; a chip's explanation shows under the
 * chips for the one pointed at or focused, else the chosen one, so it never
 * depends on a tooltip. A first-timer is not asked for a studio or the game's
 * languages (the languages default to the UI's).
 */
export function ConceptStep({ draft, update, showProblems, isNew, beginner = false }: {
  draft: WizardDraft; update: Update; showProblems: boolean; isNew: boolean; beginner?: boolean;
}) {
  const t = useT();
  const id = useId();
  const [pointed, setPointed] = useState<string | null>(null);
  const genreChecked = draft.genre !== '';
  const restGroups = GENRE_GROUPS
    .map(group => ({ id: group.id, genres: (group.genres as readonly GenrePreset[]).filter(genre => !FEATURED_GENRES.includes(genre)) }))
    .filter(group => group.genres.length);
  // Tab order follows the page: the cards, then each group's chips, "something else" last.
  const order: string[] = [...FEATURED_GENRES, ...restGroups.flatMap(group => group.genres), 'custom'];
  const chosenInRest = draft.genre !== '' && !isFeaturedGenre(draft.genre);
  const chipExplained = pointed ?? (chosenInRest ? draft.genre : null);
  const explainId = id + '-genre-explain';
  const card = (genre: GenrePreset, index: number) => {
    const checked = draft.genre === genre;
    const name = t(`game.wizard.genre.${genre}` as keyof Dict);
    return (
      <button key={genre} type="button" role="radio" className={styles.genreCard} aria-checked={checked} aria-label={name}
        aria-describedby={`${id}-genre-${genre}-hint`} tabIndex={radioTabIndex(checked, index, genreChecked)} style={stagger(index)}
        onClick={() => update({ genre })} data-testid={`genre-card-${genre}`}>
        <GenreArt genre={genre} />
        <span className={styles.genreCardName}>{name}</span>
        <span id={`${id}-genre-${genre}-hint`} className={styles.genreCardHint}>{t(`game.wizard.genreHint.${genre}` as keyof Dict)}</span>
        <span className={styles.choiceCheck} aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
      </button>
    );
  };
  const chip = (value: string) => (
    <button key={value} type="button" role="radio" className={styles.chip} aria-checked={draft.genre === value} data-selected={draft.genre === value}
      aria-describedby={draft.genre === value ? explainId : undefined}
      tabIndex={radioTabIndex(draft.genre === value, order.indexOf(value), genreChecked)}
      onMouseEnter={() => setPointed(value)} onMouseLeave={() => setPointed(null)}
      onFocus={() => setPointed(value)} onBlur={() => setPointed(null)}
      onClick={() => update({ genre: value as WizardDraft['genre'] })}>
      {t(`game.wizard.genre.${value}` as keyof Dict)}
    </button>
  );
  const groupRows = restGroups.map((group, groupIndex) => (
    <div key={group.id} className={styles.genreRow} style={stagger(groupIndex)}>
      <span className={styles.genreGroup}>{t(`game.wizard.genreGroup.${group.id}` as keyof Dict)}</span>
      <div className={styles.chips}>
        {(groupIndex === restGroups.length - 1 ? [...group.genres, 'custom'] : group.genres).map(chip)}
      </div>
    </div>
  ));
  // A first-timer is not asked about languages, unless an older draft left none chosen.
  const askLanguages = !beginner || !draft.languages.length;
  return (
    <>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={id + '-title'}><Label optional={!isNew}>{t('game.wizard.title')}</Label></label>
        <Input id={id + '-title'} className={styles.titleInput} value={draft.title} maxLength={GAME_SETUP_LIMITS.title} autoFocus
          aria-invalid={showProblems && isNew && !draft.title.trim() ? true : undefined}
          placeholder={t('game.wizard.titlePlaceholder')} onChange={event => update({ title: event.target.value })} />
      </div>

      <fieldset className={styles.field}>
        <legend id={id + '-genre'} className={styles.label}>{t('game.wizard.genre')}</legend>
        <div className={styles.genres} role="radiogroup" aria-labelledby={id + '-genre'} data-invalid={showProblems && !genreValue(draft) || undefined}
          onKeyDown={onRadioGroupKeyDown}>
          <div className={styles.genreCards} data-testid="genre-featured">{FEATURED_GENRES.map(card)}</div>
          <MoreSettings label={t('game.wizard.genreMore')} defaultOpen={chosenInRest} reveal={chosenInRest} testId="genre-more">
            {groupRows}
            <p id={explainId} className={styles.genreExplain} data-testid="genre-explain" data-empty={!chipExplained || undefined}>
              {chipExplained
                ? <><strong>{t(`game.wizard.genre.${chipExplained}` as keyof Dict)}</strong>{t('game.wizard.genreExplainSeparator')}{t(`game.wizard.genreHint.${chipExplained}` as keyof Dict)}</>
                : t('game.wizard.genreHintEmpty')}
            </p>
          </MoreSettings>
        </div>
        {draft.genre === 'custom' ? (
          <Input aria-label={t('game.wizard.genre')} className={styles.input} value={draft.genreCustom} autoFocus
            maxLength={GAME_SETUP_LIMITS.genre} placeholder={t('game.wizard.genreCustomPlaceholder')}
            onChange={event => update({ genreCustom: event.target.value })} />
        ) : null}
      </fieldset>

      <ChipGroup<GamePlayerMode> label={t('game.wizard.players')} multiple values={GAME_PLAYER_MODES} selected={draft.players}
        invalid={showProblems && !draft.players.length} labelFor={value => t(`game.wizard.player.${value}` as keyof Dict)}
        onToggle={value => update({ players: toggle(draft.players, value) })}
        hint={<p className={styles.hint}>{t(draft.players.some(mode => mode.startsWith('online')) ? 'game.wizard.playersHint.online'
          : draft.players.includes('local-coop') ? 'game.wizard.playersHint.local' : 'game.wizard.playersHint.single')}</p>} />

      <MoreSettings defaultOpen={Boolean(draft.pitch.trim())} reveal={showProblems && !draft.languages.length} testId="concept-more">
        <div className={styles.field}>
          <label className={styles.label} htmlFor={id + '-pitch'}><Label optional>{t('game.wizard.pitch')}</Label></label>
          <Textarea id={id + '-pitch'} className={styles.textarea} rows={2} value={draft.pitch} maxLength={GAME_SETUP_LIMITS.pitch}
            placeholder={t('game.wizard.pitchPlaceholder')} onChange={event => update({ pitch: event.target.value })} />
        </div>
        <div className={beginner ? undefined : styles.twoUp}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={id + '-comps'}><Label optional>{t('game.wizard.comparables')}</Label></label>
            <Input id={id + '-comps'} className={styles.input} value={draft.comparables}
              placeholder={t('game.wizard.comparablesPlaceholder')} onChange={event => update({ comparables: event.target.value })} />
          </div>
          {!beginner ? (
            <div className={styles.field}>
              <label className={styles.label} htmlFor={id + '-studio'}><Label optional>{t('game.wizard.studio')}</Label></label>
              <Input id={id + '-studio'} className={styles.input} value={draft.studio} maxLength={GAME_SETUP_LIMITS.studio}
                placeholder={t('game.wizard.studioPlaceholder')} onChange={event => update({ studio: event.target.value })} />
            </div>
          ) : null}
        </div>
        {askLanguages ? (
          <ChipGroup<GameLanguage> label={t('game.wizard.languages')} multiple values={GAME_LANGUAGES} selected={draft.languages}
            invalid={showProblems && !draft.languages.length} labelFor={value => t(`game.wizard.language.${value}` as keyof Dict)}
            onToggle={value => update({ languages: toggle(draft.languages, value) })}
            hint={<p className={styles.hint}>{t('game.wizard.languagesHint')}</p>} />
        ) : null}
      </MoreSettings>
    </>
  );
}

// ---------- view ----------

/** A small drawing of what the player's view looks like. */
function PerspectiveGlyph({ id }: { id: GamePerspective }) {
  const art: Record<GamePerspective, ReactNode> = {
    'side-2d': <><path d="M3 25h38" /><path d="M9 25v-7h9v7M27 25v-12h9v12" /><rect x="20" y="9" width="4" height="6" fill="currentColor" stroke="none" /></>,
    'top-down-2d': <><rect x="8" y="3" width="28" height="24" rx="1" /><path d="M8 11h28M8 19h28M17 3v24M27 3v24" opacity=".4" /><rect x="19" y="13" width="6" height="5" fill="currentColor" stroke="none" /></>,
    'isometric-2d': <><path d="M22 4 38 13 22 22 6 13Z" /><path d="M6 13v5l16 9 16-9v-5M22 22v5" /></>,
    'ui-2d': <><rect x="7" y="8" width="11" height="17" rx="1.5" transform="rotate(-10 12 16)" /><rect x="17" y="5" width="11" height="17" rx="1.5" /><rect x="27" y="8" width="11" height="17" rx="1.5" transform="rotate(10 32 16)" /></>,
    'hd-2d': <><path d="M4 26 14 14h16l10 12Z" /><path d="M9 20h26M18 14l-4 12M26 14l4 12" opacity=".4" /><rect x="20" y="6" width="4" height="12" fill="currentColor" stroke="none" /></>,
    'first-person-3d': <><path d="M3 3l15 11M41 3 26 14M3 27l15-9M41 27 26 18" opacity=".5" /><rect x="18" y="12" width="8" height="7" /><path d="M31 27l3-8 4 2-2 6" /></>,
    'third-person-3d': <><path d="M4 27 16 11h12l12 16Z" opacity=".5" /><circle cx="22" cy="10" r="2.5" fill="currentColor" stroke="none" /><path d="M22 13v9M18 17h8M22 22l-3 5M22 22l3 5" /></>,
    'top-down-3d': <><path d="M4 22 22 12l18 10-18 7Z" opacity=".5" /><path d="M22 4l8 4v6l-8 4-8-4V8ZM14 8l8 4 8-4M22 12v6" /></>,
  };
  return <svg width="56" height="38" viewBox="0 0 44 30" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{art[id]}</svg>;
}

/** Each view says in a few plain words what it looks like, on the card itself. */
export function ViewStep({ draft, update, showProblems, beginner, isNew }: { draft: WizardDraft; update: Update; showProblems: boolean; beginner: boolean; isNew: boolean }) {
  const t = useT();
  const id = useId();
  const offered = perspectivesFor(beginner);
  const checked = offered.some(value => value === draft.perspective);
  return (
    <div className={styles.perspectives} role="radiogroup" aria-label={t('game.wizard.perspective')} data-count={offered.length}
      data-invalid={showProblems && isNew && !checked || undefined} onKeyDown={onRadioGroupKeyDown}>
      {offered.map((value, index) => (
        <button key={value} type="button" role="radio" className={styles.perspective} aria-checked={draft.perspective === value}
          aria-label={t(`game.wizard.perspective.${value}` as keyof Dict)} aria-describedby={`${id}-${value}-hint`}
          tabIndex={radioTabIndex(draft.perspective === value, index, checked)} style={stagger(index)}
          onClick={() => update({ perspective: value })}>
          <span className={styles.perspectiveArt}><PerspectiveGlyph id={value} /></span>
          <span className={styles.perspectiveName}>{t(`game.wizard.perspective.${value}` as keyof Dict)}</span>
          <span id={`${id}-${value}-hint`} className={styles.perspectiveHint}>{t(`game.wizard.perspectiveHint.${value}` as keyof Dict)}</span>
          <span className={styles.choiceCheck} aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
        </button>
      ))}
    </div>
  );
}

// ---------- art ----------

/**
 * The look. Each style card shows its short description under the title.
 * Picking a style sets its pixel size silently (it shapes the suggested screen
 * size) but never copies its palette: colours are the user's own optional
 * answer, and otherwise follow the style and the sample picked while planning.
 * A first-timer is not asked for colours, pixel size or who makes the final art.
 * There is no "generate a style sample" toggle: planning always shows samples.
 */
export function ArtStep({ draft, update, showProblems, styleList, stylesLoading, stylesFailed, onRetryStyles, references, onReferences, onReferenceError, beginner = false }: {
  draft: WizardDraft; update: Update; showProblems: boolean;
  styleList: ArtStyle[]; stylesLoading: boolean; stylesFailed: boolean; onRetryStyles: () => void;
  references: WizardReference[]; onReferences: (next: WizardReference[]) => void; onReferenceError: (message: string | null) => void;
  beginner?: boolean;
}) {
  const t = useT();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const colorRef = useRef<HTMLInputElement>(null);
  const twoDimensional = perspectiveDimension(draft.perspective) !== '3d';

  function chooseStyle(style: ArtStyle | null) {
    if (!style) { update({ styleId: 'custom' }); return; }
    update({ styleId: style.id, pixelSize: style.constraints?.pixelSize ?? (style.medium.includes('pixel') ? 16 : 0) });
  }

  function addFiles(files: FileList | null) {
    if (!files) return;
    const room = GAME_SETUP_LIMITS.references - references.length;
    const accepted: WizardReference[] = [];
    let rejected: string | null = null;
    for (const file of [...files].slice(0, Math.max(0, room))) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > REFERENCE_MAX_BYTES) { rejected = t('game.wizard.referenceTooLarge', { name: file.name }); continue; }
      accepted.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, url: URL.createObjectURL(file) });
    }
    onReferenceError(rejected);
    if (accepted.length) onReferences([...references, ...accepted]);
  }

  const styleInvalid = showProblems && !draft.styleId;
  const styleChecked = draft.styleId === 'custom' || styleList.some(style => style.id === draft.styleId);
  const custom = draft.styleId === 'custom';
  const steam = draft.stores.includes('steam') || (draft.scope === 'long' && draft.steamLater);
  const showAiNote = steam && (draft.artSource === 'ai' || draft.artSource === 'mixed');
  const directionField = (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id + '-direction'}><Label optional={!custom}>{t('game.wizard.direction')}</Label></label>
      <Textarea id={id + '-direction'} className={styles.textarea} rows={2} value={draft.direction} maxLength={GAME_SETUP_LIMITS.direction}
        aria-invalid={showProblems && custom && !draft.direction.trim() ? true : undefined}
        placeholder={t('game.wizard.directionPlaceholder')} onChange={event => update({ direction: event.target.value })} />
    </div>
  );
  return (
    <>
      <div className={styles.field}>
        <div className={styles.styleGrid} role="radiogroup" aria-label={t('game.wizard.style')} data-invalid={styleInvalid || undefined}
          aria-busy={stylesLoading || undefined} onKeyDown={onRadioGroupKeyDown}>
          {stylesLoading ? [0, 1, 2, 3, 4, 5, 6, 7].map(index => <span key={index} className={styles.styleSkeleton} />) : null}
          {styleList.map((style, index) => (
            <button key={style.id} type="button" role="radio" aria-checked={draft.styleId === style.id}
              aria-label={style.title} aria-describedby={style.description ? `${id}-style-${index}` : undefined}
              tabIndex={radioTabIndex(draft.styleId === style.id, index, styleChecked)} style={stagger(index)}
              className={styles.styleCard} onClick={() => chooseStyle(style)} title={style.description}>
              <StylePreview style={style} />
              <span className={styles.styleTitle}>{style.title}</span>
              {style.description ? <span id={`${id}-style-${index}`} className={styles.styleDescription}>{style.description}</span> : null}
              <span className={styles.choiceCheck} aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
            </button>
          ))}
          {!stylesLoading ? (
            <button type="button" role="radio" aria-checked={custom} className={styles.styleCard} style={stagger(styleList.length)}
              tabIndex={radioTabIndex(custom, styleList.length, styleChecked)} onClick={() => chooseStyle(null)}>
              <span className={[styles.stylePreview, styles.styleCustom].join(' ')} aria-hidden="true"><Plus size={20} /></span>
              <span className={styles.styleTitle}>{t('game.wizard.styleCustom')}</span>
              <span className={styles.choiceCheck} aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
            </button>
          ) : null}
        </div>
        {stylesFailed ? (
          <div className={styles.stylesFailed} role="alert">
            <span>{t('game.wizard.stylesFailed')}</span>
            <Button size="sm" variant="secondary" onClick={onRetryStyles}>{t('game.wizard.stylesRetry')}</Button>
          </div>
        ) : !stylesLoading && !styleList.length ? <p className={styles.hint}>{t('game.wizard.stylesEmpty')}</p> : null}
      </div>

      {/* A written direction is the answer itself for a custom look, so it is not folded away then. */}
      {custom ? directionField : null}

      <MoreSettings label={t(beginner ? 'game.wizard.artAdvancedBeginner' : 'game.wizard.artAdvanced')} testId="art-more">
        {!custom ? directionField : null}
        <div className={styles.field}>
          <span className={styles.label}><Label optional>{t('game.wizard.references')}</Label></span>
          <div className={styles.references}>
            {references.map(reference => (
              <figure key={reference.id} className={styles.reference}>
                <img src={reference.url} alt={reference.file.name} />
                <button type="button" className={styles.referenceRemove} aria-label={t('game.wizard.referenceRemove', { name: reference.file.name })}
                  onClick={() => { URL.revokeObjectURL(reference.url); onReferences(references.filter(item => item.id !== reference.id)); }}>
                  <X size={12} strokeWidth={2.5} aria-hidden="true" />
                </button>
              </figure>
            ))}
            {references.length < GAME_SETUP_LIMITS.references ? (
              <button type="button" className={styles.referenceAdd} onClick={() => fileRef.current?.click()}>
                <ImagePlus size={16} aria-hidden="true" />
                <span>{t('game.wizard.referencesAdd')}</span>
              </button>
            ) : null}
            <input ref={fileRef} type="file" accept="image/*" multiple className={styles.hiddenInput} tabIndex={-1}
              aria-label={t('game.wizard.referencesAdd')}
              onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
          </div>
          <p className={styles.hint}>{t('game.wizard.referencesHint', { count: String(GAME_SETUP_LIMITS.references) })}</p>
        </div>
        {beginner ? null : (
          <>
            <ChipGroup label={t('game.wizard.artSource')} optional values={GAME_ART_SOURCES} selected={draft.artSource ? [draft.artSource] : []}
              labelFor={value => t(`game.wizard.artSource.${value}` as keyof Dict)}
              onToggle={value => update({ artSource: draft.artSource === value ? '' : value })}
              hint={showAiNote ? <p className={styles.hint}>{t('game.wizard.aiDisclosureHint')}</p> : null} />
            <div className={styles.field}>
              <span className={styles.label} id={id + '-palette'}><Label optional>{t('game.wizard.palette')}</Label></span>
              <div className={styles.palette} role="group" aria-labelledby={id + '-palette'}>
                {draft.palette.map(color => (
                  <button key={color} type="button" className={styles.swatch} style={{ background: color }}
                    aria-label={t('game.wizard.paletteRemove', { color })} title={color}
                    onClick={() => update({ palette: draft.palette.filter(item => item !== color) })}>
                    <X size={11} strokeWidth={3} aria-hidden="true" />
                  </button>
                ))}
                {draft.palette.length < GAME_SETUP_LIMITS.palette ? (
                  <button type="button" className={[styles.swatch, styles.swatchAdd].join(' ')} aria-label={t('game.wizard.paletteAdd')}
                    title={t('game.wizard.paletteAdd')} onClick={() => colorRef.current?.click()}>
                    <Plus size={13} aria-hidden="true" />
                  </button>
                ) : null}
                <input ref={colorRef} type="color" className={styles.hiddenInput} tabIndex={-1} aria-hidden="true"
                  onChange={event => {
                    const color = event.target.value.toUpperCase();
                    if (!draft.palette.includes(color)) update({ palette: [...draft.palette, color] });
                  }} />
              </div>
              <p className={styles.hint}>{t('game.wizard.paletteHint')}</p>
            </div>
            {twoDimensional ? (
              <ChipGroup label={t('game.wizard.pixelSize')} values={['0', ...PIXEL_SIZES.map(String)]}
                selected={[String(draft.pixelSize)]}
                labelFor={value => value === '0' ? t('game.wizard.pixelSizeNone') : t('game.wizard.pixelSizeValue', { size: value })}
                onToggle={value => update({ pixelSize: Number(value) })}
                hint={<p className={styles.hint}>{t(draft.pixelSize > 0 ? 'game.wizard.pixelSizeHint' : 'game.wizard.pixelSizeNoneHint')}</p>} />
            ) : null}
          </>
        )}
      </MoreSettings>
    </>
  );
}

/** The style's first preview image, or its palette when it has none or the image fails to load. */
function StylePreview({ style }: { style: ArtStyle }) {
  const [failed, setFailed] = useState(false);
  const image = style.previews?.length && !failed;
  return (
    <span className={styles.stylePreview}>
      {image ? <img src={`/api/styles/${encodeURIComponent(style.id)}/previews/0`} alt="" loading="lazy" onError={() => setFailed(true)} /> : null}
      {!image && style.palette?.length ? (
        <span className={styles.stylePalette}>{style.palette.slice(0, 6).map(color => <span key={color} style={{ background: color }} />)}</span>
      ) : null}
    </span>
  );
}

// ---------- engine and tech ----------

function resolutionLabel(t: ReturnType<typeof useT>, value: string): string {
  const scale = integerScaleTo1080p(value);
  if (scale) return t('game.wizard.resolutionScale', { scale: String(scale) });
  return t(`game.wizard.resolutionLabel.${value}` as keyof Dict);
}

/**
 * The engine (create) and the technical defaults. The defaults are already
 * filled in from the earlier answers, so on a new game they sit under "More
 * settings"; an existing project, which has no engine to pick, shows them open.
 * A first-timer keeps the suggested screen size and scaling without seeing
 * them; only the controls stay, unless a size is somehow still missing.
 */
export function SetupStep({ draft, update, showProblems, lead, beginner = false }: {
  draft: WizardDraft; update: Update; showProblems: boolean; lead?: ReactNode; beginner?: boolean;
}) {
  const t = useT();
  const id = useId();
  const suggestion = suggestedSetup(draft);
  const hideScreen = beginner && Boolean(draftResolution(draft));
  const resolutionInvalid = showProblems && !draftResolution(draft);
  const resolutions = [...resolutionChoices(draft), 'custom'];
  const resolutionChecked = resolutions.includes(draft.resolution);
  const threeDimensional = perspectiveDimension(draft.perspective) === '3d';
  // Stretching distorts the art; a setup that already has it keeps showing it.
  const scalings = draft.scaling === 'stretch' ? ['pixel-perfect', 'fit', 'stretch'] as const : ['pixel-perfect', 'fit'] as const;
  const technical = (
    <>
      {hideScreen ? null : (
        <>
          <fieldset className={styles.field}>
            <legend id={id + '-res'} className={styles.label}>
              {t(threeDimensional ? 'game.wizard.resolution3d' : 'game.wizard.resolution')}
            </legend>
            <div className={styles.resolutionGrid} role="radiogroup" aria-labelledby={id + '-res'} data-invalid={resolutionInvalid || undefined}
              onKeyDown={onRadioGroupKeyDown}>
              {resolutions.map((value, index) => (
                <button key={value} type="button" role="radio" aria-checked={draft.resolution === value} className={styles.resolution}
                  tabIndex={radioTabIndex(draft.resolution === value, index, resolutionChecked)}
                  onClick={() => update({ resolution: value })}>
                  <span className={styles.resolutionSize}>{value === 'custom' ? t('game.wizard.resolutionCustom') : value.replace('x', ' × ')}</span>
                  <span className={styles.resolutionLabel}>
                    {value === 'custom' ? t('game.wizard.resolutionCustomHint') : resolutionLabel(t, value)}
                  </span>
                  {value === suggestion.resolution ? <span className={styles.suggested}>{t('game.wizard.suggested')}</span> : null}
                </button>
              ))}
            </div>
            {draft.resolution === 'custom' ? (
              <div className={styles.customSize}>
                <Input aria-label={t('game.wizard.width')} placeholder={t('game.wizard.width')} inputMode="numeric" className={styles.input}
                  value={draft.customWidth} onChange={event => update({ customWidth: event.target.value.replace(/\D/g, '') })}
                  aria-invalid={resolutionInvalid || undefined} />
                <span aria-hidden="true">×</span>
                <Input aria-label={t('game.wizard.height')} placeholder={t('game.wizard.height')} inputMode="numeric" className={styles.input}
                  value={draft.customHeight} onChange={event => update({ customHeight: event.target.value.replace(/\D/g, '') })}
                  aria-invalid={resolutionInvalid || undefined} />
              </div>
            ) : null}
            <p className={styles.hint}>{t(threeDimensional ? 'game.wizard.resolutionHint3d' : 'game.wizard.resolutionHint')}</p>
          </fieldset>

          {!threeDimensional ? (
            <ChipGroup label={t('game.wizard.scaling')} values={scalings} selected={[draft.scaling]}
              labelFor={value => t(`game.wizard.scaling.${value}` as keyof Dict)} onToggle={value => update({ scaling: value })}
              hint={<p className={styles.hint}>{t(`game.wizard.scalingHint.${draft.scaling}` as keyof Dict)}</p>} />
          ) : null}
        </>
      )}

      <ChipGroup<GameControlScheme> label={t('game.wizard.controls')} multiple values={GAME_CONTROL_SCHEMES}
        selected={draft.controls} invalid={showProblems && !draft.controls.length}
        labelFor={value => t(`game.wizard.control.${value}` as keyof Dict)}
        onToggle={value => update({ controls: toggle(draft.controls, value) })}
        hint={<p className={styles.hint}>{t(beginner ? 'game.wizard.controlsHintBeginner' : 'game.wizard.controlsHint')}</p>} />
    </>
  );
  if (!lead) return technical;
  const summary = [!hideScreen && draftResolution(draft) && `${draftResolution(draft)!.width} × ${draftResolution(draft)!.height}`,
    draft.controls.map(value => t(`game.wizard.control.${value}` as keyof Dict)).join(t('game.wizard.listSeparator'))].filter(Boolean).join(' · ');
  return (
    <>
      {lead}
      <MoreSettings label={summary ? `${t('game.wizard.more')} · ${summary}` : t('game.wizard.more')}
        reveal={showProblems && (!draftResolution(draft) || !draft.controls.length)} testId="setup-more">
        {technical}
      </MoreSettings>
    </>
  );
}

export function NotesField({ draft, update }: { draft: WizardDraft; update: Update }) {
  const t = useT();
  const id = useId();
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id + '-notes'}><Label optional>{t('game.wizard.notes')}</Label></label>
      <Textarea id={id + '-notes'} className={styles.textarea} rows={2} value={draft.notes} maxLength={GAME_SETUP_LIMITS.notes}
        placeholder={t('game.wizard.notesPlaceholder')} onChange={event => update({ notes: event.target.value })} />
    </div>
  );
}

// ---------- review ----------

export interface SummaryContext {
  templateName?: string | undefined;
  styleTitle?: string | undefined;
  referenceCount: number;
}

function genreLabel(t: ReturnType<typeof useT>, draft: WizardDraft): string {
  if (draft.genre === 'custom') return draft.genreCustom.trim();
  return draft.genre ? t(`game.wizard.genre.${draft.genre}` as keyof Dict) : '';
}

/** What the agent will be told, one short line per screen, each with a way back to change it. */
export function ReviewSummary({ draft, context, onEdit, steps, beginner = false }: {
  draft: WizardDraft; context: SummaryContext; onEdit: (step: WizardStepId) => void; steps: readonly WizardStepId[];
  /** A first-timer never saw the screen size, so the summary does not name it. */
  beginner?: boolean;
}) {
  const t = useT();
  const resolution = draftResolution(draft);
  const join = (parts: Array<string | false | undefined | null>) => parts.filter(Boolean).join(' · ');
  const players = draft.players.map(value => t(`game.wizard.player.${value}` as keyof Dict)).join(t('game.wizard.listSeparator'));
  const rows: Array<{ step: WizardStepId; label: string; value: string }> = [
    { step: 'size', label: t('game.wizard.summarySize'), value: draft.scope
      ? join([`${t(`game.wizard.scope.${draft.scope}` as keyof Dict)} (${t(`game.wizard.scopeTime.${draft.scope}` as keyof Dict)})`,
        draft.scope === 'long' && draft.steamLater && t('game.wizard.summarySteamLater')]) : '—' },
    { step: 'concept', label: t('game.wizard.summaryGame'), value: join([draft.title.trim(), genreLabel(t, draft), players]) || '—' },
    { step: 'view', label: t('game.wizard.perspective'), value: draft.perspective ? t(`game.wizard.perspective.${draft.perspective}` as keyof Dict) : '—' },
    { step: 'art', label: t('game.wizard.style'), value: join([draft.styleId === 'custom' ? t('game.wizard.styleCustom') : context.styleTitle ?? draft.styleId,
      context.referenceCount > 0 && t('game.wizard.summaryReferences', { count: String(context.referenceCount) })]) || '—' },
    { step: 'setup', label: t(context.templateName ? 'game.wizard.summaryStarter' : 'game.wizard.resolution'),
      value: join([context.templateName, !beginner && resolution && `${resolution.width} × ${resolution.height}`]) || '—' },
  ];
  return (
    <dl className={styles.summary}>
      {rows.filter(row => steps.includes(row.step)).map((row, index) => (
        <div key={row.step} className={styles.summaryRow} style={stagger(index)}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
          <Button size="sm" variant="ghost" className={styles.summaryEdit} onClick={() => onEdit(row.step)}
            aria-label={`${t('game.wizard.edit')} ${row.label}`}>{t('game.wizard.edit')}</Button>
        </div>
      ))}
    </dl>
  );
}
