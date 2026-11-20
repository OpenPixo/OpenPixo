import { describe, expect, it } from 'vitest';
import { chatImageSrc } from '../../../src/runtime/chat/chat-image-src';

// 鸦堡 run (2026-11-21): Codex showed every style sample as `![label](concept/style-1.png)`,
// the chat dropped the image as an unsafe src and printed only the label, and the owner
// saw no picture all through planning.
describe('chatImageSrc', () => {
  const scope = { projectId: 'p1', projectResolvedDir: 'C:/Games/鸦堡' };

  it('serves an in-project image path from the project', () => {
    expect(chatImageSrc('concept/style-1.png', scope)).toBe('/api/projects/p1/raw/concept/style-1.png');
    expect(chatImageSrc('./art/hero sheet.webp', scope)).toBe('/api/projects/p1/raw/art/hero%20sheet.webp');
    expect(chatImageSrc('concept/鸦堡.png', scope)).toBe(`/api/projects/p1/raw/concept/${encodeURIComponent('鸦堡')}.png`);
  });

  it('serves an absolute path inside the project folder', () => {
    expect(chatImageSrc('C:/Games/鸦堡/concept/style-7.png', scope)).toBe('/api/projects/p1/raw/concept/style-7.png');
  });

  it('refuses what is not a project image', () => {
    for (const src of ['../secrets.png', 'concept/notes.md', 'javascript:alert(1)', '//evil.test/x.png', 'C:/Windows/x.png', '']) {
      expect(chatImageSrc(src, scope), src).toBeNull();
    }
    expect(chatImageSrc('concept/style-1.png', { projectId: null })).toBeNull();
  });
});
