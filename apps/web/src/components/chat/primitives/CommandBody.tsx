/**
 * 命令折叠块的正文:一条命令 + 它的输出(组件 11)。
 *
 * ⚠️ 稿子说这里「没有头、没有复制键,这不是代码块」(W3)。产品 2026-11-06 推翻了:
 * 「代码和命令输出要有语法高亮、可折叠、可复制」。所以加了颜色和一排悬停才出现的工具,
 * 但保留稿子的版式 —— 仍然是透明底、靠行首 `$` 分输入输出,不长成带框的代码块。
 */
import { memo, useState, type ReactElement } from 'react';
import { Button } from '@openpixo/components';
import { useT } from '../../../i18n';
import { languageOfCommandTool, outputLanguage } from '../../../runtime/chat/tool-preview';
import { CopyButton } from './CopyButton';
import { Tokens } from './CodeView';
import { TerminalOutput } from './TerminalOutput';
import { useCodeTokens } from './useCodeTokens';
import styles from './record.module.css';

/** 记忆化边界见 `ToolRow` 原来的说明:秒表每秒重渲,不该把几百行输出重算一遍 */
const Terminal = memo(TerminalOutput);

/** 超过这些行才给「展开」:104px 的窗装得下的不需要 */
const EXPANDABLE_OUTPUT_LINES = 6;

export function CommandBody({ command, terminal, toolName }: {
  command: string | null;
  terminal: string | null;
  toolName: string;
}): ReactElement {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const tokens = useCodeTokens(command ?? '', command ? languageOfCommandTool(toolName) : null);
  const outputLines = terminal ? terminal.split('\n').length : 0;
  return (
    <div className={styles.code} data-expanded={expanded || undefined}>
      <div className={styles.codeTools}>
        {outputLines > EXPANDABLE_OUTPUT_LINES ? (
          <Button size="sm" variant="ghost" className={styles.codeTool} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            {t(expanded ? 'chat.code.collapse' : 'chat.code.expand')}
          </Button>
        ) : null}
        {command ? <CopyButton text={command} label={t('chat.code.copyCommand')} className={styles.codeTool} /> : null}
        {terminal ? <CopyButton text={terminal} label={t('chat.code.copyOutput')} className={styles.codeTool} /> : null}
      </div>
      {command ? (
        <div className={`${styles.term} ${styles.cmd}`}>
          <div>{tokens ? tokens.map((line, index) => (
            <span key={index}>{index > 0 ? '\n' : null}<Tokens tokens={line} /></span>
          )) : command}</div>
        </div>
      ) : null}
      {terminal ? <Terminal text={terminal} language={outputLanguage(terminal)} /> : null}
    </div>
  );
}
