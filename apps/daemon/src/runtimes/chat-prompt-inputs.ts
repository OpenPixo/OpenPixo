import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderResearchCommandContract } from '../research/prompt-contract.js';
import { gameVerifyArtifactDir } from '../game/verify-store.js';
import {
  describeChangedStableSections,
  type StableChangedSection,
  type StableSectionHashes,
} from './stable-prompt-sections.js';

export const MAX_CHAT_IMAGE_BYTES = 1024 * 1024;
export const UPLOAD_DIR = path.join(os.tmpdir(), 'pixo-uploads');
export function composeLiveInstructionPrompt({
  daemonSystemPrompt,
  runtimeToolPrompt,
  clientSystemPrompt,
  finalPromptOverride,
}: {
  daemonSystemPrompt?: string | null;
  runtimeToolPrompt?: string | null;
  clientSystemPrompt?: string | null;
  finalPromptOverride?: string | null;
}) {
  const override =
    typeof finalPromptOverride === 'string'
      ? finalPromptOverride.trim()
      : '';
  const parts = [daemonSystemPrompt, runtimeToolPrompt, clientSystemPrompt]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .map((part) =>
      override && part.includes(override)
        ? part.split(override).join('').trim()
        : part,
    )
    .filter(Boolean);
  if (override) {
    parts.push(override);
  }
  return parts.join('\n\n---\n\n');
}

export function composeChatAgentTextPayload({
  formOverride,
  daemonSystemPrompt,
  runtimeToolPrompt,
  researchCommandContract,
  runContextPrompt,
  connectedExternalMcpReference,
  browserUnavailableGuard,
  titleGenerationDirective,
  clientSystemPrompt,
  cwdReference,
  linkedDirectoryReferences,
  echoGuard,
  requestOrStageText,
  projectAttachmentReferences,
  imageReferences,
}: {
  formOverride: string;
  daemonSystemPrompt: string;
  runtimeToolPrompt: string;
  researchCommandContract: string;
  runContextPrompt: string;
  connectedExternalMcpReference: string;
  browserUnavailableGuard: string;
  titleGenerationDirective: string;
  clientSystemPrompt: string;
  cwdReference: string;
  linkedDirectoryReferences: string;
  echoGuard: string;
  requestOrStageText: string;
  projectAttachmentReferences: string;
  imageReferences: string;
}) {
  const clientInstructionPrompt = [
    researchCommandContract,
    runContextPrompt,
    connectedExternalMcpReference,
    browserUnavailableGuard,
    titleGenerationDirective,
    clientSystemPrompt,
  ]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join('\n\n---\n\n');
  const instructionPrompt = composeLiveInstructionPrompt({
    daemonSystemPrompt,
    runtimeToolPrompt,
    clientSystemPrompt: clientInstructionPrompt,
    finalPromptOverride: null,
  });
  const composedPrompt = [
    instructionPrompt
      ? `# Instructions (read first)\n\n${formOverride}${instructionPrompt}${cwdReference}${linkedDirectoryReferences}${echoGuard}\n\n---\n`
      : cwdReference
        ? `# Instructions\n\n${formOverride}${cwdReference}${linkedDirectoryReferences}${echoGuard}\n\n---\n`
        : linkedDirectoryReferences
          ? `# Instructions\n\n${formOverride}${linkedDirectoryReferences}${echoGuard}\n\n---\n`
          : formOverride
            ? `# Instructions\n\n${formOverride}${echoGuard}\n\n---\n`
            : '',
    `# User request\n\n${requestOrStageText}${projectAttachmentReferences}`,
    imageReferences ? `\n\n${imageReferences}` : '',
  ].join('');

  return {
    composedPrompt,
    clientInstructionPrompt,
    instructionPrompt,
  };
}

export function resolveResearchCommandContract(
  research: { enabled?: boolean; query?: string; maxSources?: number } | null | undefined,
  message: string,
) {
  if (!research || !research.enabled) return '';
  const researchQuery =
    typeof research.query === 'string' && research.query.trim()
      ? research.query
      : message;
  return renderResearchCommandContract({
    query: researchQuery,
    ...(typeof research.maxSources === 'number'
      ? { maxSources: research.maxSources }
      : {}),
  });
}

