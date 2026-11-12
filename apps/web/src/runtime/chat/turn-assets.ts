/**
 * 这一轮**生成或写出的图片、音频、视频** —— 消息里那块预览(`AssetGallery`)的数据源。纯函数,无 DOM。
 * 判据三类共用:生图行按 `surface` 分的格子也出音频和视频,写文件的工具行按后缀认。
 *
 * 为什么要单独一块:执行记录里本来就有生图行(组件 12,`ImageRow`),可那一行住在
 * 执行记录**里面**。一条 todo 做完,它所在的那一段就收起;整轮跑完,整张壳收起 ——
 * 刚生成的立绘、sprite、贴图跟着一起看不见了。用户原话:「生成出来的图片、sprite
 * 这些东西能直接展示出来」。所以图片要在壳**外面**再出现一次,而且不随壳收起。
 *
 * ── 认什么(检测规则,session 7「agent 自主生图」要对齐的就是这一节)──────────
 *
 * 只认**这一轮事件里的生成证据**,三条,按先后去重(同一路径只出一格):
 *
 *   ① 生图行的完成格 —— `buildTurnBlocks` 产出的 `ImageRow`(`surface === 'image'`)里
 *      `status === 'done'` 且带 `path` 的格子;没有 `cells` 时退回 `thumbs`。
 *      生图行自己的判据在 `build-turn-blocks.ts` 的 `readImageCall`:
 *        · 命令工具(Bash / PowerShell …)的命令里含 `media generate`,且不带 `--help`;
 *        · 结果按**逐行 JSON** 读:`status` 为 done/succeeded/completed/ok 的行算一张,
 *          路径取 `file.name`,其次 `path` / `file` / `outputPath` / `url`;
 *        · daemon 的媒体任务(`/api/projects/:id/media/tasks`,`runId` 对得上)优先于
 *          命令输出:`task.file.name` 是那一格的路径,`batchId/batchIndex/batchSize`
 *          决定格子数与位置;
 *        · 结果是交棒行时读这一轮 `media wait` 等到的结局(`{"file":…}` 算一张);
 *        · 结果被打码、但入参带 `file_path` 的单张生成,用那个 `file_path`。
 *      托管生图(OpenPixo 积分)走同一条 `pixo media generate` / 媒体任务管线,不另立判据。
 *   ② 写图片文件的工具行 —— `ToolRow.tool` 为 write / edit、`file` 的后缀是图片、
 *      调用已经回来且没失败,路径要能正面证明属于当前项目(`openableRecordFilePath`)。
 *   ③ 轮末的快照(`withCheckpointAssets`,2026-11-06 加):这一轮新增或改过的媒体文件。
 *      脚本写出来的图(`python make_sprite.py`)事件里没有证据,但文件系统差集说得清。
 *      `producedFiles` 仍不进这里;本模块把这里出过的图从产物卡里**摘掉**
 *      (`withoutGalleryImages`),免得同一张图上下各画一次。
 *
 * 只收**已经出来**的图。还在生成的格子、失败的格子留在执行记录的生图行里:那里有
 * 进度、有重试;这里只回答「这一轮已经做出了什么」。
 */
import { resolveChatFileLink } from '../in-project-link';
import type { ExecutionShell, ImageRow, ShellItem, ToolRow, TurnBlock } from './contract';
import { openableRecordFilePath, type RecordFileScope } from './record-file-open';

/** 浏览器 `<img>` 能直接画的图片后缀 */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i;
/** 浏览器能直接放的音频、视频后缀 */
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|flac|aac|opus)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
/** 自带贴图的二进制 glTF,一个文件就能画出来 */
const MODEL3D_EXT = /\.glb$/i;

