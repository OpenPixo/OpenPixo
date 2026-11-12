import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AgentIcon } from '../../src/components/AgentIcon';

describe('AgentIcon', () => {
  it.each(['claude', 'codex'])('renders the retained %s runtime asset as an image', (id) => {
    const markup = renderToStaticMarkup(<AgentIcon id={id} size={24} />);
    expect(markup).toContain('src="/agent-icons/' + id + '.svg"');
    expect(markup).toContain('class="agent-icon"');
    expect(markup).toContain('aria-hidden="true"');
  });

  it.each(['opencode'])('renders %s using the themed OpenCode mark', (id) => {
    const markup = renderToStaticMarkup(<AgentIcon id={id} size={24} />);
    expect(markup).toContain('class="agent-icon agent-icon-mono"');
    expect(markup).toContain('mask-image:url(&quot;/agent-icons/opencode.svg&quot;)');
    expect(markup).not.toContain('<img');
  });

  it('keeps the Kimi model-provider asset with two-tone branding', () => {
    // kimi is a baked two-tone asset: blue accent (#1783ff) for brand identity,
    // and gray (#666666) secondary mark for contrast on both light and dark surfaces.
    // Validate the bundled asset is valid SVG with the expected fills.
    const kimiSvg = readFileSync(
      new URL('../../public/agent-icons/kimi.svg', import.meta.url),
      'utf8',
    );

    // Asset must be valid SVG (not corrupted with non-XML text).
    expect(kimiSvg).toMatch(/^<svg\b/);
    // Blue accent path must be present.
    expect(kimiSvg).toContain('fill="#1783ff"');
    // Gray secondary mark must be present (neither white nor dark-only).
    expect(kimiSvg).toContain('fill="#666666"');
    expect(kimiSvg).not.toContain('fill="#fff"');
    expect(kimiSvg).not.toContain('fill="#1c1b1a"');


  });

  it('falls back to an initial-letter pill for unknown agents', () => {
    const markup = renderToStaticMarkup(<AgentIcon id="unknown-agent" size={24} />);

    expect(markup).toContain('agent-icon-fallback');
    // Initial = first alphabetic char of the id, uppercased.
    expect(markup).toContain('>U</span>');
    // The fallback uses CSS class styling, not inline gradients.
    expect(markup).not.toContain('linear-gradient');
  });
});
