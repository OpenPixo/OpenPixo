/**
 * 工具行展开后的代码块:文件路径 + 复制 + 带颜色的代码 / 改动。
 *
 * 长内容不撑爆聊天:正文限高自己滚,而且只画前 `MAX_LINES` 行 —— 一次写入几千行时
 * 聊天里没人逐行读,完整内容一键到面板。行内的着色按整段算一次,算好之前是纯文本,
 * 字宽行高不变,所以展开时不会跳。
 */
import { useMemo, type ReactElement, type ReactNode } from 'react';
import { Button } from '@openpixo/components';
import { useT } from '../../../i18n';
import type { CodeLine } from '../../../runtime/chat/contract';
import type { CodeToken } from '../../../runtime/shiki';
import { CopyButton } from './CopyButton';
import { useCodeTokens } from './useCodeTokens';
import styles from './CodeView.module.css';

const MAX_LINES = 400;

export interface CodeViewProps {
  path: string;
  language: string | null;
  lines: readonly CodeLine[];
  copyText: string;
  /** 到右侧面板看完整改动;打不开就不给 */
  onOpen?: (() => void) | undefined;
  openLabel?: string | undefined;
}

export function CodeView({ path, language, lines, copyText, onOpen, openLabel }: CodeViewProps): ReactElement {
  const t = useT();
  const shown = useMemo(() => lines.slice(0, MAX_LINES), [lines]);
  const hidden = lines.length - shown.length;
  const code = useMemo(() => shown.map((line) => line.text).join('\n'), [shown]);
  const tokens = useCodeTokens(code, language);
  return (
    <div className={styles.view} data-testid="chat-code-view">
      <div className={styles.head}>
        <span className={styles.path} title={path}>{path}</span>
        {onOpen ? <Button size="sm" variant="ghost" className={styles.action} onClick={onOpen}>{openLabel}</Button> : null}
        <CopyButton text={copyText} className={styles.action} />
      </div>
      <div className={styles.body} tabIndex={0}>
        {shown.map((line, index) => (
          <Line key={index} line={line} tokens={tokens?.[index]} />
        ))}
        {hidden > 0 ? <div className={styles.more}>{t('chat.code.moreLines', { count: hidden })}</div> : null}
      </div>
    </div>
  );
}

function Line({ line, tokens }: { line: CodeLine; tokens: CodeToken[] | undefined }): ReactElement {
  if (line.kind === 'gap') return <div className={styles.gap} aria-hidden />;
  const sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : line.kind === 'context' ? ' ' : null;
  return (
    <div className={styles.line} data-kind={line.kind}>
      {sign != null ? <span className={styles.sign} aria-hidden>{sign}</span> : null}
      <code className={styles.text}>{tokens ? <Tokens tokens={tokens} /> : line.text || ' '}</code>
    </div>
  );
}

export function Tokens({ tokens }: { tokens: readonly CodeToken[] }): ReactElement {
  const parts: ReactNode[] = tokens.map((token, index) => (
    <span key={index} style={token.color ? { color: token.color } : undefined}>{token.content}</span>
  ));
  return <>{parts.length ? parts : ' '}</>;
}
