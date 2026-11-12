// @vitest-environment jsdom
// PluginShareMenu — plugin actions affordance contract.
//
// Locks the popover behaviour users expect from a plugin-specific
// actions button on a detail modal: copy install command / plugin id /
// README badge land on the clipboard, and the popover surfaces source +
// homepage links when the manifest carries them.

import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { InstalledPluginRecord } from '@openpixo/contracts';

import { PluginShareMenu } from '../../src/components/plugin-details/PluginShareMenu';
import { I18nProvider, type Locale } from '../../src/i18n';

interface MakeArgs {
  id: string;
  title?: string;
  source?: string;
  sourceKind?: InstalledPluginRecord['sourceKind'];
  marketplaceId?: string;
  marketplaceEntryName?: string;
  authorUrl?: string;
  homepage?: string;
}

function make(args: MakeArgs): InstalledPluginRecord {
  return {
    id: args.id,
    title: args.title ?? args.id,
    version: '0.1.0',
    sourceKind: args.sourceKind ?? 'bundled',
    source: args.source ?? `plugins/${args.id}`,
    sourceMarketplaceId: args.marketplaceId,
    sourceMarketplaceEntryName: args.marketplaceEntryName,
    trust: 'bundled',
    capabilitiesGranted: [],
    manifest: {
      name: args.id,
      version: '0.1.0',
      title: args.title ?? args.id,
      ...(args.authorUrl ? { author: { url: args.authorUrl } } : {}),
      ...(args.homepage ? { homepage: args.homepage } : {}),
      pixo: { kind: 'scenario' },
    },
    fsPath: '/tmp',
    installedAt: 0,
    updatedAt: 0,
  };
}