/**
 * Folders a project run's own `pixo` commands write outside the project:
 * `game verify` and `game playtest` keep logs and screenshots under the
 * project's verify folder in daemon data. Created up front, because a sandbox
 * can only grant a folder that exists.
 */
export async function chatToolOutputDirs(artifactsDir: string, projectId: string | null | undefined): Promise<string[]> {
  if (typeof projectId !== 'string' || !projectId) return [];
  const dir = gameVerifyArtifactDir(artifactsDir, projectId);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    return [dir];
  } catch {
    return [];
  }
}

/**
 * Read-only directories the run may reach outside its project cwd.
 *
 * The invariant: every absolute path the composed prompt advertises to the
 * agent has to appear here. `withSkillRootPreamble()` names the skill's own
 * directory as the "absolute fallback" skill root, and `skillsDir` only covers
 * the skills that ship in the repository — a skill installed under the daemon
 * data dir, or a plugin-local `SKILL.md` loaded from the bundled plugin folder,
 * resolves to a root that is outside every entry below. The agent then reads a
 * path we told it to read and the runtime treats it as an unapproved external
 * directory: OpenCode raises `permission.external_directory`, which a headless
 * run surfaces as a rejected tool call rather than as the staging gap it is.
 * Passing `activeSkillDirs` keeps the allowlist keyed on the roots actually in
 * play for this turn instead of on a fixed subset of them.
 *
 * Codex is excluded from those read-only roots because it treats allowlisted
 * directories as writable, and skill roots are shipped read-only resources
 * (PR #622). `toolOutputDirs` are the opposite case: folders the agent's own
 * `pixo` commands must write (the project's game verify/playtest artifacts),
 * granted to every agent so Codex's sandbox does not refuse its own checks.
 */
export function resolveChatExtraAllowedDirs({
  agentId,
  skillsDir,
  linkedDirs = [],
  activeSkillDirs = [],
  toolOutputDirs = [],
  existsSync = fs.existsSync,
}: {
  agentId?: string | null;
  skillsDir?: string | null;
  linkedDirs?: Array<string | null | undefined>;
  activeSkillDirs?: Array<string | null | undefined>;
  toolOutputDirs?: Array<string | null | undefined>;
  existsSync?: (path: string) => boolean;
}): string[] {
  const isCodex =
    typeof agentId === 'string' && agentId.trim().toLowerCase() === 'codex';
  const readOnlyRoots = isCodex
    ? []
    : [
        skillsDir,
        ...(Array.isArray(linkedDirs) ? linkedDirs : []),
        ...(Array.isArray(activeSkillDirs) ? activeSkillDirs : []),
      ];
  const candidates = [...readOnlyRoots, ...(Array.isArray(toolOutputDirs) ? toolOutputDirs : [])];
  return Array.from(
    new Set(
      candidates.filter(
        (d): d is string =>
          typeof d === 'string' && d.length > 0 && existsSync(d),
      ),
    ),
  );
}

export type StablePromptCacheMissReason =
  | 'new-session'
  | 'missing-stored-hash'
  | 'stable-prompt-changed'
  | null;

export function describeStablePromptCache({
  isResuming,
  storedStablePromptHash,
  currentStableHash,
  storedStableSections,
  currentStableSections,
}: {
  isResuming: boolean;
  storedStablePromptHash: string | null;
  currentStableHash: string;
  storedStableSections?: StableSectionHashes | null;
  currentStableSections?: StableSectionHashes | null;
}): {
  stablePromptHash: string;
  hit: boolean;
  missReason: StablePromptCacheMissReason;
  changedSections: StableChangedSection[] | null;
} {
  if (!isResuming) {
    return {
      stablePromptHash: currentStableHash,
      hit: false,
      missReason: 'new-session',
      changedSections: null,
    };
  }
  if (storedStablePromptHash === currentStableHash) {
    return {
      stablePromptHash: currentStableHash,
      hit: true,
      missReason: null,
      changedSections: null,
    };
  }
  const missReason: StablePromptCacheMissReason = storedStablePromptHash === null
    ? 'missing-stored-hash'
    : 'stable-prompt-changed';
  return {
    stablePromptHash: currentStableHash,
    hit: false,
    missReason,
    // Attribute only real drift. `missing-stored-hash` is a legacy/again-seeded
    // row with no baseline to diff against, so naming sections there would
    // report the whole map as "changed" and drown the signal we care about.
    changedSections: missReason === 'stable-prompt-changed' && currentStableSections
      ? describeChangedStableSections(storedStableSections, currentStableSections)
      : null,
  };
}

