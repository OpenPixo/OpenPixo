import { useEffect } from 'react';
import { openGenerate } from '../../state/store';

/** Art styles, recipes and character cards moved out of the Workshop into 生成; old links land there. */
export function GenerateRedirect() {
  useEffect(() => { openGenerate(undefined, true); }, []);
  return null;
}
