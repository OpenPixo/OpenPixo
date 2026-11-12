import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Button, ConfirmDialog, Input, VisuallyHidden } from '@openpixo/components';
import {
  GAME_SETUP_LIMITS,
  gameFolderNameProblem,
  type CheckGameTargetResponse,
  type GameEngineOption,
  type GameExperience,
  type GameFolderNameProblem,
  type GameLanguage,
  type GameTemplateSummary,
} from '@openpixo/contracts';
import { Check } from 'lucide-react';
import { isOpenPixoHostAvailable, pickHostWorkingDir, authorizeHostGameParent, type OpenPixoHostProjectImportSuccess } from '@openpixo/host';

import { useI18n } from '../i18n';
import type { Dict } from '../i18n/types';
import {
  checkGameTarget,
  fetchGameTemplates,
  GameTemplateRequestError,
} from '../state/game-templates';
import { fetchProjectLocations } from '../state/project-locations';
import { pickLocalFolderPath } from '../state/projects';
import { openExternalUrl } from '../providers/registry';
import {
  isAbsoluteFolderPath,
  pickerTokenExpiry,
  previewGameTarget,
  splitTarget,
  splitTemplateName,
} from './new-game-target';
import styles from './NewGameDialog.module.css';
import { createGameFromTemplate } from './NewGameDialog.api';
import { gameCreationErrorKey, rememberedGameParent, rememberGameParent } from './NewGameDialog.errors';
import { GameSetupWizard } from './new-game/GameSetupWizard';
import { ToggleRow } from './new-game/WizardSteps';
import { saveGameSetup, uploadReferences } from './new-game/game-setup-api';
import { fetchGameExperience, saveGameExperience } from './new-game/experience';
import {
  SAMPLE_TEMPLATE_ID,
  clearDraft,
  draftReferences,
  draftToSetup,
  emptyDraft,
  engineInstallHelp,
  folderNameFromTitle,
  gameFolderName,
  hasDesktopStore,
  isBeginner,
  kickoffPrompt,
  loadDraft,
  recommendedStarter,
  referencesFromFiles,
  rememberScope,
  rememberStudio,
  rememberedScope,
  rememberedStudio,
  runnableAlternative,
  saveDraft,
  setDraftReferences,
  starterEngineMissing,
  startersFor,
  templateDimension,
  templateDraftDefaults,
  wizardSteps,
  type WizardDraft,
  type WizardReference,
  type WizardStepId,
} from './new-game/wizard-state';

interface Props {
  onClose: () => void;
  onCreated: (response: OpenPixoHostProjectImportSuccess) => Promise<void> | void;
  initialTemplateId?: string;
  initialError?: unknown;
  /** The idea typed on Home: it seeds the pitch and goes to the agent as the first message. */
  initialPrompt?: string;
  /** Images attached on Home, kept as the game's references. */
  initialFiles?: readonly File[];
  /** Open an existing engine project instead of starting a new one. */
  onOpenFolder?: () => void;
  /** Settings → Game engines, where an installed engine's location is set. The draft survives the dialog closing. */
  onOpenEngineSettings?: () => void;
}

const DESCRIPTIONS: Record<string, keyof Dict> = {
  'phaser3-sample-platformer': 'game.template.phaser3-sample-platformer',
  'phaser3-vite': 'game.template.phaser3-vite',
  'threejs-vite': 'game.template.threejs-vite',
  'godot4-2d': 'game.template.godot4-2d',
  'godot4-3d': 'game.template.godot4-3d',
};

/** What each engine a first-timer is offered is, in a few plain words. */
const BEGINNER_ENGINE_ABOUT: Readonly<Record<string, keyof Dict>> = {
  phaser: 'game.wizard.engineAbout.phaser',
  godot: 'game.wizard.engineAbout.godot',
};

const NAME_PROBLEMS: Record<GameFolderNameProblem, keyof Dict> = {
  empty: 'game.dialog.nameEmpty',
  whitespace: 'game.dialog.nameWhitespace',
  dots: 'game.dialog.nameDots',
  characters: 'game.dialog.nameCharacters',
  trailing: 'game.dialog.nameTrailing',
  reserved: 'game.dialog.nameReserved',
};

const CHECK_DEBOUNCE_MS = 250;

/** A parent confirmed in the desktop host's picker: the token is bound to exactly `path`. */
interface PickedParent {
  path: string;
  token: string;
  expiresAt: number | null;
}

type CheckState =
  | { key: string; phase: 'checking' }
  | { key: string; phase: 'done'; result: CheckGameTargetResponse };

/** Session keys ProjectView reads to send the project's first message on open. */
function queueKickoff(projectId: string, prompt: string) {
  try {
    window.sessionStorage.setItem(`pixo:auto-send-first:${projectId}`, '1');
    window.sessionStorage.setItem(`pixo:auto-send-prompt:${projectId}`, prompt);
  } catch { /* Without sessionStorage the project opens and the user starts the first turn. */ }
}

/** A new draft: the user's languages (the UI's plus English), studio and last game size are already known. */
function freshDraft(templateId: string, languages: GameLanguage[]): WizardDraft {
  return { ...emptyDraft(templateId), languages, studio: rememberedStudio(), scope: rememberedScope(), ...templateDraftDefaults(templateId) };
}