const DESIGN_FILES_HINT_FOLDER_LIMIT = 40;
const DESIGN_FILES_HINT_FILE_LIMIT = 80;
type DesignFilesHintEntry = {
  name?: string;
  path?: string;
  kind?: string;
  type?: string;
  size?: number;
};

function isPathWithin(base: string, target: string) {
  const relativePath = path.relative(path.resolve(base), path.resolve(target));
  return (
    relativePath === '' ||
    (relativePath.length > 0 &&
      !relativePath.startsWith('..') &&
      !path.isAbsolute(relativePath))
  );
}

export function resolveSafeProjectAttachments(
  cwd: string | null | undefined,
  attachments: readonly string[] | null | undefined,
  opts: {
    pathImpl?: typeof path;
    existsSync?: (path: string) => boolean;
  } = {},
) {
  if (!cwd || !Array.isArray(attachments)) return [];
  const pathImpl = opts.pathImpl ?? path;
  const existsSync = opts.existsSync ?? fs.existsSync;
  const root = pathImpl.resolve(cwd);
  const out: string[] = [];

  for (const attachment of attachments) {
    if (typeof attachment !== 'string' || attachment.length === 0) continue;
    try {
      const abs = pathImpl.resolve(root, attachment);
      const relativePath = pathImpl.relative(root, abs);
      const withinRoot =
        relativePath === '' ||
        (relativePath.length > 0 &&
          !relativePath.startsWith('..') &&
          !pathImpl.isAbsolute(relativePath));
      if (withinRoot && existsSync(abs)) out.push(attachment);
    } catch {
      // Drop malformed paths; attachments are advisory prompt context.
    }
  }

  return out;
}

export function formatProjectAttachmentHint(attachments: readonly string[] | null | undefined) {
  if (!Array.isArray(attachments) || attachments.length === 0) return '';
  return [
    '',
    '',
    'Attached project files in user-visible order:',
    ...attachments.map((p, index) => `${index + 1}. \`${p}\``),
    '',
    'When the user says "first attachment", "second file", or similar, map those references to the numbered list above.',
  ].join('\n');
}

function formatProjectEntrySize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDesignFilesEntryLine(entry: DesignFilesHintEntry | null | undefined, fallbackKind?: string) {
  const entryPath =
    typeof entry?.path === 'string' && entry.path
      ? entry.path
      : typeof entry?.name === 'string'
        ? entry.name
        : '';
  if (!entry || !entryPath) return null;
  const kind = fallbackKind || entry.kind || entry.type || 'file';
  const size = kind === 'folder' ? '' : formatProjectEntrySize(Number(entry.size));
  return `- \`${entryPath}\` (${[kind, size].filter(Boolean).join(', ')})`;
}

