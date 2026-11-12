import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChatSessionMode } from '@openpixo/contracts';
import { MAX_NEXT_STEP_SUGGESTIONS } from '@openpixo/contracts';
import { useI18n } from '../i18n';
import type { Dict } from '../i18n/types';
import { useAnalytics } from '../analytics/provider';
import { trackNextStepActionClick } from '../analytics/events';
import { Icon, type IconName } from './Icon';
import styles from './NextStepActions.module.css';

type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;
export type NextStepActionsVariant =
  | 'default'
  | 'project-incomplete'
  | 'plan';

export const PROJECT_CONTINUE_PROMPT =
  'Continue from the stopped or incomplete turn. Read the conversation, the current project files and any visible errors, then take the next concrete step and summarize what changed.';

export const PROJECT_INCOMPLETE_NEXT_STEP_ACTIONS = [
  {
    id: 'project-continue',
    icon: 'refresh' as IconName,
    titleKey: 'nextStep.projectContinueTitle' as keyof Dict,
    prompt: PROJECT_CONTINUE_PROMPT,
  },
] as const;

const PLAN_NEXT_STEP_ACTIONS = [
  {
    id: 'plan-generate-from-doc',
    icon: 'sparkles' as IconName,
    titleKey: 'nextStep.planGenerateTitle' as keyof Dict,
    descriptionKey: 'nextStep.planGenerateBody' as keyof Dict,
    promptKey: 'nextStep.planGeneratePrompt' as keyof Dict,
    sessionMode: 'design' as ChatSessionMode,
    requires: 'plan' as const,
  },
  {
    id: 'plan-improve-doc',
    icon: 'file' as IconName,
    titleKey: 'nextStep.planImproveTitle' as keyof Dict,
    descriptionKey: 'nextStep.planImproveBody' as keyof Dict,
    promptKey: 'nextStep.planImprovePrompt' as keyof Dict,
    sessionMode: 'plan' as ChatSessionMode,
    requires: 'plan' as const,
  },
  {
    id: 'plan-improve-artifact',
    icon: 'sparkles' as IconName,
    titleKey: 'nextStep.planImproveArtifactTitle' as keyof Dict,
    descriptionKey: 'nextStep.planImproveArtifactBody' as keyof Dict,
    promptKey: 'nextStep.planImproveArtifactPrompt' as keyof Dict,
    sessionMode: 'design' as ChatSessionMode,
    requires: 'artifact' as const,
  },
  {
    id: 'plan-merge-doc-artifact',
    icon: 'blocks' as IconName,
    titleKey: 'nextStep.planMergeTitle' as keyof Dict,
    descriptionKey: 'nextStep.planMergeBody' as keyof Dict,
    promptKey: 'nextStep.planMergePrompt' as keyof Dict,
    sessionMode: 'design' as ChatSessionMode,
    requires: 'both' as const,
  },
] as const;
const PLAN_GENERATE_ACTION = PLAN_NEXT_STEP_ACTIONS[0];
const PLAN_IMPROVE_DOC_ACTION = PLAN_NEXT_STEP_ACTIONS[1];
const PLAN_IMPROVE_ARTIFACT_ACTION = PLAN_NEXT_STEP_ACTIONS[2];
const PLAN_MERGE_DOC_ARTIFACT_ACTION = PLAN_NEXT_STEP_ACTIONS[3];

interface Props {
  // The previewable artifact this affordance is anchored to. Passed back to
  // share/download so the parent can act on the right file.
  fileName?: string | null;
  // Plan-mode actions need both sides of the handoff when available: the
  // editable Markdown plan and the generated artifact it should govern.
  planFileName?: string | null;
  artifactFileName?: string | null;
  // Download the previewable artifact.
  onDownload?: (fileName: string) => void;
  // Seed the composer with a plan handoff or incomplete-project recovery prompt.
  onPromptAction?: (
    prompt: string,
    options?: { sessionMode?: ChatSessionMode },
  ) => void;
  /**
   * This turn's follow-up suggestions, written by the agent about what it just
   * built and parsed out of its `<pixo-next key="…">` marker by the daemon.
   *
   * The `default` variant renders ONLY these — the fixed toolbox directory it
   * used to render is gone. AssistantMessage may supply the OPEND-2776 image
   * actions for a successful image delivery. An empty list means "render nothing":
   * there is deliberately no fallback to a catalogue, because a turn recorded
   * before this existed has no suggestions and a generic row under it would be
   * a worse answer than silence.
   */
  suggestions?: string[];
  /**
   * Seed the composer with one suggestion. The user may edit it and must send
   * explicitly; clicking a suggestion must never persist a message or create a
   * run by itself. The rows carry no trailing chevron because they do not open
   * another menu.
   */
  onSuggestion?: (text: string) => void;
  variant?: NextStepActionsVariant;
}

