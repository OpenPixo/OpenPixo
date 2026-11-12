/**
 * 这一轮改了哪些文件 —— 消息里那块「改了 N 个文件」(`TurnChanges`)的数据。纯函数,无 DOM。
 *
 * 为什么要有它:执行记录一轮跑完就收起,工具行跟着看不见了;右侧改动视图默认不在前面。
 * 用户原话:「agent 改了代码,但在界面上看不到」。所以这件事要在消息里常驻一块。
 *
 * 事实来源两档,前面的压住后面的:
 *   ① 这一轮的快照(`ProjectCheckpoint.runChanges`):文件系统差集,脚本和命令写的文件也算。
 *      有快照的行才能点开 diff。
 *   ② 没有快照(项目太大、历史轮次):回落到执行记录的写 / 改工具行和轮末的产出。
 *      只能打开文件本身,改动量有多少报多少。
 *
 * 媒体文件不列:它们在 `AssetGallery` 里已经画过了,这里只说代码和文本。
 */
import type { ProjectCheckpoint } from '@openpixo/contracts';
import type { ShellItem, TurnBlock } from './contract';
import { openableRecordFilePath, type RecordFileScope } from './record-file-open';
import { isTurnMediaPath } from './turn-assets';

export interface TurnChangeRow {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  added: number | null;
  removed: number | null;
  /** 有它才打得开 diff;没有就只能打开文件 */
  checkpointId: string | null;
}

export interface TurnChangeTotals {
  added: number;
  removed: number;
  /** 有一行数不出来,合计就只是下限,界面不报合计 */
  complete: boolean;
}

export interface TurnChangesInput {
  blocks: readonly TurnBlock[];
  scope: RecordFileScope | undefined;
  checkpoint: ProjectCheckpoint | null;
  counts: ReadonlyMap<string, { additions: number | null; deletions: number | null }>;
  /** 轮末产出里不进卡片的那些文件(md、脚本写的代码),事件里可能没有它们 */
  producedPaths?: readonly string[];
}

function listed(path: string): boolean {
  return !isTurnMediaPath(path) && !/(^|\/)\.pixo/.test(path);
}

interface ToolChange { status: TurnChangeRow['status']; added: number | null; removed: number | null }

/** 执行记录里的写 / 改:同一个文件多次调用合成一行,改动量累加,有一次数不出来就都不报 */
function toolChanges(blocks: readonly TurnBlock[], scope: RecordFileScope | undefined): Map<string, ToolChange> {
  const out = new Map<string, ToolChange>();
  const visit = (items: readonly ShellItem[]) => {
    for (const item of items) {
      if (item.kind === 'todo') { visit(item.segment.items); continue; }
      if (item.kind !== 'tool' || item.pending || item.failed) continue;
      const path = openableRecordFilePath(item, scope);
      if (!path) continue;
      const seen = out.get(path);
      if (seen) {
        seen.added = seen.added != null && item.delta ? seen.added + item.delta.added : null;
        seen.removed = seen.removed != null && item.delta ? seen.removed + item.delta.removed : null;
      } else {
        out.set(path, {
          status: item.tool === 'write' ? 'added' : 'modified',
          added: item.delta?.added ?? null,
          removed: item.delta?.removed ?? null,
        });
      }
    }
  };
  for (const block of blocks) if (block.kind === 'shell') visit(block.items);
  return out;
}

export function turnChangeRows({ blocks, scope, checkpoint, counts, producedPaths = [] }: TurnChangesInput): TurnChangeRow[] {
  const tools = toolChanges(blocks, scope);
  const frozen = checkpoint?.runChanges ?? null;
  if (frozen) {
    return frozen.filter((change) => listed(change.path)).map((change) => {
      const count = counts.get(change.path);
      const tool = tools.get(change.path);
      return {
        path: change.path,
        status: change.status,
        added: count ? count.additions : tool?.added ?? null,
        removed: count ? count.deletions : tool?.removed ?? null,
        checkpointId: checkpoint!.id,
      };
    });
  }
  const rows: TurnChangeRow[] = [];
  for (const [path, change] of tools) {
    if (listed(path)) rows.push({ path, ...change, checkpointId: checkpoint?.id ?? null });
  }
  for (const raw of producedPaths) {
    const path = raw.replace(/^\.\//, '');
    if (listed(path) && !tools.has(path)) rows.push({ path, status: 'added', added: null, removed: null, checkpointId: checkpoint?.id ?? null });
  }
  return rows;
}

export function turnChangeTotals(rows: readonly TurnChangeRow[]): TurnChangeTotals {
  const totals: TurnChangeTotals = { added: 0, removed: 0, complete: true };
  for (const row of rows) {
    if (row.added == null || row.removed == null) { totals.complete = false; continue; }
    totals.added += row.added;
    totals.removed += row.removed;
  }
  return totals;
}
