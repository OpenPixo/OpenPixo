import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('uses shared confirmation spacing and removes the dedicated modal chrome', () => {
 const shared = readFileSync(new URL('../../../../packages/components/src/dialog.module.css', import.meta.url), 'utf8');
 const local = readFileSync(new URL('../../src/styles/viewer/templates-plugins.css', import.meta.url), 'utf8');
 expect(shared).toMatch(/:where\(\.dialog\)[\s\S]*?padding: 24px/);
 expect(shared).toMatch(/\.footer\s*\{[^}]*gap: 8px/);
 expect(local).not.toContain('.plugin-share-confirm__panel');
 expect(local).not.toContain('.plugin-share-confirm .plugin-details-modal__foot');
});
