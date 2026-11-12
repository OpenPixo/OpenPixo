import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Button } from '@openpixo/components';
import { useT } from '../../../i18n';
import { Icon } from '../../Icon';

/** 复制一段文字,按钮上就地说「已复制」,不弹 toast —— 这里是一行小工具,不是一件事 */
export function CopyButton({ text, label, className }: { text: string; label?: string; className?: string }): ReactElement {
  const t = useT();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const shown = state === 'copied' ? t('chat.code.copied') : state === 'failed' ? t('chat.code.copyFailed') : (label ?? t('chat.code.copy'));
  return (
    <Button
      size="sm"
      variant="ghost"
      className={className}
      data-testid="chat-code-copy"
      data-state={state}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        clearTimeout(timer.current);
        void navigator.clipboard.writeText(text).then(
          () => setState('copied'),
          () => setState('failed'),
        ).finally(() => { timer.current = setTimeout(() => setState('idle'), 1500); });
      }}
    >
      <Icon name={state === 'copied' ? 'check' : 'copy'} size={12} />
      {shown}
    </Button>
  );
}