const FLYOUT_GAP = 8;
const VIEWPORT_MARGIN = 8;

const MENU_WIDTH = 200;
// Conservative heights used to keep a flyout on-screen vertically (over-estimating
// only shifts it further up, which is always safe).

const MENU_HEIGHT = 180;
// Give users enough time to cross the small gap between flyout levels without
// making dismissal feel sticky once the pointer leaves the whole affordance.
const FLYOUT_CLOSE_DELAY_MS = 240;

// Place a flyout next to an anchor rect: flip to the left when the right edge
// would overflow, and clamp vertically so a tall flyout under a row near the
// bottom of the viewport keeps its bottom edge on-screen. Returns viewport-fixed
// coordinates.
function place(
  anchor: DOMRect,
  width: number,
  height: number,
): { left: number; top: number } {
  const toRight = anchor.right + FLYOUT_GAP;
  const left =
    toRight + width > window.innerWidth - VIEWPORT_MARGIN
      ? anchor.left - FLYOUT_GAP - width
      : toRight;
  const maxTop = window.innerHeight - VIEWPORT_MARGIN - height;
  const top = Math.max(VIEWPORT_MARGIN, Math.min(anchor.top, maxTop));
  return { left: Math.max(VIEWPORT_MARGIN, left), top };
}

type Anchor = { left: number; top: number };
type PlanAction = (typeof PLAN_NEXT_STEP_ACTIONS)[number];
type PromptNextStepAction =
  | (typeof PROJECT_INCOMPLETE_NEXT_STEP_ACTIONS)[number];

function isPlanFileName(fileName: string | null | undefined): boolean {
  return !!fileName && /\.mdx?$/i.test(fileName);
}

function isArtifactFileName(fileName: string | null | undefined): boolean {
  return !!fileName && /\.html?$/i.test(fileName);
}

function promptActionTitle(action: PromptNextStepAction, t: TranslateFn): string {
  return t(action.titleKey);
}

function promptActionPrompt(action: PromptNextStepAction, locale: string): string {
  if (locale !== 'zh-CN') return action.prompt;
  switch (action.id) {
    case 'project-continue':
      return '从中断或未完成的那一轮继续。先阅读对话、当前项目文件和可见的错误，然后执行下一个具体步骤，并总结改了什么。';
    default:
      return (action as PromptNextStepAction).prompt;
  }
}