export function isGalleryImagePath(path: string): boolean {
  return IMAGE_EXT.test(path.split(/[?#]/)[0] ?? '');
}

export type TurnAssetKind = 'image' | 'audio' | 'video' | 'model3d';

function assetKindOf(path: string): TurnAssetKind | null {
  const clean = path.split(/[?#]/)[0] ?? '';
  if (IMAGE_EXT.test(clean)) return 'image';
  if (AUDIO_EXT.test(clean)) return 'audio';
  if (VIDEO_EXT.test(clean)) return 'video';
  if (MODEL3D_EXT.test(clean)) return 'model3d';
  return null;
}

export function isTurnMediaPath(path: string): boolean {
  return assetKindOf(path) != null;
}

export interface TurnAsset {
  /** 项目相对路径;也是去重、打开、取快照的钥匙 */
  path: string;
  /** 这个文件是怎么来的 —— 只用于测试与诊断,界面不按它分画法 */
  source: 'media' | 'write' | 'checkpoint';
  kind: TurnAssetKind;
}

/**
 * 按事件发生顺序收这一轮做出来的图。
 *
 * `blocks` 是 `buildTurnBlocks` 的输出 —— 生图行的完成判据(任务轮询 / 逐行 JSON /
 * 打码兜底)全在那一层,这里**不再判一次**,只读它的结论。
 */
export function collectTurnAssets(
  blocks: readonly TurnBlock[],
  scope?: RecordFileScope,
): TurnAsset[] {
  const out: TurnAsset[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined, source: TurnAsset['source']) => {
    const path = raw ? projectRelative(raw, scope) : null;
    const kind = path ? assetKindOf(path) : null;
    if (!path || !kind || seen.has(path)) return;
    seen.add(path);
    out.push({ path, source, kind });
  };
  const visit = (items: readonly ShellItem[]) => {
    for (const item of items) {
      if (item.kind === 'image') imageRowPaths(item).forEach((p) => push(p, 'media'));
      else if (item.kind === 'tool') push(writtenImagePath(item, scope) ?? undefined, 'write');
      else if (item.kind === 'todo') visit(item.segment.items);
    }
  };
  for (const block of blocks) {
    if (block.kind !== 'shell') continue;
    visit((block as ExecutionShell).items);
  }
  return out;
}

/**
 * 轮末补上快照里新增或改过的媒体文件:脚本、命令写出来的图和声音,事件里没有证据,
 * 但文件系统差集说得清。只补不减,排在事件证据之后。
 */
export function withCheckpointAssets(
  assets: TurnAsset[],
  changes: ReadonlyArray<{ path: string; status: string }> | null | undefined,
): TurnAsset[] {
  if (!changes?.length) return assets;
  const seen = new Set(assets.map((asset) => asset.path));
  const extra: TurnAsset[] = [];
  for (const change of changes) {
    const kind = assetKindOf(change.path);
    if (!kind || change.status === 'deleted' || seen.has(change.path) || /(^|\/)\./.test(change.path)) continue;
    extra.push({ path: change.path, source: 'checkpoint', kind });
  }
  return extra.length ? [...assets, ...extra] : assets;
}

/** 生图行里已经出来的那几张,按格子顺序 */
function imageRowPaths(row: ImageRow): string[] {
  if (row.cells?.length) {
    return row.cells.flatMap((cell) => (cell.status === 'done' && cell.path ? [cell.path] : []));
  }
  return row.thumbs;
}

/** 写 / 改了一个媒体文件、而且调用已经成功回来 */
function writtenImagePath(row: ToolRow, scope: RecordFileScope | undefined): string | null {
  if (row.pending || row.failed || !row.file) return null;
  if (!assetKindOf(row.file.path)) return null;
  return openableRecordFilePath(row, scope);
}

/**
 * 生图输出的路径收成项目相对路径。
 *
 * 相对路径以项目工作目录为根,原样用(去掉 `./`);绝对路径只认项目根前缀这一条
 * 正面证据 —— 和执行记录里文件名做链接是同一个判官(`resolveChatFileLink`),
 * 证明不了就不收:一张打不开、也取不到预览的图,不如不摆。
 */
function projectRelative(raw: string, scope: RecordFileScope | undefined): string | null {
  const path = raw.trim().replace(/\\/g, '/');
  if (!path || /^(https?:|data:|blob:)/i.test(path)) return null;
  const absolute = /^([A-Za-z]:\/|\/)/.test(path);
  if (!absolute) return path.replace(/^\.\//, '');
  const target = resolveChatFileLink(path, undefined, scope?.projectId, scope?.projectResolvedDir);
  return target?.kind === 'workspace-file' ? target.filePath : null;
}

/**
 * 产物卡里摘掉缩略图那一排已经画过的图片,别的条目原样保留。
 *
 * 只摘图片:同一轮写出的 html / 音频仍是产物卡的事。没有交集时返回**同一个数组**,
 * 让上游的 `useMemo` 依赖不白白翻新。
 */
export function withoutGalleryImages<T extends { path: string }>(
  entries: T[],
  assets: readonly TurnAsset[],
): T[] {
  if (assets.length === 0) return entries;
  const shown = new Set(assets.map((asset) => asset.path));
  const kept = entries.filter((entry) => !(isTurnMediaPath(entry.path) && shown.has(entry.path.replace(/^\.\//, ''))));
  return kept.length === entries.length ? entries : kept;
}
