import { useEffect, useState } from 'react';
import { highlightTokens, type CodeToken } from '../../../runtime/shiki';

/**
 * 代码的着色结果,一行一组 token。还没算好、语言认不出、文本太长都是 null ——
 * 调用方这时候画纯文本,字宽和行高都一样,着色落下来时一行也不会动。
 */
export function useCodeTokens(code: string, language: string | null | undefined): CodeToken[][] | null {
  const [state, setState] = useState<{ key: string; lines: CodeToken[][] | null } | null>(null);
  const key = `${language ?? ''}\0${code}`;
  useEffect(() => {
    if (!language || !code) return undefined;
    let live = true;
    highlightTokens(code, language).then(
      (lines) => { if (live) setState({ key, lines }); },
      () => { /* 着色只是锦上添花,失败就留着纯文本 */ },
    );
    return () => { live = false; };
  }, [code, key, language]);
  return state?.key === key ? state.lines : null;
}