export function formatDesignFilesWorkspaceHint(
  cwd: string | null | undefined,
  files: DesignFilesHintEntry[] = [],
  folders: DesignFilesHintEntry[] = [],
) {
  if (typeof cwd !== 'string' || cwd.trim().length === 0) return '';
  const safeFolders = Array.isArray(folders) ? folders : [];
  const safeFiles = Array.isArray(files) ? files : [];
  const folderLines = safeFolders
    .slice(0, DESIGN_FILES_HINT_FOLDER_LIMIT)
    .map((folder) => formatDesignFilesEntryLine(folder, 'folder'))
    .filter((line): line is string => Boolean(line));
  const fileLines = safeFiles
    .slice(0, DESIGN_FILES_HINT_FILE_LIMIT)
    .map((file) => formatDesignFilesEntryLine(file, file.kind || 'file'))
    .filter((line): line is string => Boolean(line));
  const totalFolders = safeFolders.length;
  const totalFiles = safeFiles.length;
  const omittedFolders = Math.max(0, totalFolders - folderLines.length);
  const omittedFiles = Math.max(0, totalFiles - fileLines.length);

  const lines = [
    '',
    '',
    '## Project workspace',
    `The Files panel is backed by your current working directory: \`${cwd}\`. Write project files relative to this directory, in the engine's own layout (for example \`src/scenes/level-1.ts\` or \`assets/hero.png\`). The user can browse these files in real time.`,
    'Keep the entry file the engine expects, such as `index.html` for a web game. Preserve existing filenames when the task is an edit.',
    'The selected/attached files for a turn are only a shortcut for priority and ordering. If the user did not attach any file, do not assume there are no relevant project files.',
    'When the request refers to existing files, asks you to choose a file, says "current", "this scene", "the level", "the image", "the folder", or depends on project state, inspect/search/read this workspace before answering or editing. Prefer project-relative paths, use the active workspace context as the default target, and ask only if multiple plausible targets remain after inspection.',
    'For non-trivial inspection or edits, surface progress through visible planning/status/tool events instead of silently guessing.',
    '',
    `Current project files snapshot:${totalFolders} folder${totalFolders === 1 ? '' : 's'}, ${totalFiles} file${totalFiles === 1 ? '' : 's'}.`,
  ];

  if (folderLines.length > 0) {
    lines.push('', 'Folders:', ...folderLines);
    if (omittedFolders > 0) lines.push(`- ... ${omittedFolders} more folder${omittedFolders === 1 ? '' : 's'} omitted`);
  }

  if (fileLines.length > 0) {
    lines.push('', 'Files:', ...fileLines);
    if (omittedFiles > 0) lines.push(`- ... ${omittedFiles} more file${omittedFiles === 1 ? '' : 's'} omitted`);
  }

  if (folderLines.length === 0 && fileLines.length === 0) {
    lines.push('', 'No user-visible project files exist yet. Create clear project-relative files when the task requires output.');
  }

  return lines.join('\n');
}

export function resolveSafePromptImagePaths(
  imagePaths: readonly string[] | null | undefined,
  opts: {
    pathImpl?: typeof path;
    existsSync?: (path: string) => boolean;
    statSync?: (path: string) => { isFile(): boolean; size?: number };
    uploadDir?: string;
    maxBytes?: number;
  } = {},
) {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
    return { safeImages: [], oversizedImages: [], failedImages: [] };
  }
  const pathImpl = opts.pathImpl ?? path;
  const existsSync = opts.existsSync ?? fs.existsSync;
  const statSync = opts.statSync ?? fs.statSync;
  const uploadDir = pathImpl.resolve(opts.uploadDir ?? UPLOAD_DIR);
  const maxBytes = Number.isFinite(opts.maxBytes)
    ? Number(opts.maxBytes)
    : MAX_CHAT_IMAGE_BYTES;
  const safeImages: string[] = [];
  const oversizedImages: Array<{ path: string; sizeBytes: number }> = [];
  const failedImages: Array<{ path: string; error: string }> = [];

  for (const inputPath of imagePaths) {
    if (typeof inputPath !== 'string' || inputPath.length === 0) continue;
    let resolved;
    try {
      resolved = pathImpl.resolve(inputPath);
    } catch {
      // Drop malformed path input; we cannot even resolve it to a location.
      continue;
    }
    if (!isPathWithin(uploadDir, resolved) || !existsSync(resolved)) continue;
    // Past the within-UPLOAD_DIR + existence gate the path points at a real
    // upload. A statSync failure here (EACCES/EPERM, a file that vanished
    // mid-run) is an infrastructure error, not bad input — surface it so the
    // run fails loudly instead of silently dropping required prompt context.
    let stat;
    try {
      stat = statSync(resolved);
    } catch (err) {
      failedImages.push({
        path: inputPath,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (!stat.isFile()) continue;
    if (typeof stat.size === 'number' && stat.size > maxBytes) {
      oversizedImages.push({ path: inputPath, sizeBytes: stat.size });
      continue;
    }
    safeImages.push(inputPath);
  }

  return { safeImages, oversizedImages, failedImages };
}
