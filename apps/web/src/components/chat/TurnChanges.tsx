/**
 * 这一轮改了哪些文件:文件名、增删行数,点一行到右侧面板看 diff。
 *
 * 不收进执行记录:记录一轮跑完就收起,而「改了什么」是跑完之后最想看的东西。
 * 只在一轮结束后出现 —— 跑着的时候执行记录是摊开的,文件行就在那里,两边一起长只会让
 * 消息一路往下推。数据与事实来源见 `runtime/chat/turn-changes.ts`。
 */
import { useState, type ReactElement } from 'react';
import { Button } from '@openpixo/components';
import { useT } from '../../i18n';
import { turnChangeTotals, type TurnChangeRow } from '../../runtime/chat/turn-changes';
import { Icon } from '../Icon';
import styles from './TurnChanges.module.css';

/** 一轮改得多时,先给够认出这轮干了什么的那几行 */
const COLLAPSED_ROWS = 5;

const STATUS_KEYS = {
  added: 'panel.changes.statusAdded',
  modified: 'panel.changes.statusModified',
  deleted: 'panel.changes.statusDeleted',
} as const;

const STATUS_LETTERS = { added: 'A', modified: 'M', deleted: 'D' } as const;

export function TurnChanges({ rows, onOpenRow, onViewAll }: {
  rows: readonly TurnChangeRow[];
  /** 打开一行;打不开的行(已删除且没有快照)不传就不可点 */
  onOpenRow?: ((row: TurnChangeRow) => void) | undefined;
  /** 整个改动视图。只有最新一轮给:改动视图的「本轮」说的就是它 */
  onViewAll?: (() => void) | undefined;
}): ReactElement | null {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;
  const totals = turnChangeTotals(rows);
  const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  const hidden = rows.length - shown.length;
  return (
    <section className={styles.changes} data-testid="chat-turn-changes" aria-label={t('chat.changes.title', { count: rows.length })}>
      <div className={styles.head}>
        <Icon name="file-code" size={14} className={styles.headIcon} />
        <span className={styles.title}>{t('chat.changes.title', { count: rows.length })}</span>
        {totals.complete ? <Counts added={totals.added} removed={totals.removed} /> : null}
        <span className={styles.spacer} />
        {onViewAll ? (
          <Button size="sm" variant="ghost" className={styles.viewAll} data-testid="chat-turn-changes-all" onClick={onViewAll}>
            {t('chat.changes.viewAll')}
          </Button>
        ) : null}
      </div>
      <ul className={styles.rows}>
        {shown.map((row) => <Row key={row.path} row={row} onOpen={onOpenRow} />)}
      </ul>
      {hidden > 0 ? (
        <button type="button" className={styles.more} onClick={() => setExpanded(true)}>
          {t('chat.changes.showMore', { count: hidden })}
        </button>
      ) : null}
    </section>
  );
}

function Counts({ added, removed }: { added: number; removed: number }): ReactElement {
  const t = useT();
  return (
    <span className={styles.counts} aria-label={t('panel.changes.lineCounts', { added, deleted: removed })}>
      <span className={styles.added}>+{added}</span> <span className={styles.removed}>−{removed}</span>
    </span>
  );
}

function Row({ row, onOpen }: { row: TurnChangeRow; onOpen: ((row: TurnChangeRow) => void) | undefined }): ReactElement {
  const t = useT();
  const slash = row.path.lastIndexOf('/');
  const dir = slash >= 0 ? row.path.slice(0, slash + 1) : '';
  const name = slash >= 0 ? row.path.slice(slash + 1) : row.path;
  // 已经删掉、又没有快照:没有东西可看,不做成按钮
  const openable = Boolean(onOpen) && (row.status !== 'deleted' || row.checkpointId != null);
  const body = (
    <>
      <span className={styles.status} data-status={row.status} title={t(STATUS_KEYS[row.status])} aria-label={t(STATUS_KEYS[row.status])}>
        {STATUS_LETTERS[row.status]}
      </span>
      <span className={styles.path}>
        {dir ? <span className={styles.dir}>{dir}</span> : null}
        <span className={styles.name}>{name}</span>
      </span>
      {row.added != null && row.removed != null ? <Counts added={row.added} removed={row.removed} /> : null}
    </>
  );
  return (
    <li>
      {openable ? (
        <button
          type="button"
          className={styles.row}
          data-status={row.status}
          title={row.path}
          data-testid={`chat-turn-change-${row.path}`}
          onClick={() => onOpen?.(row)}
        >
          {body}
        </button>
      ) : (
        <div className={styles.row} data-status={row.status} title={row.path} data-testid={`chat-turn-change-${row.path}`}>{body}</div>
      )}
    </li>
  );
}
