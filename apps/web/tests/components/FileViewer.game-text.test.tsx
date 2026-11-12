// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { buildReactComponentSrcdoc } = vi.hoisted(() => ({
  buildReactComponentSrcdoc: vi.fn(() => '<!doctype html><title>React preview</title>'),
}));

vi.mock('../../src/runtime/react-component', () => ({ buildReactComponentSrcdoc }));
vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return { ...actual, fetchProjectFiles: vi.fn(async () => []) };
});

import { FileViewer } from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';

function file(name: string, kind: ProjectFile['kind'] = 'binary'): ProjectFile {
  return {
    name,
    path: name,
    type: 'file',
    kind,
    mime: 'application/octet-stream',
    size: 128,
    mtime: 1710000000,
  };
}

function serveSource(source: string) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(source, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment',
    },
  })));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('FileViewer game text files', () => {
  it.each(['player.gd', 'main.tscn', 'project.godot'])(
    'opens %s as text even when metadata and the raw response say binary',
    async (name) => {
      const source = '[game_file]\nname="My Game"';
      serveSource(source);

      render(<FileViewer projectId="project-1" projectKind="prototype" file={file(name)} />);

      expect(await screen.findByText(source, { normalizer: (value) => value })).toBeTruthy();
      expect(screen.queryByText(/binary file/i)).toBeNull();
    },
  );

  it('opens a Tiled .tsx tileset as XML instead of building a React preview', async () => {
    const source = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- Tileset -->\n<tileset name="terrain" tilewidth="16" tileheight="16"/>';
    serveSource(source);

    render(<FileViewer projectId="project-1" projectKind="prototype" file={file('terrain.tsx', 'code')} />);

    expect(await screen.findByText(source, { normalizer: (value) => value })).toBeTruthy();
    expect(screen.queryByTestId('react-component-preview-frame')).toBeNull();
    expect(buildReactComponentSrcdoc).not.toHaveBeenCalled();
  });

  it('keeps the React preview for a TypeScript JSX component', async () => {
    const source = 'export default function App() { return <main>Game</main>; }';
    serveSource(source);

    render(<FileViewer projectId="project-1" projectKind="prototype" file={file('App.tsx', 'code')} />);

    expect(await screen.findByTestId('react-component-preview-frame')).toBeTruthy();
    expect(buildReactComponentSrcdoc).toHaveBeenCalledWith(source, { title: 'App' });
  });
});

it('navigates to the actual JSON source line without pretty-printing its positions', async () => {
  const scroll = vi.fn();
  vi.stubGlobal('scrollIntoView', scroll);
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  serveSource('{"speed": 220,\n"jump": 400}\n');
  const view = render(<FileViewer projectId="project-1" projectKind="prototype" file={file('tuning.json', 'code')} sourceLineRequest={{ line: 2, nonce: 1 }} />);
  const line = await screen.findByText('"jump": 400}');
  expect(line.getAttribute('data-source-line')).toBe('2');
  expect(line.getAttribute('data-highlighted')).toBe('true');
  expect(scroll).toHaveBeenCalledWith({ block: 'center' });
  view.rerender(<FileViewer projectId="project-1" projectKind="prototype" file={file('tuning.json', 'code')} sourceLineRequest={{ line: 2, nonce: 2 }} />);
  expect(scroll).toHaveBeenCalledTimes(2);
});
