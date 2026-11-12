import { ConfirmDialog } from '@openpixo/components';
import type { CSSProperties } from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from "@openpixo/components";

import { projectKindFromMetadataToTracking } from "@openpixo/contracts/analytics";
import { useAnalytics } from "../analytics/provider";
import {
  trackPageView,
  trackProjectsListClick,
  trackProjectsListControlsClick,
  trackProjectsMorePopoverClick,
} from "../analytics/events";
import { useT } from "../i18n";


import {
	getProjectCoverSnapshot,
	projectCoverSnapshotKey,
	setProjectCoverSnapshot,
} from "../lib/project-cover-cache";
import { fetchProjectFiles, } from "../providers/registry";
import type { Project, ProjectDisplayStatus, SkillSummary } from "../types";
import { AnimatePresence } from "motion/react";
import { Icon } from "./Icon";
import { Toast } from "./Toast";
import styles from "./ProjectsPanel.module.css";
import { ProjectDeleteConfirmDialog } from "./project-actions/ProjectDeleteConfirmDialog";
import { useProjectDeleteFlow } from "./project-actions/useProjectDeleteFlow";

import { HtmlProjectCoverFrame, projectCoverUrl, selectProjectFileCover, type ProjectCoverOverride } from "./project-cover";

type SubTab = "recent" | "yours";
type ViewMode = "grid" | "kanban";

type DesignListItem =
	{ type: "project"; project: Project; updatedAt: number; createdAt: number };

const DESIGNS_VIEW_STORAGE_KEY = "pixo:designs:view";
const PROJECTS_AUTO_REFRESH_MS = 15000;
const MAX_BACKGROUND_PROJECT_READS = 2;

async function mapWithConcurrency<T, R>(
	items: readonly T[],
	concurrency: number,
	map: (item: T) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let nextIndex = 0;
	const worker = async () => {
		for (;;) {
			const index = nextIndex;
			if (index >= items.length) return;
			nextIndex += 1;
			results[index] = await map(items[index]!);
		}
	};
	await Promise.all(
		Array.from(
			{ length: Math.min(Math.max(1, concurrency), items.length) },
			() => worker(),
		),
	);
	return results;
}

export const STATUS_ORDER = [
	"not_started",
	"running",
	"awaiting_input",
	"incomplete",
	"succeeded",
	"failed",
	"canceled",
] as const satisfies readonly ProjectDisplayStatus[];

export const STATUS_LABEL_KEYS = {
	not_started: "designs.status.notStarted",
	queued: "designs.status.queued",
	running: "designs.status.running",
	awaiting_input: "designs.status.awaitingInput",
	incomplete: "designs.status.incomplete",
	succeeded: "designs.status.succeeded",
	failed: "designs.status.failed",
	canceled: "designs.status.canceled",
} as const satisfies Record<
	ProjectDisplayStatus,
	Parameters<ReturnType<typeof useT>>[0]
>;

interface Props {
	projects: Project[];
	skills: SkillSummary[];
	onOpen: (id: string) => void;
	onDelete: (id: string) => Promise<boolean | void> | boolean | void;
	onDuplicate?: (id: string) => Promise<void> | void;
	onRename?: (id: string, name: string) => void;
	onNewProject?: () => void;
	onRefresh?: () => Promise<void> | void;
	isActive?: boolean;
}

