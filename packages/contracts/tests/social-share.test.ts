import { describe, expect, it } from 'vitest';
import { buildSocialSharePayload } from '../src/api/social-share';

describe('project URL sharing', () => {
  it('shares a deployed project without repository promotion', () => {
    const payload = buildSocialSharePayload({kind: 'project-html',locale: 'en',url: 'https://example.com/game-demo',title: 'Demo'});
    expect(payload.url).toBe('https://example.com/game-demo');
    expect(payload.copyText).toBe('Built with OpenPixo: Demo.\nhttps://example.com/game-demo');
    expect(payload.platforms.find(target => target.platform === 'telegram')?.shareUrl).toContain('https%3A%2F%2Fexample.com%2Fgame-demo');
    expect(payload).not.toHaveProperty('githubRepoUrl');
  });
});