describe('PluginShareMenu', () => {
  let container: HTMLDivElement;
  let root: Root;
  let writes: string[];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    writes = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async (value: string) => {
          writes.push(value);
        }),
      },
    });
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        origin: 'https://example.test',
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderMenu(record: InstalledPluginRecord, locale?: Locale) {
    act(() => {
      root.render(
        locale ? (
          <I18nProvider initial={locale}>
            <PluginShareMenu record={record} />
          </I18nProvider>
        ) : (
          <PluginShareMenu record={record} />
        ),
      );
    });
  }

  function openPopover(expectedTriggerText = 'More') {
    const trigger = container.querySelector(
      '.plugin-share-trigger',
    ) as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toContain(expectedTriggerText);
    act(() => {
      trigger.click();
    });
  }

  function clickItem(label: string) {
    const items = Array.from(
      container.querySelectorAll('.plugin-share-item'),
    ) as HTMLButtonElement[];
    const match = items.find((b) => b.textContent?.includes(label));
    expect(match, `expected an item labelled "${label}"`).toBeTruthy();
    act(() => {
      match!.click();
    });
  }

  it('copies an install command for marketplace plugins using the registry entry name', async () => {
    renderMenu(
      make({
        id: 'mp-plugin',
        sourceKind: 'github',
        source: 'github:example-author/plugins/mp-plugin',
        marketplaceId: 'official',
        marketplaceEntryName: 'example-author/mp-plugin',
      }),
    );
    openPopover();
    clickItem('Copy install command');
    await Promise.resolve();
    expect(writes).toContain(`${PRODUCT_CLI_NAME} plugin install example-author/mp-plugin`);
  });

  it('copies the github source string for github-installed plugins', async () => {
    renderMenu(
      make({
        id: 'gh-plugin',
        sourceKind: 'github',
        source: 'github:owner/repo@main/sub',
      }),
    );
    openPopover();
    clickItem('Copy install command');
    await Promise.resolve();
    expect(writes).toContain(`${PRODUCT_CLI_NAME} plugin install github:owner/repo@main/sub`);
  });

  

  it('copies the bare plugin id for paste-into-yaml workflows', async () => {
    renderMenu(make({ id: 'agentic-ds' }));
    openPopover();
    clickItem('Copy plugin ID');
    await Promise.resolve();
    expect(writes).toContain('agentic-ds');
  });

  

  

  it('localizes the plugin action menu labels', () => {
    renderMenu(
      make({
        id: 'zh-plugin',
        sourceKind: 'github',
        source: 'github:owner/repo',
        marketplaceId: 'official',
        marketplaceEntryName: 'example-author/zh-plugin',
        homepage: 'https://example.test/plugin-home',
      }),
      'zh-CN',
    );
    openPopover('更多');
    const labels = Array.from(
      container.querySelectorAll('.plugin-share-item'),
    ).map((item) => item.textContent ?? '');
    expect(labels).toContain('复制安装命令');
    expect(labels).toContain('复制插件 ID');
    expect(labels).not.toContain('复制 README 徽章');
    expect(labels).toContain('在 GitHub 打开源码');
    expect(labels).toContain('打开项目主页');
    expect(labels).toContain('在插件市场打开');
    expect(labels.some((label) => label.includes('Copy install command'))).toBe(false);
  });

  it('uses the local marketplace when no product site is configured', () => {
    renderMenu(make({ id: 'plain' }));
    openPopover();
    const items = Array.from(
      container.querySelectorAll('.plugin-share-item'),
    ) as HTMLButtonElement[];
    expect(items.some((b) => b.textContent?.includes('Open in marketplace'))).toBe(
      true,
    );
    const marketplaceLink = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a.plugin-share-item'),
    ).find((link) => link.textContent?.includes('Open in marketplace'));
    expect(marketplaceLink?.getAttribute('href')).toBe('/marketplace/plain');
  });

  it('uses the local marketplace for installed third-party catalog plugins', () => {
    renderMenu(
      make({
        id: 'community-registry-starter',
        sourceKind: 'marketplace',
        source: 'community/registry-starter',
        marketplaceId: 'community',
        marketplaceEntryName: 'community/registry-starter',
      }),
    );
    openPopover();
    const marketplaceLink = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a.plugin-share-item'),
    ).find((link) => link.textContent?.includes('Open in marketplace'));
    expect(marketplaceLink?.getAttribute('href')).toBe(
      '/marketplace/community-registry-starter',
    );
  });

  it('surfaces the GitHub source link when sourceKind is github', () => {
    renderMenu(
      make({
        id: 'gh-with-link',
        sourceKind: 'github',
        source: 'github:owner/repo',
      }),
    );
    openPopover();
    const items = Array.from(
      container.querySelectorAll('.plugin-share-item'),
    ) as HTMLElement[];
    expect(items.some((b) => b.textContent?.includes('Open source on GitHub'))).toBe(
      true,
    );
    const sourceLink = container.querySelector<HTMLAnchorElement>(
      'a.plugin-share-item[href="https://github.com/owner/repo"]',
    );
    expect(sourceLink).toBeTruthy();
  });

  it('surfaces the homepage link when manifest.homepage is set', () => {
    renderMenu(
      make({
        id: 'with-homepage',
        sourceKind: 'local',
        homepage: 'https://example.test/plugin-home',
      }),
    );
    openPopover();
    const items = Array.from(
      container.querySelectorAll('.plugin-share-item'),
    ) as HTMLElement[];
    expect(items.some((b) => b.textContent?.includes('Open homepage'))).toBe(
      true,
    );
    const homepageLink = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a.plugin-share-item'),
    ).find((link) => link.textContent?.includes('Open homepage'));
    expect(homepageLink).toBeTruthy();
    expect(homepageLink?.getAttribute('href')).toBe('https://example.test/plugin-home');
  });
  it('does not render empty repository or badge destinations for bundled plugins', () => {
    renderMenu(make({ id: 'bundled-plugin' }));
    openPopover();
    const links = [...container.querySelectorAll<HTMLAnchorElement>('a')];
    expect(links.every(link => Boolean(link.getAttribute('href')))).toBe(true);
    expect(container.textContent).not.toContain('Open source on GitHub');
    expect(container.textContent).not.toContain('Copy README badge');
  });
});