/** `step` null: the first screen, whichever that turns out to be once the experience answer is known. */
function initialDraft(initialTemplateId: string, languages: GameLanguage[], initialPrompt: string): { draft: WizardDraft; step: WizardStepId | null } {
  const pitch = initialPrompt.trim().slice(0, GAME_SETUP_LIMITS.pitch);
  const stored = loadDraft();
  if (!stored) return { draft: { ...freshDraft(initialTemplateId, languages), ...(pitch ? { pitch } : {}) }, step: null };
  // Starting from Home wins over what was remembered; the other answers are kept.
  if (pitch) return { draft: { ...stored.draft, pitch, ...(initialTemplateId ? { templateId: initialTemplateId } : {}) }, step: null };
  if (initialTemplateId && stored.draft.templateId !== initialTemplateId) {
    return { draft: { ...stored.draft, templateId: initialTemplateId }, step: null };
  }
  return stored;
}

export function NewGameDialog({ onClose, onCreated, initialTemplateId = '', initialError, initialPrompt = '', initialFiles, onOpenFolder, onOpenEngineSettings }: Props) {
  const { t, locale } = useI18n();
  const id = useId();
  const hostMode = useMemo(() => isOpenPixoHostAvailable(), []);
  const defaultLanguages: GameLanguage[] = locale === 'zh-CN' ? ['zh-Hans', 'en'] : ['en'];
  const firstMessage = initialPrompt.trim();

  const [{ draft: startDraft, step: startStep }] = useState(() => initialDraft(initialTemplateId, defaultLanguages, initialPrompt));
  const [draft, setDraftState] = useState<WizardDraft>(startDraft);
  const [storedStep, setStep] = useState<WizardStepId | null>(startStep);
  // The saved answer to "have you made a game before?": undefined while it loads, null when never given.
  const [savedExperience, setSavedExperience] = useState<GameExperience | null | undefined>(undefined);
  const [experienceChoice, setExperienceChoice] = useState<GameExperience | null>(null);
  // Decided once, when the answer loads, so the screen does not vanish after it is answered.
  const [askExperience, setAskExperience] = useState(false);
  const [confirmingStartOver, setConfirmingStartOver] = useState(false);
  const [restored] = useState(() => loadDraft() !== null);
  const [references, setReferencesState] = useState<WizardReference[]>(() => {
    if (!initialFiles?.length) return draftReferences();
    const fromHome = referencesFromFiles(initialFiles);
    setDraftReferences(fromHome);
    return fromHome;
  });
  const [templates, setTemplates] = useState<GameTemplateSummary[]>([]);
  const [engines, setEngines] = useState<GameEngineOption[] | undefined>(undefined);
  const [recheck, setRecheck] = useState<'idle' | 'checking' | 'still-missing'>('idle');
  const [loading, setLoading] = useState(true);
  const [parentPath, setParentPath] = useState(rememberedGameParent);
  const [createParent, setCreateParent] = useState(false);
  const [parentSuggested, setParentSuggested] = useState(false);
  const [picked, setPicked] = useState<PickedParent | null>(null);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [picking, setPicking] = useState(false);
  const [authorizingParent, setAuthorizingParent] = useState(false);
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [check, setCheck] = useState<CheckState | null>(null);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(() => initialError ? localizedError(initialError, 'game.createFailed') : null);

  const nameRef = useRef<HTMLInputElement>(null);
  const parentRef = useRef<HTMLInputElement>(null);
  const browseRef = useRef<HTMLButtonElement>(null);
  const stopRef = useRef<HTMLButtonElement>(null);
  const radioRefs = useRef(new Map<string, HTMLButtonElement>());
  const pickSeq = useRef(0);
  const parentAuthSeq = useRef(0);
  const userEditedParent = useRef(Boolean(parentPath));
  const defaultParent = useRef('');
  /** The default folder the desktop host was already asked to vouch for, so a refusal is asked once. */
  const hostVouchedDefault = useRef<string | null>(null);

  const templateId = draft.templateId;
  const name = draft.name;
  // The folder follows the title until the user names it themselves.
  const trimmedName = gameFolderName(draft);
  const trimmedParent = parentPath.trim();
  const nameProblem = gameFolderNameProblem(trimmedName);
  const parentAbsolute = isAbsoluteFolderPath(trimmedParent);
  // The picker token only vouches for the exact path it was minted for.
  const token = picked && picked.path === trimmedParent && !tokenExpired ? picked.token : undefined;
  const checkKey = `${trimmedParent}\n${trimmedName}\n${token ?? ''}${createParent ? '\ncreate-parent' : ''}`;

  // The finished sample needs no gating, so it never asks.
  useEffect(() => {
    const controller = new AbortController();
    void fetchGameExperience(controller.signal).then(saved => {
      if (controller.signal.aborted) return;
      setSavedExperience(saved);
      setAskExperience(saved === null && initialTemplateId !== SAMPLE_TEMPLATE_ID);
    });
    return () => controller.abort();
  }, [initialTemplateId]);
  const experience = experienceChoice ?? savedExperience ?? null;
  const beginner = isBeginner({ mode: 'create', experience });
  const steps = useMemo(() => wizardSteps('create', askExperience), [askExperience]);
  const step: WizardStepId = storedStep && steps.includes(storedStep) ? storedStep : steps[0]!;

  // Every answer is saved as it changes, so closing the dialog keeps the draft.
  const setDraft = useCallback((next: WizardDraft) => setDraftState(next), []);
  useEffect(() => { if (!closing) saveDraft(draft, step); }, [closing, draft, step]);

  /** Leaving the experience screen remembers the answer for every later game. */
  function changeStep(next: WizardStepId) {
    if (step === 'experience' && experienceChoice && experienceChoice !== savedExperience) {
      setSavedExperience(experienceChoice);
      void saveGameExperience(experienceChoice);
    }
    setStep(next);
  }
  const setReferences = useCallback((next: WizardReference[]) => { setDraftReferences(next); setReferencesState(next); }, []);

  function localizedError(caught: unknown, fallback: keyof Dict) {
    const code = caught instanceof GameTemplateRequestError ? caught.code : undefined;
    const key = gameCreationErrorKey(code);
    return { message: t(key ?? fallback), ...(!key || code === 'CREATE_FAILED' || code === 'PARENT_UNREADABLE'
      ? { detail: caught instanceof Error ? caught.message : String(caught) } : {}) };
  }

  function changeParent(value: string) {
    parentAuthSeq.current++; setAuthorizingParent(false);
    userEditedParent.current = true;
    setParentPath(value); setParentSuggested(false); setCreateParent(false);
    if (isAbsoluteFolderPath(value.trim())) rememberGameParent(value.trim());
  }

  const requestClose = useCallback(() => setClosing(true), []);

  // Templates.
  useEffect(() => {
    const controller = new AbortController();
    void fetchGameTemplates(controller.signal).then(({ templates: items, engines: machine, defaultParentDir }) => {
      defaultParent.current = defaultParentDir ?? '';
      setTemplates(items);
      setEngines(machine);
      // The starter is chosen on the engine step, once the answers can suggest one.
      setDraftState(current => !current.templateId || items.some(item => item.id === current.templateId)
        ? current : { ...current, templateId: '' });
      if (defaultParentDir && !userEditedParent.current) setParentPath(defaultParentDir);
    }).catch(err => {
      if (!controller.signal.aborted) setError(localizedError(err, 'game.loadFailed'));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [t]);

  // Default parent. Only an explicit daemon answer is used — the user's own
  // configured project locations — and only where a typed path can be
  // authorized at all (the desktop host requires its picker instead).
  useEffect(() => {
    if (hostMode) return;
    let alive = true;
    void fetchProjectLocations().then(locations => {
      const external = locations.find(location => !location.builtIn && location.path.trim());
      if (!alive || !external || userEditedParent.current) return;
      setParentPath(current => current || external.path);
      setParentSuggested(true);
    });
    return () => { alive = false; };
  }, [hostMode]);

  // A picker confirmation lapses after its token's expiry. The host's own vouching for
  // its default folder was never the user's confirmation, so when that one lapses the
  // next check vouches again instead of asking the user to Browse for a folder they
  // never chose: the token lasts a minute and the setup takes longer.
  useEffect(() => {
    setTokenExpired(false);
    if (!picked?.expiresAt) return;
    const lapse = () => {
      if (hostVouchedDefault.current === picked.path) hostVouchedDefault.current = null;
      setTokenExpired(true);
    };
    const remaining = picked.expiresAt - Date.now();
    if (remaining <= 0) { lapse(); return; }
    const timer = window.setTimeout(lapse, remaining);
    return () => window.clearTimeout(timer);
  }, [picked]);

  // Debounced preflight: exists / not found / refused / needs the picker.
  useEffect(() => {
    if (nameProblem || !parentAbsolute || picking) { setCheck(null); return; }
    const controller = new AbortController();
    setCheck({ key: checkKey, phase: 'checking' });
    const timer = window.setTimeout(() => {
      void checkGameTarget({ parentDir: trimmedParent, name: trimmedName, ...(createParent ? { createParent: true } : {}) }, token, controller.signal)
        .then(result => {
          if (controller.signal.aborted) return;
          const untouchedDefault = !userEditedParent.current && trimmedParent === defaultParent.current;
          if (result.status === 'picker-required' && hostMode && !token && untouchedDefault
            && hostVouchedDefault.current !== trimmedParent) {
            hostVouchedDefault.current = trimmedParent;
            void vouchForDefaultParent(trimmedParent, () => setCheck({ key: checkKey, phase: 'done', result }));
            return;
          }
          if (result.status === 'invalid-parent' && result.reasonCode === 'PARENT_NOT_FOUND'
            && !createParent && untouchedDefault) {
            void changeCreateParent(true);
            return;
          }
          setCheck({ key: checkKey, phase: 'done', result });
        })
        // An older daemon without the preflight, or a transient failure: create still validates.
        .catch(() => { if (!controller.signal.aborted) setCheck(null); });
    }, CHECK_DEBOUNCE_MS);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [checkKey, nameProblem, parentAbsolute, picking, token, trimmedName, trimmedParent, createParent]);

  // Keep focus inside the dialog while the waiting row replaces nothing but adds a stop button.
  useEffect(() => {
    if (picking) stopRef.current?.focus();
  }, [picking]);

  const result = check?.key === checkKey && check.phase === 'done' ? check.result : null;
  const checking = check?.key === checkKey && check.phase === 'checking';

  const showNameProblem = nameProblem && (nameTouched || submitted || nameProblem !== 'empty');
  const nameMessage = showNameProblem
    ? t(NAME_PROBLEMS[nameProblem], { name: trimmedName })
    : result?.status === 'exists' ? t('game.dialog.nameExists')
      : result?.status === 'invalid-name' && result.nameProblem ? t(NAME_PROBLEMS[result.nameProblem], { name: trimmedName })
        : null;

  const locationMessage = (() => {
    if (!trimmedParent) return submitted ? t('game.dialog.locationHint') : null;
    if (!parentAbsolute) return t('game.dialog.locationRelative');
    if (!result) return null;
    if (result.status === 'invalid-parent') return t(gameCreationErrorKey(result.reasonCode) ?? 'game.dialog.parentUnreadable');
    if (result.status === 'rejected') return t('game.dialog.targetRejected');
    if (result.status === 'picker-required') {
      return picked?.path === trimmedParent && tokenExpired ? t('game.dialog.locationExpired') : t('game.dialog.locationPicker');
    }
    return null;
  })();
  const locationInvalid = Boolean(locationMessage) && Boolean(trimmedParent || submitted);
  const locationDetail = result?.message && ['invalid-parent', 'rejected'].includes(result.status)
    && (!gameCreationErrorKey(result.reasonCode) || result.reasonCode === 'PARENT_UNREADABLE') ? result.message : null;

  const blocked = Boolean(nameProblem) || !parentAbsolute || Boolean(nameMessage) || Boolean(locationMessage);
  const busy = creating || closing || authorizingParent;

  const preview = result?.target
    ? splitTarget(result.target)
    : parentAbsolute ? previewGameTarget(trimmedParent, trimmedName) : null;

  const selectedTemplate = templates.find(template => template.id === templateId);
  const templateLabel = (template: GameTemplateSummary) => locale === 'zh-CN' ? template.nameZhCN || template.name : template.name;
  const starters = startersFor(draft, templates, beginner);
  const recommended = recommendedStarter(draft, templates, engines, beginner);
  // A starter stays chosen while it still fits; changing the perspective (or being a first-timer) can rule it out.
  const suggestTemplate = useCallback((current: WizardDraft) => {
    const valid = startersFor(current, templates, beginner).some(template => template.id === current.templateId);
    return valid ? current.templateId : recommendedStarter(current, templates, engines, beginner);
  }, [beginner, engines, templates]);
  // A starter whose engine this computer lacks cannot be created until it is installed or switched.
  const missingEngine = starterEngineMissing(templateId, templates, engines);
  const alternative = missingEngine ? runnableAlternative(draft, templates, engines, beginner) : null;

  /** Ask the daemon again what this computer can run, after the user installed or located an engine. */
  async function recheckEngines() {
    const engine = missingEngine?.engine;
    setRecheck('checking');
    try {
      const { engines: machine } = await fetchGameTemplates();
      setEngines(machine);
      setRecheck(machine?.find(item => item.engine === engine)?.available === false ? 'still-missing' : 'idle');
    } catch {
      setRecheck('still-missing');
    }
  }

  /**
   * The folder OpenPixo suggested itself, untouched by the user, needs no picker in the
   * desktop app: the host vouches for its default games folder, as the quick sample does.
   * The daemon answers `picker-required` before it says whether a folder exists, so
   * without this the preflight stopped there and a first-time user met a red
   * 「请点击“浏览…”」 on the last setup screen (2026-11-10 beginner audit). Once
   * vouched for, the next check sees a missing folder and ticks 「创建这个文件夹」.
   */
  async function vouchForDefaultParent(parent: string, refused: () => void) {
    const sequence = ++parentAuthSeq.current;
    try {
      const approved = await authorizeHostGameParent(parent);
      if (sequence !== parentAuthSeq.current) return;
      if (!approved.ok) { refused(); return; }
      defaultParent.current = approved.baseDir;
      hostVouchedDefault.current = approved.baseDir;
      setParentPath(approved.baseDir);
      setPicked({ path: approved.baseDir, token: approved.token, expiresAt: pickerTokenExpiry(approved.token) });
    } catch {
      if (sequence === parentAuthSeq.current) refused();
    }
  }

  async function changeCreateParent(checked: boolean) {
    const sequence = ++parentAuthSeq.current;
    setCreateParent(checked);
    if (!checked || !hostMode || token) return;
    setAuthorizingParent(true); setError(null);
    try {
      const approved = await authorizeHostGameParent(trimmedParent);
      if (sequence !== parentAuthSeq.current) return;
      if (!approved.ok) throw new Error('reason' in approved ? approved.reason : 'Game parent authorization failed');
      setParentPath(approved.baseDir);
      setPicked({ path: approved.baseDir, token: approved.token, expiresAt: pickerTokenExpiry(approved.token) });
    } catch (cause) {
      if (sequence === parentAuthSeq.current) setError(localizedError(cause, 'game.dialog.targetRejected'));
    } finally { if (sequence === parentAuthSeq.current) setAuthorizingParent(false); }
  }

  async function browse() {
    const seq = ++pickSeq.current;
    setPicking(true);
    setError(null);
    try {
      if (hostMode) {
        const chosen = await pickHostWorkingDir();
        if (seq !== pickSeq.current) return;
        if (!chosen.ok) {
          if ('canceled' in chosen && chosen.canceled) return;
          throw new Error('reason' in chosen ? chosen.reason : t('game.pickFailed'));
        }
        changeParent(chosen.baseDir);
        setPicked({ path: chosen.baseDir, token: chosen.token, expiresAt: pickerTokenExpiry(chosen.token) });
      } else {
        const chosen = await pickLocalFolderPath();
        if (seq !== pickSeq.current || !chosen) return;
        changeParent(chosen);
        setPicked(null);
      }
    } catch (err) {
      if (seq === pickSeq.current) setError(localizedError(err, 'game.pickFailed'));
    } finally {
      if (seq === pickSeq.current) {
        setPicking(false);
        window.setTimeout(() => browseRef.current?.focus(), 0);
      }
    }
  }

  /** The daemon's picker request cannot be withdrawn; its late answer is ignored. */
  function stopWaiting() {
    pickSeq.current += 1;
    setPicking(false);
    window.setTimeout(() => browseRef.current?.focus(), 0);
  }

  function focusBlockedField() {
    setSubmitted(true);
    if (nameProblem || nameMessage) nameRef.current?.focus();
    else if (locationMessage && result?.status === 'picker-required') browseRef.current?.focus();
    else if (!trimmedParent || !parentAbsolute || locationMessage) parentRef.current?.focus();
  }

  async function create() {
    setSubmitted(true);
    if (!templateId || picking || busy || missingEngine) return;
    if (blocked) { focusBlockedField(); return; }
    setCreating(true);
    setError(null);
    try {
      const setup = draftToSetup(draft);
      const created = await createGameFromTemplate({ templateId, parentDir: trimmedParent, name: trimmedName,
        ...(createParent ? { createParent: true } : {}), setup }, token);
      const projectId = created.project.id;
      // Reference images can only be written once the project folder exists.
      if (references.length) {
        const uploaded = await uploadReferences(projectId, references);
        if (uploaded.paths.length) await saveGameSetup(projectId, draftToSetup(draft, uploaded.paths)).catch(() => {});
      }
      // What the user typed on Home is the first message, word for word.
      if (firstMessage) queueKickoff(projectId, firstMessage);
      else if (draft.kickoff) queueKickoff(projectId, kickoffPrompt(t, draft));
      rememberStudio(draft.studio);
      rememberScope(draft.scope);
      clearDraft();
      await onCreated({ ok: true, projectId, conversationId: created.conversationId, entryFile: created.entryFile });
      requestClose();
    } catch (err) {
      // A token is single-use: once the daemon has seen it, it cannot vouch again.
      if (token) setPicked(null);
      if (err instanceof GameTemplateRequestError && (err.code === 'TARGET_EXISTS' || /already exists/i.test(err.message))) {
        setCheck({ key: `${trimmedParent}\n${trimmedName}\n${createParent ? '\ncreate-parent' : ''}`, phase: 'done', result: { status: 'exists' } });
        nameRef.current?.focus();
      } else {
        setError(localizedError(err, 'game.createFailed'));
      }
    } finally {
      setCreating(false);
    }
  }

  function startOver() {
    clearDraft();
    setReferencesState([]);
    setDraftState(freshDraft('', defaultLanguages));
    setStep(null);
  }

  function selectTemplate(next: string, focus: boolean) {
    setRecheck('idle');
    setDraftState(current => ({ ...current, templateId: next }));
    if (focus) radioRefs.current.get(next)?.focus();
  }

  function onTemplateKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!starters.length) return;
    const index = Math.max(0, starters.findIndex(template => template.id === templateId));
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % starters.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + starters.length) % starters.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = starters.length - 1;
    if (next == null) return;
    event.preventDefault();
    selectTemplate(starters[next]!.id, true);
  }

  /**
   * What choosing this engine means, in one plain line: a web engine runs here at
   * once and shares as a link; Godot is downloaded first and makes games that
   * install on a computer. A game meant for Steam hears what that takes instead,
   * except a first-timer, who is never told about Steam builds.
   */
  function engineMeans(template: GameTemplateSummary): string | null {
    if (template.id === SAMPLE_TEMPLATE_ID) return null;
    const native = template.engine === 'godot';
    if (!beginner && (hasDesktopStore(draft) || (draft.scope === 'long' && draft.steamLater))) return t(native ? 'game.wizard.engineDesktop.native' : 'game.wizard.engineDesktop.web');
    return t(native ? 'game.wizard.engineMeans.godot' : 'game.wizard.engineMeans.web');
  }

  /** A first-timer reads what the engine is, not the starter's file list (GDScript, string tables, Vite). */
  function engineDescription(template: GameTemplateSummary): string {
    if (beginner && template.id !== SAMPLE_TEMPLATE_ID && BEGINNER_ENGINE_ABOUT[template.engine]) return t(BEGINNER_ENGINE_ABOUT[template.engine]!);
    return (locale === 'zh-CN' ? template.descriptionZhCN : undefined) ||
      (DESCRIPTIONS[template.id] ? t(DESCRIPTIONS[template.id]!) : template.description);
  }

  /** Said where the engine is chosen: what is missing, how to get it, and a starter that runs here instead. */
  function engineMissingPanel(machine: GameEngineOption) {
    const install = engineInstallHelp(machine);
    const downloadName = install.tool === 'npm' ? 'Node.js' : machine.name;
    const alternativeName = alternative ? splitTemplateName(templateLabel(alternative)).engine : '';
    const tip = install.tool === 'godot' ? t('game.wizard.engineMissingGodotTip') : install.tool === 'npm' ? t('game.wizard.engineMissingNodeTip') : '';
    return (
      <div className={styles.engineMissing} data-testid="engine-missing">
        <p className={styles.engineMissingTitle}>{t('game.wizard.engineMissingTitle', { tool: machine.name })}</p>
        <p className={styles.engineMissingBody}>{[t('game.wizard.engineMissingBody'), tip].filter(Boolean).join(' ')}</p>
        <p className={styles.messageError} role="status" aria-live="polite">
          {recheck === 'still-missing' ? t('game.wizard.engineStillMissing', { tool: machine.name }) : null}
        </p>
        <div className={styles.engineMissingActions}>
          {install.downloadUrl ? (
            <Button size="sm" variant="primary" onClick={() => void openExternalUrl(install.downloadUrl!)}>
              {t('game.wizard.engineDownload', { tool: downloadName })}
            </Button>
          ) : null}
          <Button size="sm" onClick={() => void recheckEngines()} disabled={recheck === 'checking'} aria-busy={recheck === 'checking'}>
            {t(recheck === 'checking' ? 'game.wizard.engineRechecking' : 'game.wizard.engineRecheck')}
          </Button>
          {install.configurable && onOpenEngineSettings ? (
            <Button size="sm" variant="ghost" onClick={() => { requestClose(); onOpenEngineSettings(); }}>{t('game.wizard.engineLocate')}</Button>
          ) : null}
          {alternative ? (
            <Button size="sm" variant="ghost" onClick={() => selectTemplate(alternative.id, false)}>
              {t('game.wizard.engineSwitch', { engine: alternativeName })}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const nameMessageId = `${id}-name-message`;
  const locationMessageId = `${id}-location-message`;
  const targetId = `${id}-target`;

  const templatePicker = (
    <fieldset className={styles.section} disabled={busy}>
      {/* The screen's question already asks for the engine; the legend only names the group. */}
      <legend id={id + '-engine'} className={styles.hiddenLegend}><VisuallyHidden>{t('game.dialog.engine')}</VisuallyHidden></legend>
      {loading ? (
        <div className={styles.grid} role="status" aria-label={t('game.loading')}>
          {[0, 1, 2, 3].map(index => <span key={index} className={styles.skeleton} />)}
        </div>
      ) : starters.length ? (
        <div className={styles.grid} role="radiogroup" aria-labelledby={id + '-engine'} onKeyDown={onTemplateKeyDown}>
          {starters.map((template, index) => {
            const selected = template.id === templateId;
            const sample = template.id === SAMPLE_TEMPLATE_ID;
            const label = templateLabel(template);
            const { engine } = splitTemplateName(label);
            const dimensionTag = templateDimension(template).toUpperCase();
            const description = engineDescription(template);
            const means = engineMeans(template);
            const machine = engines?.find(item => item.engine === template.engine);
            return (
              <button
                key={template.id}
                ref={node => { if (node) radioRefs.current.set(template.id, node); else radioRefs.current.delete(template.id); }}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={label}
                aria-describedby={`${id}-${template.id}-desc`}
                tabIndex={selected || (!starters.some(item => item.id === templateId) && index === 0) ? 0 : -1}
                disabled={busy}
                className={styles.card}
                style={{ ['--i' as string]: index } as CSSProperties}
                data-engine={template.engine}
                onClick={() => selectTemplate(template.id, false)}
              >
                <span className={styles.art} aria-hidden="true">
                  {sample ? <PlatformerGlyph /> : dimensionTag === '3D' ? <CubeGlyph /> : <SpriteGlyph />}
                </span>
                <span className={styles.cardText}>
                  <span className={styles.cardTitle}>
                    <span className={styles.engine}>{engine}</span>
                    {sample ? <span className={styles.tag}>{t('game.template.sampleTag')}</span> : <span className={styles.tag}>{dimensionTag}</span>}
                    {template.id === recommended ? <span className={styles.recommended}>{t('game.wizard.suggested')}</span> : null}
                  </span>
                  <span id={`${id}-${template.id}-desc`} className={styles.cardDescription}>{description}</span>
                  {means ? <span className={styles.cardMeans}>{means}</span> : null}
                  {machine ? (
                    <span className={machine.available ? styles.machineReady : styles.machineMissing}>
                      {machine.available
                        ? t('game.wizard.engineReady')
                        : t('game.wizard.engineMissing', { tool: machine.name })}
                    </span>
                  ) : null}
                </span>
                <span className={styles.tick} aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
              </button>
            );
          })}
        </div>
      ) : !error ? (
        <p className={styles.empty} role="status">{t('game.noTemplates')}</p>
      ) : null}
      {missingEngine ? engineMissingPanel(missingEngine) : null}
      {onOpenFolder ? (
        <p className={styles.existing}>
          {t('game.wizard.existingProject')}
          <Button size="sm" variant="ghost" onClick={() => { requestClose(); onOpenFolder(); }}>{t('game.wizard.existingProjectOpen')}</Button>
        </p>
      ) : null}
    </fieldset>
  );

  const nameAndLocation = (
    <>
      <div className={styles.section}>
        <label className={styles.label} htmlFor={id + '-name'}>{t('game.dialog.name')}</label>
        <Input
          ref={nameRef}
          id={id + '-name'}
          className={styles.input}
          value={name}
          placeholder={folderNameFromTitle(draft.title)}
          onChange={event => setDraftState(current => ({ ...current, name: event.target.value }))}
          onBlur={() => setNameTouched(true)}
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={nameMessage ? true : undefined}
          aria-describedby={nameMessageId}
        />
        <p id={nameMessageId} className={nameMessage ? styles.messageError : styles.message} aria-live="polite">
          {nameMessage ?? t('game.dialog.nameHint')}
        </p>
      </div>

      <div className={styles.section}>
        <label className={styles.label} htmlFor={id + '-parent'}>{t('game.dialog.location')}</label>
        <div className={styles.locationRow}>
          <Input
            ref={parentRef}
            id={id + '-parent'}
            className={[styles.input, styles.pathInput].join(' ')}
            value={parentPath}
            placeholder={t('game.dialog.locationPlaceholder')}
            onChange={event => changeParent(event.target.value)}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={locationInvalid ? true : undefined}
            aria-describedby={`${locationMessageId} ${targetId}`}
          />
          <Button
            ref={browseRef}
            className={styles.browse}
            onClick={() => void browse()}
            disabled={busy || picking}
            aria-busy={picking}
          >
            <FolderGlyph />
            {t('game.dialog.browse')}
          </Button>
        </div>
        {picking ? (
          <div className={styles.waiting} role="status">
            <span className={styles.spinner} aria-hidden="true" />
            <span className={styles.waitingText}>
              <strong>{t('game.dialog.pickerWaiting')}</strong>
              <span>{t('game.dialog.pickerWaitingHint')}</span>
            </span>
            <Button ref={stopRef} size="sm" variant="ghost" onClick={stopWaiting}>{t('game.dialog.pickerStop')}</Button>
          </div>
        ) : (
          <p id={locationMessageId} className={locationInvalid ? styles.messageError : styles.message} aria-live="polite">
            {locationMessage ?? (parentSuggested ? t('game.dialog.locationSuggested') : t('game.dialog.locationHint'))}
          </p>
        )}

        {locationDetail ? <details className={styles.details}><summary>{t('game.errorDetails')}</summary><pre>{locationDetail}</pre></details> : null}
        {hostMode || result?.reasonCode === 'PARENT_NOT_FOUND' || createParent ? <label className={styles.createParent} htmlFor={id + '-create-parent'}>
          <Input id={id + '-create-parent'} type="checkbox" checked={createParent} disabled={busy} onChange={event => void changeCreateParent(event.target.checked)} />
          {t('game.dialog.createParent')}
        </label> : null}

        <div id={targetId} className={styles.target} data-state={result?.status ?? (checking ? 'checking' : 'idle')}>
          <span className={styles.targetLabel}>{t('game.dialog.target')}</span>
          {preview ? (
            <span className={styles.targetPath} data-testid="new-game-target">
              <span className={styles.targetParent}>{preview.parent}</span>
              <span className={styles.targetName}>{preview.name || '…'}</span>
            </span>
          ) : (
            <span className={styles.targetPending}>{t('game.dialog.targetPending')}</span>
          )}
          {checking ? (
            <span className={styles.targetStatus} role="status">
              <span className={styles.spinner} aria-hidden="true" />{t('game.dialog.checking')}
            </span>
          ) : result?.status === 'available' ? (
            <span className={[styles.targetStatus, styles.targetReady].join(' ')} role="status">
              <span className={styles.readyTick} aria-hidden="true" />{t('game.dialog.available')}
            </span>
          ) : null}
        </div>
      </div>
    </>
  );

  // A message typed on Home is already the first turn, so there is nothing to choose.
  const startsPlanning = Boolean(firstMessage) || draft.kickoff;
  const kickoffToggle = firstMessage
    ? <p className={styles.message}>{t('game.wizard.firstMessage')}</p>
    : (
      <ToggleRow tone="brand" checked={draft.kickoff} disabled={busy} title={t('game.wizard.kickoff')} hint={t('game.wizard.kickoffHint')}
        onChange={kickoff => setDraftState(current => ({ ...current, kickoff }))} />
    );

  // What creating does next, said before the user commits: where, which engine, and then
  // the planning steps in order: talk through the gameplay, pick from style samples,
  // approve a short plan, and build one part at a time with a try after each.
  const sampleChosen = templateId === SAMPLE_TEMPLATE_ID;
  const targetPath = preview && preview.name ? `${preview.parent}${preview.name}` : '';
  const whatHappensNext = (
    <section className={styles.nextSteps} aria-label={t('game.wizard.nextTitle')} data-testid="what-happens-next">
      <h3 className={styles.label}>{t('game.wizard.nextTitle')}</h3>
      <ul className={styles.nextList}>
        <li>{t('game.wizard.nextFolder', { path: targetPath || t('game.dialog.targetPending') })}</li>
        {selectedTemplate ? (
          <li>
            {t('game.wizard.nextEngine', { engine: templateLabel(selectedTemplate) })}
            {missingEngine ? <span className={styles.machineMissing}> {t('game.wizard.nextEngineMissing', { tool: missingEngine.name })}</span> : null}
          </li>
        ) : null}
        {sampleChosen ? <li>{t('game.wizard.nextSample')}</li> : null}
      </ul>
      {sampleChosen ? null : (
        <ol className={styles.nextList} data-testid="what-happens-next-flow">
          <li>{t(draft.scope === 'quick'
            ? (startsPlanning ? 'game.wizard.nextPlanQuick' : 'game.wizard.nextPlanQuickLater')
            : (startsPlanning ? 'game.wizard.nextPlan' : 'game.wizard.nextPlanLater'))}</li>
          <li>{t('game.wizard.nextSamples')}</li>
          <li>{t('game.wizard.nextApprove')}</li>
          <li>{t('game.wizard.nextBuild')}</li>
        </ol>
      )}
    </section>
  );

  const errorBlock = error ? <div><p className={styles.alert} role="alert">{error.message}</p>
    {error.detail ? <details className={styles.details}><summary>{t('game.errorDetails')}</summary><pre>{error.detail}</pre></details> : null}
  </div> : null;

  // The screens depend on whether the experience question is asked, so the dialog opens once that is known.
  if (savedExperience === undefined) return null;
  const firstStep = step === steps[0];

  return (
    <div onKeyDown={event => { if (event.key === 'Escape' && picking) { event.preventDefault(); stopWaiting(); } }}>
      <GameSetupWizard
        title={t('game.new')}
        context={{
          mode: 'create', locationReady: !blocked && Boolean(templateId), engineMissing: Boolean(missingEngine), experience,
          ...(beginner && !loading ? { allowedTemplateIds: starters.map(template => template.id) } : {}),
        }}
        steps={steps}
        draft={draft}
        onDraftChange={setDraft}
        step={step}
        onStepChange={changeStep}
        onExperienceChange={setExperienceChoice}
        references={references}
        onReferencesChange={setReferences}
        engineLead={templatePicker}
        suggestTemplate={suggestTemplate}
        reviewTail={nameAndLocation}
        reviewOptions={<>{kickoffToggle}{whatHappensNext}</>}
        summary={{ templateName: selectedTemplate ? templateLabel(selectedTemplate) : undefined }}
        finishLabel={t(startsPlanning ? 'game.wizard.createAndPlan' : 'game.create')}
        finishBusyLabel={t('game.creating')}
        busy={busy}
        locked={picking || loading}
        error={errorBlock}
        footerNote={restored && firstStep ? <p className={styles.message}>{t('game.wizard.draftRestored')}</p> : null}
        onFinish={() => void create()}
        onBlockedFinish={focusBlockedField}
        onStartOver={restored || !firstStep ? () => setConfirmingStartOver(true) : undefined}
        closing={closing}
        onRequestClose={requestClose}
        onClosed={onClose}
      />
      <ConfirmDialog
        open={confirmingStartOver}
        title={t('game.wizard.startOverTitle')}
        destructive
        confirmLabel={t('game.wizard.startOver')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setConfirmingStartOver(false)}
        onConfirm={() => { setConfirmingStartOver(false); startOver(); }}
      >
        <p>{t('game.wizard.startOverBody')}</p>
      </ConfirmDialog>
    </div>
  );
}

/** A little pixel sprite standing on the ground: 2D. */
function SpriteGlyph() {
  const pixels = [
    [2, 0], [3, 0], [4, 0],
    [1, 1], [2, 1], [3, 1], [4, 1], [5, 1],
    [1, 2], [3, 2], [5, 2],
    [1, 3], [2, 3], [3, 3], [4, 3], [5, 3],
    [2, 4], [4, 4],
    [1, 5], [5, 5],
  ];
  return (
    <svg width="28" height="28" viewBox="0 0 28 28">
      {pixels.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={5 + x! * 3} y={3 + y! * 3} width="3" height="3" fill="currentColor" />
      ))}
      <rect x="3" y="23" width="22" height="2" rx="1" fill="currentColor" opacity=".35" />
    </svg>
  );
}

/** Platforms, a coin, and a goal flag: a playable sample. */
function PlatformerGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 24h8m3-6h10M20 17V4l6 3-6 3" />
      <circle cx="10" cy="8" r="2.5" />
      <path d="M5 19v-5h4v5m-5 1h2m2 0h2" />
    </svg>
  );
}

/** A shaded isometric cube: 3D. */
function CubeGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" strokeLinejoin="round">
      <path d="M14 3.5 24 9v11l-10 5.5L4 20V9Z" fill="currentColor" opacity=".18" />
      <path d="M14 14.5 24 9v11l-10 5.5Z" fill="currentColor" opacity=".45" />
      <path d="M14 3.5 24 9l-10 5.5L4 9Z" fill="currentColor" opacity=".8" />
      <path d="M14 3.5 24 9v11l-10 5.5L4 20V9Zm0 11v11M4 9l10 5.5L24 9" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function FolderGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.75 4.25c0-.83.67-1.5 1.5-1.5h3l1.5 1.75h5c.83 0 1.5.67 1.5 1.5v6.25c0 .83-.67 1.5-1.5 1.5h-9.5c-.83 0-1.5-.67-1.5-1.5Z" />
    </svg>
  );
}
