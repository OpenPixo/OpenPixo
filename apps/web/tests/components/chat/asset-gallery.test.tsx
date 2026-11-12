// @vitest-environment jsdom
/**
 * 消息里那排本轮生成的图片(`chat/AssetGallery`),以及它在 `AssistantMessage` 里的位置:
 * 不收进执行记录、重开会话一样出现、和产物卡不重复。
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PersistedAgentEvent, ProjectAsset } from '@openpixo/contracts';
import { AssistantMessage } from '../../../src/components/AssistantMessage';
import { AssetGallery, galleryFrames } from '../../../src/components/chat/AssetGallery';
import type { ChatMessage, ProjectFile } from '../../../src/types';

beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => store.delete(key),
      setItem: (key: string, value: string) => store.set(key, value),
    },
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const src = (path: string) => `/raw/${path}`;

describe('AssetGallery', () => {
  it('renders one tile per image and opens the viewer on click', () => {
    const onOpenFile = vi.fn();
    render(
      <AssetGallery
        assets={[{ path: 'assets/hero.png', source: 'media', kind: 'image' }, { path: 'assets/coin.png', source: 'media', kind: 'image' }]}
        projectId="p1"
        imageSrc={src}
        onOpenFile={onOpenFile}
      />,
    );
    const gallery = screen.getByTestId('chat-asset-gallery');
    expect(within(gallery).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByTestId('chat-asset-assets/hero.png').querySelector('img')?.getAttribute('src')).toBe('/raw/assets/hero.png');

    fireEvent.click(screen.getByTestId('chat-asset-assets/coin.png'));
    const viewer = screen.getByRole('dialog');
    expect(within(viewer).getByText('coin.png')).toBeTruthy();
    expect(within(viewer).getByText(/2 of 2/)).toBeTruthy();

    fireEvent.click(within(viewer).getByRole('button', { name: 'Previous image' }));
    expect(within(viewer).getByText('hero.png')).toBeTruthy();

    fireEvent.click(within(viewer).getByRole('button', { name: 'Open in files' }));
    expect(onOpenFile).toHaveBeenCalledWith('assets/hero.png');
  });

  it('renders nothing for an empty turn', () => {
    const { container } = render(<AssetGallery assets={[]} projectId="p1" imageSrc={src} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('galleryFrames', () => {
  const asset = (width: number, height: number, semantics: ProjectAsset['semantics'] = []) => ({ width, height, semantics });

  it('plays declared frames (Aseprite / TexturePacker JSON) with their durations', () => {
    const frames = [0, 1, 2].map((i) => ({ x: i * 16, y: 0, width: 16, height: 16, durationMs: 90 }));
    expect(galleryFrames(asset(48, 16, [{ type: 'sprite-sheet', source: 'a.json', frames }]))).toEqual(frames);
  });

  it('plays a strip of three or more square cells without metadata', () => {
    expect(galleryFrames(asset(96, 32))?.length).toBe(3);
  });

  it('does not guess a two-cell banner is a sprite', () => {
    expect(galleryFrames(asset(64, 32))).toBeNull();
  });

  it('a plain square image is a picture, not a sprite', () => {
    expect(galleryFrames(asset(96, 96))).toBeNull();
  });
});

describe('AssistantMessage shows the images a turn generated', () => {
  const generate = 'pixo media generate --surface image --prompt a && pixo media generate --surface image --prompt b';
  const events: PersistedAgentEvent[] = [
    { kind: 'tool_use', id: 'g1', name: 'Bash', input: { command: generate } },
    {
      kind: 'tool_result',
      toolUseId: 'g1',
      isError: false,
      content: [
        JSON.stringify({ status: 'done', file: { name: 'assets/hero.png' } }),
        JSON.stringify({ status: 'done', file: { name: 'assets/grass.png' } }),
      ].join('\n'),
    },
    { kind: 'text', text: '生成好了。' },
  ];

  function produced(name: string): ProjectFile {
    return { name, path: name, type: 'file', size: 10, mtime: 1, kind: 'image', mime: 'image/png' } as ProjectFile;
  }

  function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
    return {
      id: 'a1',
      role: 'assistant',
      content: '生成好了。',
      runStatus: 'succeeded',
      startedAt: 1,
      endedAt: 9,
      events,
      ...overrides,
    } as ChatMessage;
  }

  it('outside the (collapsed) execution record, restored from persisted events', () => {
    render(<AssistantMessage message={message()} streaming={false} projectId="p1" />);
    const gallery = screen.getByTestId('chat-asset-gallery');
    expect(within(gallery).getByTestId('chat-asset-assets/hero.png')).toBeTruthy();
    expect(within(gallery).getByTestId('chat-asset-assets/grass.png')).toBeTruthy();
  });

  it('reads the turn snapshot when the daemon captured one', () => {
    const snapshot = '/api/projects/p1/chat-artifact-snapshots/s1/content';
    const artifactRefs = [{ label: 'assets/hero.png', snapshotState: 'ready', displayPolicy: 'immutable_snapshot', snapshotUrl: snapshot }];
    render(<AssistantMessage message={message({ artifactRefs } as Partial<ChatMessage>)} streaming={false} projectId="p1" />);
    expect(screen.getByTestId('chat-asset-assets/hero.png').querySelector('img')?.getAttribute('src')).toBe(snapshot);
  });

  it('takes the shown images out of the artifact cards, and leaves the rest there', () => {
    render(
      <AssistantMessage
        message={message({ producedFiles: [produced('assets/hero.png'), produced('assets/other.png')] })}
        streaming={false}
        projectId="p1"
      />,
    );
    expect(screen.queryByTestId('artifact-card-assets/hero.png')).toBeNull();
    expect(screen.getByTestId('artifact-card-assets/other.png')).toBeTruthy();
  });
});