export function NextStepActions({
  fileName,
  planFileName,
  artifactFileName,
  onDownload,
  onPromptAction,
  suggestions,
  onSuggestion,
  variant = 'default',
}: Props) {
  const { t, locale } = useI18n();
  const analytics = useAnalytics();

  /*
   * 稿子第 41 / 42 格:回合末尾三行**由 agent 现写**的行为引导。
   *
   * 这一族原来是固定的工具箱目录(智能匹配下一步 / 设计润色 · 可交付 / 更多),
   * 产品裁决把它换掉了。只有 `default` 这一档是那份目录 —— 其余几档
   * (plan / project-incomplete)是各自的恢复流程,
   * 不在这次裁决范围内,原样保留。
   *
   * 调用方负责选择 agent 建议或 OPEND-2776 的成功生图动作。
   * 没有可用建议时不退回工具箱、不出空壳。
   */
  const visibleSuggestions = useMemo(
    () =>
      (suggestions ?? [])
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean)
        .slice(0, MAX_NEXT_STEP_SUGGESTIONS),
    [suggestions],
  );
  const isSuggestionVariant = variant === 'default';
  const renderNothing =
    isSuggestionVariant && (visibleSuggestions.length === 0 || !onSuggestion);

  const exposedRef = useRef(false);
  useEffect(() => {
    if (renderNothing) return;
    if (exposedRef.current) return;
    exposedRef.current = true;
    trackNextStepActionClick(analytics.track, {
      page_name: 'chat_panel',
      area: 'next_step',
      element: 'next_step_exposed',
    });
  }, [analytics.track, renderNothing]);

  const [more, setMore] = useState<Anchor | null>(null);

  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const closeAll = useCallback(() => {
    setMore(null);
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      closeAll();
      closeTimer.current = null;
    }, FLYOUT_CLOSE_DELAY_MS);
  }, [cancelClose, closeAll]);
  useEffect(() => () => cancelClose(), [cancelClose]);


  const openMore = useCallback(
    (rect: DOMRect) => {
      cancelClose();
      setMore(place(rect, MENU_WIDTH, MENU_HEIGHT));
    },
    [cancelClose],
  );
  const track = useCallback(
    (
      element:
        | 'share'
        | 'toolbox_action'
        | 'suggestion',
      chipId?: string,
    ) => {
      trackNextStepActionClick(analytics.track, {
        page_name: 'chat_panel',
        area: 'next_step',
        element,
        ...(chipId ? { chip_id: chipId } : {}),
      });
    },
    [analytics.track],
  );

  /**
   * 点一条建议 = 把那句话填入 Composer,等用户确认或改写后显式发送。
   * 点击本身不能落消息、建 run 或产生费用。行尾没有 `›`,因为它不打开
   * 下一层菜单,而不是因为会自动发送。
   *
   * 上报的是**位置**不是文字:建议是模型现写的、关于用户自己项目的话,
   * 不该进埋点载荷。
   */
  const handleSuggestion = useCallback(
    (text: string, index: number) => {
      if (!onSuggestion) return;
      track('suggestion', String(index));
      onSuggestion(text);
    },
    [onSuggestion, track],
  );

  const handleDownload = useCallback(() => {
    if (!fileName || !onDownload) return;
    track('share', 'download');
    onDownload(fileName);
    closeAll();
  }, [closeAll, fileName, onDownload, track]);

  const handlePromptAction = useCallback(
    (action: PromptNextStepAction) => {
      track('toolbox_action', action.id);
      onPromptAction?.(promptActionPrompt(action, locale));
      closeAll();
    },
    [closeAll, locale, onPromptAction, track],
  );
  const resolvedPlanFileName =
    planFileName ?? (variant === 'plan' && isPlanFileName(fileName) ? fileName : null);
  const resolvedArtifactFileName =
    artifactFileName ?? (variant === 'plan' && isArtifactFileName(fileName) ? fileName : null);
  const handlePlanPromptAction = useCallback(
    (action: PlanAction) => {
      if (action.requires === 'plan' && !resolvedPlanFileName) return;
      if (action.requires === 'artifact' && !resolvedArtifactFileName) return;
      if (action.requires === 'both' && (!resolvedPlanFileName || !resolvedArtifactFileName)) return;
      const primaryFile =
        action.requires === 'artifact'
          ? resolvedArtifactFileName
          : resolvedPlanFileName ?? resolvedArtifactFileName;
      if (!primaryFile) return;
      track('toolbox_action', action.id);
      onPromptAction?.(
        t(action.promptKey, {
          file: primaryFile,
          document: resolvedPlanFileName ?? primaryFile,
          artifact: resolvedArtifactFileName ?? primaryFile,
        }),
        {
          sessionMode: action.sessionMode,
        },
      );
      closeAll();
    },
    [closeAll, onPromptAction, resolvedArtifactFileName, resolvedPlanFileName, t, track],
  );


  const visiblePlanActions = useMemo(() => {
    if (resolvedPlanFileName && resolvedArtifactFileName) {
      return [PLAN_MERGE_DOC_ARTIFACT_ACTION, PLAN_IMPROVE_ARTIFACT_ACTION];
    }
    if (resolvedPlanFileName) {
      return [PLAN_GENERATE_ACTION, PLAN_IMPROVE_DOC_ACTION];
    }
    if (resolvedArtifactFileName) {
      return [PLAN_IMPROVE_ARTIFACT_ACTION];
    }
    return [];
  }, [resolvedArtifactFileName, resolvedPlanFileName]);
  const canDownload = !!(fileName && onDownload);
  const hasMore = canDownload;
  const showPlanRows = variant === 'plan' && visiblePlanActions.length > 0 && !!onPromptAction;
  const showProjectIncompleteRows = variant === 'project-incomplete' && !!onPromptAction;

  // Hover handlers shared by every flyout surface: stay open while hovered.
  const keepOpen = { onMouseEnter: cancelClose, onMouseLeave: scheduleClose };

  /*
   * 调用方没给建议 / 给了但一条都用不了 —— 这一行整块不出。
   * 返回 `null` 而不是空 `<div>`:空容器仍然占版面上的一格,而这一块的分寸
   * 恰恰是「你想继续时才被看见」。
   */
  if (renderNothing) return null;

  if (isSuggestionVariant) {
    return (
      <div
        className={styles.root}
        data-testid="next-step-actions"
        role="group"
        aria-label={t('nextStep.suggestionsLabel')}
      >
        <div className={styles.suggestions} data-testid="next-step-suggestions">
          {visibleSuggestions.map((text, index) => (
            <button
              // 文字本身就是身份:同一句话不会在同一轮里出现两次(解析时已去重),
              // 而下标做 key 会让新一轮的三条复用上一轮的 DOM,过渡跟着串味。
              key={text}
              type="button"
              className={styles.suggestionRow}
              data-testid={`next-step-suggestion-${index}`}
              onClick={() => handleSuggestion(text, index)}
            >
              {/* 稿子里三行是**同一枚箭头**,没有分类图标、也没有行尾 chevron ——
                  「有三条」这件事由三个箭头说,不由两道线说。 */}
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M13.9999 19.0001L5.00003 19.0002L5 17.0002L11.9999 17.0001L12 6.8283L8.05027 10.778L6.63606 9.36381L13 2.99985L19.364 9.36381L17.9498 10.778L14 6.82825L13.9999 19.0001Z" />
              </svg>
              <span className={styles.suggestionText}>{text}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.root}
      data-testid="next-step-actions"
      role="group"
      aria-label={t('nextStep.title')}
    >
      {showPlanRows || showProjectIncompleteRows || hasMore ? (
        <div className={styles.toolboxList} data-testid="next-step-toolbox">
          {showPlanRows
            ? visiblePlanActions.map((action) => {
                const title = t(action.titleKey);
                const description = t(action.descriptionKey);
                return (
                  <button
                    key={action.id}
                    type="button"
                    className={styles.toolboxRow}
                    data-testid={`next-step-plan-action-${action.id}`}
                    aria-label={`${title}. ${description}`}
                    title={description}
                    onClick={() => handlePlanPromptAction(action)}
                  >
                    <Icon name={action.icon} size={12} className={styles.toolboxRowIcon} />
                    <span className={styles.toolboxRowText}>
                      {/* The description is available through the native tooltip. */}
                      <span className={styles.toolboxRowTitle}>{title}</span>
                    </span>
                    <Icon name="chevron-right" size={12} className={styles.toolboxRowArrow} />
                  </button>
                );
              })
            : null}
          {null}
          {showProjectIncompleteRows
            ? PROJECT_INCOMPLETE_NEXT_STEP_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className={styles.toolboxRow}
                  data-testid={`next-step-project-action-${action.id}`}
                  onClick={() => handlePromptAction(action)}
                >
                  <Icon name={action.icon} size={12} className={styles.toolboxRowIcon} />
                  <span className={styles.toolboxRowTitle}>{promptActionTitle(action, t)}</span>
                  <Icon name="chevron-right" size={12} className={styles.toolboxRowArrow} />
                </button>
              ))
            : null}
          {null}
          {hasMore ? (
            <button
              type="button"
              className={styles.moreRow}
              data-testid="next-step-toolbox-more"
              aria-expanded={!!more}
              onMouseEnter={(e) => openMore(e.currentTarget.getBoundingClientRect())}
              onMouseLeave={scheduleClose}
              onClick={(e) => openMore(e.currentTarget.getBoundingClientRect())}
            >
              <Icon name="more-horizontal" size={12} className={styles.toolboxRowIcon} />
              <span className={styles.toolboxRowTitle}>{t('nextStep.more')}</span>
              <Icon name="chevron-right" size={12} className={styles.toolboxRowArrow} />
            </button>
          ) : null}
        </div>
      ) : null}
      {/* Download menu. */}
      {more && typeof document !== 'undefined'
        ? createPortal(
            <div
              className={`${styles.flyout} ${styles.flyoutMenu}`}
              role="menu"
              data-testid="next-step-more-menu"
              style={{ left: more.left, top: more.top }}
              {...keepOpen}
            >
              {null}
              {canDownload ? (
                <button
                  type="button"
                  className={styles.flyoutRow}
                  data-testid="next-step-more-download"


                  onClick={handleDownload}
                >
                  <Icon name="download" size={14} className={styles.toolboxRowIcon} />
                  <span className={styles.toolboxRowTitle}>{t('nextStep.download')}</span>
                  <Icon name="chevron-right" size={13} className={styles.toolboxRowArrow} />
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}

    </div>
  );
}