export function ProjectsPanel({
	projects,
	skills,
	onOpen,
	onDelete,
	onDuplicate,
	onRename,
	onNewProject,
	onRefresh,
	isActive = true,
}: Props) {
	const renameTitleId = useId();
	const confirmInFlightRef = useRef(false);

	const t = useT();
	const analytics = useAnalytics();


	const deleteFlow = useProjectDeleteFlow({ onDelete, analyticsPage: "all_projects",  });
	// P0 page_view page_name=projects — fire once when the tab mounts so
	// `/projects` landings register even before the user clicks anything.
	// ref-keyed to survive re-renders that flip parent state without
	// remounting ProjectsPanel, mirroring the pattern in HomeView.
	const projectsPageViewFiredRef = useRef(false);
	useEffect(() => {
		if (projectsPageViewFiredRef.current) return;
		projectsPageViewFiredRef.current = true;
		trackPageView(analytics.track, { page_name: 'projects' });
	}, [analytics.track]);
	const [filter, setFilter] = useState("");
	const [sub, setSub] = useState<SubTab>("recent");
	const [coverByProject, setCoverByProject] = useState<
		Record<string, ProjectCoverOverride | null>
	>({});
	const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
	const [selectMode, setSelectMode] = useState(false);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const toastIdRef = useRef(0);
	const [designsToast, setDesignsToast] = useState<{
		id: number;
		message: string;
		role?: "status" | "alert";
		tone?: "default" | "success" | "error";
	} | null>(null);
	const [projectsRefreshing, setProjectsRefreshing] = useState(false);
	const menuContainerRef = useRef<HTMLDivElement | null>(null);
	const projectsRefreshInFlightRef = useRef(false);
	const coverWorkspaceIdentityRef = useRef<string | null>(null);
	const [renameTarget, setRenameTarget] = useState<{ id: string; original: string } | null>(null);
	const [renameInput, setRenameInput] = useState("");
	const [confirmTarget, setConfirmTarget] = useState<{
		title: string;
		message: string;
		confirmLabel: string;
		onConfirm: () => Promise<boolean | void> | boolean | void;
	} | null>(null);

	const [confirmOpen, setConfirmOpen] = useState(true);
	const [confirmPending, setConfirmPending] = useState(false);
	const [confirmError, setConfirmError] = useState<string | null>(null);
	const [batchDeleteIds, setBatchDeleteIds] = useState<string[]>([]);

	const [view, setView] = useState<ViewMode>(() => {
		if (typeof window === "undefined") return "grid";
		try {
			const storedView = window.localStorage.getItem(DESIGNS_VIEW_STORAGE_KEY);
			return storedView === "grid" || storedView === "kanban"
				? storedView
				: "grid";
		} catch {
			return "grid";
		}
	});

	useEffect(() => {
		if (!isActive || false) return;
		const controller = new AbortController();
		if (projects.length === 0) {
			setCoverByProject({});
			return;
		}
		const workspaceIdentity = "local";
		const workspaceIdentityChanged = coverWorkspaceIdentityRef.current !== workspaceIdentity;
		coverWorkspaceIdentityRef.current = workspaceIdentity;
		const immediateEntries: Array<readonly [string, ProjectCoverOverride | null]> = [];
		const unresolvedProjects = projects.filter((project) => {
			const snapshot = getProjectCoverSnapshot(
				projectCoverSnapshotKey(workspaceIdentity, project.id, project.updatedAt),
			);
			if (snapshot === undefined) return true;
			immediateEntries.push([project.id, snapshot.cover] as const);
			return false;
		});
	const immediateByProject = new Map(immediateEntries);
	setCoverByProject((current) => {
		const next: Record<string, ProjectCoverOverride | null> = {};
		for (const project of projects) {
			if (immediateByProject.has(project.id)) {
				next[project.id] = immediateByProject.get(project.id)!;
			} else if (!workspaceIdentityChanged && Object.hasOwn(current, project.id)) {
				next[project.id] = current[project.id]!;
			}
		}
		return next;
	});
		void mapWithConcurrency(
			unresolvedProjects,
			MAX_BACKGROUND_PROJECT_READS,
			async (project) => {
				// Brand projects render a generated logo/monogram cover (see
				// projectCover) instead of a raw HTML file preview, so skip the
				// file scan entirely for them.
				let cover: ProjectCoverOverride | null;
				{
					let files: Awaited<ReturnType<typeof fetchProjectFiles>>;
					try {
						files = await fetchProjectFiles(project.id, {
							signal: controller.signal,

						});
					} catch {
						return [project.id, undefined] as const;
					}
					if (controller.signal.aborted) return [project.id, undefined] as const;
						cover = selectProjectFileCover(files);

				}
				setProjectCoverSnapshot(
					projectCoverSnapshotKey(workspaceIdentity, project.id, project.updatedAt),
					cover,
				);
				return [project.id, cover] as const;
			},
		).then((entries) => {
			if (controller.signal.aborted) return;
			const resolvedEntries = entries.filter(
				(entry): entry is readonly [string, ProjectCoverOverride | null] => entry[1] !== undefined,
			);
			setCoverByProject((current) => ({
				...current,
				...Object.fromEntries(resolvedEntries),
			}));
		});
		return () => controller.abort();
	}, [isActive, projects, null, false]);

	useEffect(() => {
		if (!menuOpenId) return;
		const onDocClick = (e: MouseEvent) => {
			const el = menuContainerRef.current;
			if (el && el.contains(e.target as Node)) return;
			setMenuOpenId(null);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setMenuOpenId(null);
		};
		window.addEventListener("mousedown", onDocClick);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("mousedown", onDocClick);
			window.removeEventListener("keydown", onKey);
		};
	}, [menuOpenId]);

	useEffect(() => {
		// Drop selected ids that no longer exist
		setSelected((curr) => {
			const valid = new Set(projects.map((p) => p.id));
			let changed = false;
			const next = new Set<string>();
			curr.forEach((id) => {
				if (valid.has(id)) next.add(id);
				else changed = true;
			});
			return changed ? next : curr;
		});
	}, [projects]);

	useEffect(() => {
		try {
			window.localStorage.setItem(DESIGNS_VIEW_STORAGE_KEY, view);
		} catch {
			// Storage may be disabled; keep the in-memory view selection usable.
		}
	}, [view]);

	useEffect(() => {
		if (view === "kanban" && selectMode) exitSelectMode();
	}, [selectMode, view]);

	const refreshProjectsList = useCallback(
		async (source: "manual" | "auto") => {
			if (!onRefresh || projectsRefreshInFlightRef.current) return;
			projectsRefreshInFlightRef.current = true;
			setProjectsRefreshing(true);
			if (source === "manual") {
				trackProjectsListControlsClick(analytics.track, {
					page_name: "projects",
					area: "list_controls",
					element: "refresh",
				});
			}
			try {
				await onRefresh();
			} catch {
				if (source === "manual") {
					setDesignsToast({
						id: (toastIdRef.current += 1),
						message: t("common.networkFailure"),
						role: "alert",
						tone: "error",
					});
				}
			} finally {
				projectsRefreshInFlightRef.current = false;
				setProjectsRefreshing(false);
			}
		},
		[analytics.track, onRefresh, t],
	);

	const refreshProjectsListRef = useRef(refreshProjectsList);
	useEffect(() => {
		refreshProjectsListRef.current = refreshProjectsList;
	}, [refreshProjectsList]);

	const hasProjectsRefresh = Boolean(onRefresh);
	useEffect(() => {
		if (!isActive || !hasProjectsRefresh) return;

		const refreshIfVisible = () => {
			if (document.visibilityState !== "visible") return;
			void refreshProjectsListRef.current("auto");
		};

		refreshIfVisible();
		const interval = window.setInterval(refreshIfVisible, PROJECTS_AUTO_REFRESH_MS);
		window.addEventListener("focus", refreshIfVisible);
		document.addEventListener("visibilitychange", refreshIfVisible);
		return () => {
			window.clearInterval(interval);
			window.removeEventListener("focus", refreshIfVisible);
			document.removeEventListener("visibilitychange", refreshIfVisible);
		};
	}, [hasProjectsRefresh, isActive]);

	const filtered = useMemo(() => {
		const q = filter.trim().toLowerCase();
		let list: DesignListItem[] = projects
			.map((project) => ({
				type: "project",
				project,
				updatedAt: project.updatedAt,
				createdAt: project.createdAt,
			}));

		if (sub === "recent") {
			list = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
		}

		if (sub === "yours") {
			list = [...list].sort((a, b) => b.createdAt - a.createdAt);
		}

		if (!q) return list;
		return list.filter(item => item.project.name.toLowerCase().includes(q));
	}, [projects, filter, sub]);

	const filteredProjects = useMemo(
		() =>
			filtered.filter(
				(item): item is Extract<DesignListItem, { type: "project" }> =>
					item.type === "project",
			),
		[filtered],
	);

	const skillName = (id: string | null) =>
		skills.find((s) => s.id === id)?.name ?? "";
	const toggleSelected = (id: string) => {
		setSelected((curr) => {
			const next = new Set(curr);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};
	const exitSelectMode = () => {
		setSelectMode(false);
		setSelected(new Set());
	};
	const handleRenameProject = (project: Project) => {
		setRenameTarget({ id: project.id, original: project.name });
		setRenameInput(project.name);
	};
	const commitRename = () => {
		if (!renameTarget) return;
		const trimmed = renameInput.trim();
		if (trimmed && trimmed !== renameTarget.original) {
			onRename?.(renameTarget.id, trimmed);
		}
		setRenameTarget(null);
		setRenameInput("");
	};
	const cancelRename = () => {
		setRenameTarget(null);
		setRenameInput("");
	};
	const handleDeleteProject = (project: Project) => {
		deleteFlow.request(project);
	};
	const handleDuplicateProject = (project: Project) => {
		if (!onDuplicate) return;
		void Promise.resolve(onDuplicate(project.id)).catch((err) => {
			setDesignsToast({
				id: (toastIdRef.current += 1),
				message: err instanceof Error ? err.message : String(err),
				role: "alert",
				tone: "error",
			});
		});
	};
	const handleBatchDelete = () => {
		const ids = Array.from(selected);
		if (ids.length === 0) return;
		setConfirmError(null);
		setBatchDeleteIds(ids);
		setConfirmOpen(true);
		setConfirmTarget({
			title: t("designs.deleteTitle"),
			message: t("designs.deleteSelectedConfirm", { n: ids.length }),
			confirmLabel: t("designs.deleteSelected"),
			onConfirm: async () => {
				const results = await Promise.all(
					ids.map(async (id) => {
						try {
							const result = await onDelete(id);
							return result !== false;
						} catch {
							return false;
						}
					}),
				);
				const deleted = results.filter(Boolean).length;
				const failed = results.length - deleted;
				exitSelectMode();
				const message =
					failed > 0
						? t("designs.deleteSelectedPartial", { deleted, failed })
						: t("designs.deleteSelectedSuccess", { n: deleted });
				setDesignsToast({
					id: (toastIdRef.current += 1),
					message,
					...(failed > 0
						? { role: "alert" as const, tone: "error" as const }
						: { tone: "success" as const }),
				});
			},
		});
	};


 const commitConfirmTarget = async () => {
   if (!confirmTarget || confirmInFlightRef.current) return;
   const target = confirmTarget;
   confirmInFlightRef.current = true;
   setConfirmPending(true);
   setConfirmError(null);
   try {
     const result = await target.onConfirm();
     if (result === false) { setConfirmError(t("ds.actionFailed")); return; }
     setConfirmOpen(false);
     setBatchDeleteIds([]);
   } catch (error) {
     setConfirmError(error instanceof Error ? error.message : t("ds.actionFailed"));
   } finally {
     confirmInFlightRef.current = false;
     setConfirmPending(false);
   }
 };

	return (
		<div
			className={`tab-panel${view === "kanban" ? " design-kanban-view" : ""}`}
		>
			<div className={`tab-panel-toolbar designs-toolbar ${styles.toolbar}`}>
				<div className="toolbar-left">
					<div
						className="subtab-pill"
						role="group"
						aria-label={t("designs.filterAria")}
					>
						<button
							aria-pressed={sub === "recent"}
							className={sub === "recent" ? "active" : ""}
							onClick={() => {
								trackProjectsListControlsClick(analytics.track, {
									page_name: "projects",
									area: "list_controls",
									element: "recent",
								});
								setSub("recent");
							}}
						>
							{t("designs.subRecent")}
						</button>
						<button
							aria-pressed={sub === "yours"}
							className={sub === "yours" ? "active" : ""}
							onClick={() => {
								trackProjectsListControlsClick(analytics.track, {
									page_name: "projects",
									area: "list_controls",
									element: "your_designs",
								});
								setSub("yours");
							}}
						>
							{t("designs.subYours")}
						</button>
					</div>
				</div>
				<div className={`toolbar-right ${styles.toolbarEnd}`}>
					{onNewProject && projects.length > 0 ? (
						<button
							type="button"
							className="designs-new-project-button"
							data-testid="designs-new-project"
							onClick={() => {
								trackProjectsListControlsClick(analytics.track, {
									page_name: "projects",
									area: "list_controls",
									element: "create_project",
								});
								onNewProject();
							}}
						>
							<Icon name="plus" size={13} />
							<span>{t("entry.navNewProject")}</span>
						</button>
					) : null}
					<div className={`toolbar-search ${styles.search}`}>
						<span className={`search-icon ${styles.searchIcon}`} aria-hidden>
							<Icon name="search" size={14} />
						</span>
						<input
							placeholder={t("designs.searchPlaceholder")}
							value={filter}
							onChange={(e) => setFilter(e.target.value)}
							onFocus={() => {
								// P0 ui_click area=list_controls element=search_input.
								// Tracked on focus rather than every keystroke so each
								// engagement counts once.
								trackProjectsListControlsClick(analytics.track, {
									page_name: "projects",
									area: "list_controls",
									element: "search_input",
								});
							}}
						/>
					</div>
					{onRefresh ? (
						<button
							type="button"
							className="designs-refresh-button"
							onClick={() => void refreshProjectsList("manual")}
							disabled={projectsRefreshing}
							title={
								projectsRefreshing
									? t("designs.statusRefreshing")
									: t("filesPanel.refresh")
							}
							aria-label={
								projectsRefreshing
									? t("designs.statusRefreshing")
									: t("filesPanel.refresh")
							}
						>
							<Icon
								name={projectsRefreshing ? "spinner" : "refresh"}
								size={14}
								className={projectsRefreshing ? "icon-spin" : undefined}
							/>
							<span>
								{projectsRefreshing
									? t("designs.statusRefreshing")
									: t("filesPanel.refresh")}
							</span>
						</button>
					) : null}
					{view === "grid" && selectMode ? (
						<div className="designs-select-bar" role="group">
							<span className="designs-select-count">
								{t("designs.selectedCount", { n: selected.size })}
							</span>
							<button
								type="button"
								className="designs-select-delete"
								disabled={selected.size === 0}
								onClick={handleBatchDelete}
							>
								{t("designs.deleteSelected")}
							</button>
							<button
								type="button"
								className="designs-select-cancel"
								onClick={exitSelectMode}
							>
								{t("designs.cancelSelect")}
							</button>
						</div>
					) : view === "grid" ? (
						<button
							type="button"
							className="designs-select-toggle"
							onClick={() => {
								trackProjectsListControlsClick(analytics.track, {
									page_name: "projects",
									area: "list_controls",
									element: "select",
								});
								setSelectMode(true);
							}}
						>
							<Icon name="check" size={14} />
							<span>{t("designs.selectMode")}</span>
						</button>
					) : null}
					<div
						className="subtab-pill"
						role="group"
						aria-label={t("designs.viewToggleAria")}
					>
						<button
							aria-pressed={view === "grid"}
							className={view === "grid" ? "active" : ""}
							onClick={() => {
								trackProjectsListControlsClick(analytics.track, {
									page_name: "projects",
									area: "list_controls",
									element: "grid_view",
								});
								setView("grid");
							}}
							title={t("designs.viewGrid")}
							data-testid="designs-view-grid"
						>
							<Icon name="grid" size={14} />
						</button>
						<button
							aria-pressed={view === "kanban"}
							className={view === "kanban" ? "active" : ""}
							onClick={() => {
								// Kanban view substitutes for the contract's
								// list_view element.
								trackProjectsListControlsClick(analytics.track, {
									page_name: "projects",
									area: "list_controls",
									element: "list_view",
								});
								setView("kanban");
							}}
							title={t("designs.viewKanban")}
							data-testid="designs-view-kanban"
						>
							<Icon name="kanban" size={14} />
						</button>
					</div>
				</div>
			</div>
			{filtered.length === 0 ? (
				<div className="tab-empty">
					{projects.length === 0 ? (
						<div className="designs-empty-state">
							<h2 className="designs-empty-title">
								{t("designs.emptyNoProjects")}
							</h2>
							{onNewProject ? (
								<button
									type="button"
									className="primary designs-empty-cta"
									data-testid="designs-empty-new-project"
									onClick={() => {
										trackProjectsListControlsClick(analytics.track, {
											page_name: "projects",
											area: "list_controls",
											element: "create_project",
										});
										onNewProject();
									}}
								>
									<span>{t("entry.navNewProject")}</span>
								</button>
							) : null}
						</div>
					) : (
						t("designs.emptyNoMatch")
					)}
				</div>
			) : view === "grid" ? (
				<div className="design-grid">
					{filtered.map((item) => {
						const p = item.project;
						const skill = skillName(p.skillId);
						const status = p.status?.value ?? "not_started";
						const cover = projectCover(
							p,
							coverByProject[p.id] ?? null
						);
						const isSelected = selected.has(p.id);
						return (
							<div
								key={p.id}
								className={`design-card${isSelected ? " is-selected" : ""}${selectMode ? " select-mode" : ""}${""}`}
								role="button"
								tabIndex={0}
								onClick={() => {
									if (selectMode) {
										toggleSelected(p.id);
									} else {
										// P0 ui_click area=list element=project_card.
										const projectKind = projectKindFromMetadataToTracking(p.metadata);
										trackProjectsListClick(analytics.track, {
											page_name: "projects",
											area: "list",
											element: "project_card",
											project_id: p.id,
											...(projectKind ? { project_kind: projectKind } : {}),
										});
										onOpen(p.id);
									}
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										if (selectMode) toggleSelected(p.id);
										else onOpen(p.id);
									}
								}}
							>
								{selectMode ? (
									<span
										className={`design-card-checkbox${isSelected ? " checked" : ""}`}
										aria-hidden
									>
										{isSelected ? <Icon name="check" size={14} /> : null}
									</span>
								) : (
									<div
										className="design-card-menu-anchor"
										ref={menuOpenId === p.id ? menuContainerRef : undefined}
									>
										<button
											type="button"
											className="design-card-more"
											aria-label={t("designs.menuMore")}
											aria-haspopup="menu"
											aria-expanded={menuOpenId === p.id}
											onClick={(e) => {
												e.stopPropagation();
												setMenuOpenId((cur) => {
													const nextId = cur === p.id ? null : p.id;
													if (nextId === p.id) {
														const projectKind = projectKindFromMetadataToTracking(p.metadata);
														trackProjectsListClick(analytics.track, {
															page_name: "projects",
															area: "list",
															element: "more",
															project_id: p.id,
															...(projectKind ? { project_kind: projectKind } : {}),
														});
													}
													return nextId;
												});
											}}
										>
											<Icon name="more-horizontal" size={14} />
									</button>
									{menuOpenId === p.id ? (
										<div
											className="design-card-menu"
											role="menu"
											onClick={(e) => e.stopPropagation()}
										>
											<button
												type="button"
												role="menuitem"
												onClick={() => {
													const projectKind = projectKindFromMetadataToTracking(p.metadata);
													trackProjectsMorePopoverClick(analytics.track, {
														page_name: "projects",
														area: "projects_more_popover",
														element: "rename",
														project_id: p.id,
														...(projectKind ? { project_kind: projectKind } : {}),
													});
													setMenuOpenId(null);
													handleRenameProject(p);
												}}
											>
												<Icon name="pencil" size={14} />
												<span>{t("designs.menuRename")}</span>
											</button>
											{onDuplicate ? (
												<button
													type="button"
													role="menuitem"
													onClick={() => {
														const projectKind = projectKindFromMetadataToTracking(p.metadata);
														trackProjectsMorePopoverClick(analytics.track, {
															page_name: "projects",
															area: "projects_more_popover",
															element: "duplicate",
															project_id: p.id,
															...(projectKind ? { project_kind: projectKind } : {}),
														});
														setMenuOpenId(null);
														handleDuplicateProject(p);
													}}
												>
													<Icon name="copy" size={12} />
													<span>{t("designs.menuDuplicate")}</span>
												</button>
											) : null}
											<button
												type="button"
												role="menuitem"
												className="danger"
												onClick={() => {
													const projectKind = projectKindFromMetadataToTracking(p.metadata);
													trackProjectsMorePopoverClick(analytics.track, {
														page_name: "projects",
														area: "projects_more_popover",
														element: "delete",
														project_id: p.id,
														...(projectKind ? { project_kind: projectKind } : {}),
													});
													setMenuOpenId(null);
													handleDeleteProject(p);
												}}
											>
												<Icon name="close" size={14} />
												<span>{t("designs.menuDelete")}</span>
											</button>
										</div>
									) : null}
								</div>
								)}
								<div
									className={`design-card-thumb project-thumb project-thumb-${cover.kind}`}
									style={cover.style}
									aria-hidden
								>
									{(cover.kind === "image" || cover.kind === "logo") && cover.src ? (
										<img className="thumb-media" src={cover.src} alt="" loading="lazy" />
									) : cover.kind === "video" && cover.src ? (
										<video className="thumb-media" src={cover.src} muted preload="metadata" playsInline />
									) : cover.kind === "html" ? (
										<HtmlProjectCoverFrame
											src={cover.src}
											initial={cover.initial}
											iframeClassName="thumb-iframe"
											glyphClassName="project-thumb-glyph"
											diagnostic={`${p.id}:${cover.name ?? "unknown"}`}
										/>
									) : (
										<span className="project-thumb-glyph">{cover.initial}</span>
									)}

								</div>
								<div className="design-card-meta-block">
									<div className="design-card-tag-row">
										{(
											<ProjectTag category={projectCategory(p)} />
										)}
									</div>
									<div className="design-card-name" title={p.name}>
										{p.name}
									</div>
									<div className="design-card-meta">
										<span className="design-card-meta-main">
											<span>{t("designs.cardFreeform")}</span>
											{skill ? ` · ${skill}` : ""}
											{" · "}
											<span
												className={`design-card-status design-card-status-${status}`}
											>
												{statusLabel(status, t)}
											</span>
										</span>
										{sub === "recent" || sub === "yours" ? (
											<span className="design-card-meta-time">
												{relativeTime(p.updatedAt, t)}
											</span>
										) : null}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			) : (
				<div className="design-kanban-board">
					{STATUS_ORDER.map((status) => {
						const colProjects = filteredProjects.filter(
							(item) =>
								normalizeStatus(item.project.status?.value ?? "not_started") ===
								status,
						);
						return (
							<div key={status} className="design-kanban-col">
								<div className="design-kanban-header">
									<span>{statusLabel(status, t)}</span>
									<span className="design-kanban-count">
										{colProjects.length}
									</span>
								</div>
								<div className="design-kanban-list">
									{colProjects.length === 0 ? (
										<div className="design-kanban-empty">
											{t("designs.kanbanEmptyColumn")}
										</div>
									) : (
										colProjects.map(({ project: p }) => {
											const skill = skillName(p.skillId);
											return (
												<div
													key={p.id}
													className={`design-kanban-card status-${status}${""}`}
													role="button"
													tabIndex={0}
													onClick={() => onOpen(p.id)}
													onKeyDown={(e) => {
														if (e.key === "Enter" || e.key === " ") {
															e.preventDefault();
															onOpen(p.id);
														}
													}}
												>
													<button
														className="design-card-close"
														title={t("designs.deleteTitle")}
														aria-label={t("designs.deleteAria", {
															name: p.name,
														})}
														onClick={(e) => {
															e.stopPropagation();
															handleDeleteProject(p);
														}}
													>
														<Icon name="close" size={14} />
													</button>
													<div
														className="design-kanban-card-name"
														title={p.name}
													>
														{p.name}
													</div>
													{null}
													<div className="design-kanban-card-meta">
														<span>{t("designs.cardFreeform")}</span>
														{skill ? ` · ${skill}` : ""}
														{sub === "recent" || sub === "yours"
															? ` · ${relativeTime(p.updatedAt, t)}`
															: ""}
													</div>
												</div>
											);
										})
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}
			{renameTarget ? (
				<Dialog
					as="form"
					className="modal-rename"
					onClose={cancelRename}
					closeOnEscape
					ariaLabelledBy={renameTitleId}
					onSubmit={(e) => {
						e.preventDefault();
						commitRename();
					}}
				>
					<DialogTitle id={renameTitleId}>{t("designs.renameTitle")}</DialogTitle>
					<label>
						{t("designs.renamePrompt", { name: renameTarget.original })}
						<input
							type="text"
							value={renameInput}
							autoFocus
							onChange={(e) => setRenameInput(e.target.value)}
						/>
					</label>
					<DialogFooter className="row">
						<button type="button" onClick={cancelRename}>
							{t("designs.renameCancel")}
						</button>
						<button
							type="submit"
							className="primary"
							disabled={
								!renameInput.trim() ||
								renameInput.trim() === renameTarget.original
							}
						>
							{t("designs.renameSave")}
						</button>
					</DialogFooter>
				</Dialog>
			) : null}
			<ProjectDeleteConfirmDialog
					projectName={deleteFlow.target?.name ?? null}
					keepsFolder={Boolean(deleteFlow.target?.metadata?.baseDir)}
					pending={deleteFlow.pending}
					failed={deleteFlow.failed}
					errorCode={deleteFlow.errorCode}
					onCancel={deleteFlow.cancel}
					onConfirm={() => void deleteFlow.commit()}
				/>

      {confirmTarget && <ConfirmDialog open={confirmOpen} title={confirmTarget.title}
        onAfterClose={() => { if (!confirmOpen) setConfirmTarget(null); }} destructive busy={confirmPending}
        confirmLabel={confirmTarget.confirmLabel} cancelLabel={t('designs.renameCancel')}
        onCancel={() => { if (!confirmInFlightRef.current) { setConfirmTarget(null); setBatchDeleteIds([]); setConfirmError(null); } }}
        onConfirm={() => void commitConfirmTarget()}>
        <p>{confirmTarget.message}</p>
        {confirmError && <p role="alert">{confirmError}</p>}
      </ConfirmDialog>}

			<AnimatePresence>
				{designsToast ? (
					<Toast
						key={designsToast.id}
						message={designsToast.message}
						role={designsToast.role}
						tone={designsToast.tone}
						onDismiss={() => setDesignsToast(null)}
					/>
				) : null}
			</AnimatePresence>
		</div>
	);
}

function normalizeStatus(
	status: ProjectDisplayStatus,
): Exclude<ProjectDisplayStatus, "queued"> {
	return status === "queued" ? "running" : status;
}

function statusLabel(
	status: ProjectDisplayStatus,
	t: ReturnType<typeof useT>,
): string {
	return t(STATUS_LABEL_KEYS[status]);
}

function relativeTime(ts: number, t: ReturnType<typeof useT>): string {
	const diff = Date.now() - ts;
	const min = 60_000;
	const hr = 60 * min;
	const day = 24 * hr;
	if (diff < min) return t("common.justNow");
	if (diff < hr) return t("common.minutesAgo", { n: Math.floor(diff / min) });
	if (diff < day) return t("common.hoursAgo", { n: Math.floor(diff / hr) });
	if (diff < 7 * day) return t("common.daysAgo", { n: Math.floor(diff / day) });
	return new Date(ts).toLocaleDateString();
}

function isOrbitProject(project: Project): boolean {
  const metadata = project.metadata as { kind?: unknown } | undefined;
  return metadata?.kind === 'orbit';
}


function projectCover(
	project: Project,
	override: ProjectCoverOverride | null
): {
	kind: "image" | "video" | "html" | "logo" | "fallback";
	src?: string;
	style: CSSProperties;
	initial: string;
	name?: string;
} {
	let h = 0;
	for (let i = 0; i < project.id.length; i++) {
		h = (h * 31 + project.id.charCodeAt(i)) >>> 0;
	}
	const hue = h % 360;
	const hue2 = (hue + 38) % 360;
	const style: CSSProperties = {
		background: `radial-gradient(circle at 30% 28%, hsl(${hue} 70% 78% / 0.55), transparent 42%), linear-gradient(135deg, hsl(${hue} 65% 88%), hsl(${hue2} 70% 90%))`,
	};
	const trimmed = project.name.trim();
	const initial = (trimmed ? Array.from(trimmed)[0]! : "?").toUpperCase();
	const meta = project.metadata;
	if (override) {
		return {
			kind: override.kind,
			src: projectCoverUrl(
				project.id,
				override.name,
				override.mtime
			),
			style,
			initial,
			name: override.name,
		};
	}
	const entry = meta?.entryFile;
	if (entry) {
		const src = projectCoverUrl(
			project.id,
			entry,
			project.updatedAt
		);
		if (meta?.kind === "image") return { kind: "image", src, style, initial };
		if (meta?.kind === "video") return { kind: "video", src, style, initial };
		if (/\.html?$/i.test(entry)) return { kind: "html", src, style, initial, name: entry };
	}
	return { kind: "fallback", style, initial };
}

type ProjectCategory = "prototype" | "media";

function projectCategory(project: Project): ProjectCategory {
	const meta = project.metadata;
	if (meta?.kind === "image" || meta?.kind === "video" || meta?.kind === "audio") {
		return "media";
	}
	return "prototype";
}

function ProjectTag({ category }: { category: ProjectCategory }) {
	const t = useT();
	const label = category === "media" ? t("designs.tagMedia") : t("designs.tagPrototype");
	return (
		<span className={`design-card-tag tag-${category}`}>{label}</span>
	);
}
