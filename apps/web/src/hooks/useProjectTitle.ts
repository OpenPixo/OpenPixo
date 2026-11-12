import { useEffect } from 'react';
import { PRODUCT_NAME } from '@openpixo/contracts';

export function useProjectTitle(projectName: string) {
  useEffect(() => {
    document.title = `${projectName} — ${PRODUCT_NAME}`;
    return () => { document.title = PRODUCT_NAME; };
  }, [projectName]);
}
