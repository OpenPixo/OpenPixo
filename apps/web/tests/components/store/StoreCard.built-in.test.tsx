// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoreCatalogItem } from '@openpixo/contracts';
import { I18nProvider } from '../../../src/i18n';
import { StoreCard } from '../../../src/components/store/StoreCard';

afterEach(cleanup);

const skill: StoreCatalogItem = {
  name: 'openpixo/game-ui-hud', version: '0.1.0', kind: 'skill', license: 'Apache-2.0',
  title: 'Game HUD, menus and input focus', description: 'HUD and menus for Godot 4 and Phaser 3.',
  engines: ['godot', 'unity', 'phaser'], pricing: { type: 'free' },
};

function card(item: StoreCatalogItem) {
  render(<I18nProvider initial="en"><StoreCard item={item} onInstall={() => {}} /></I18nProvider>);
}

describe('Workshop skill card', () => {
  it('names every engine, so a Phaser skill does not read as Godot and Unity only', () => {
    card(skill);
    for (const engine of ['godot', 'unity', 'phaser']) expect(screen.getByText(engine)).toBeTruthy();
  });

  it('offers no install for a skill the agent already uses, and says it is built in', () => {
    card({ ...skill, builtIn: { skillId: 'game-ui-hud', enabled: true } });
    expect(screen.queryByRole('button', { name: /install/i })).toBeNull();
    expect(screen.getByText('Built in')).toBeTruthy();
  });

  it('says when a built-in skill was switched off', () => {
    card({ ...skill, builtIn: { skillId: 'game-ui-hud', enabled: false } });
    expect(screen.getByText('Built in · off')).toBeTruthy();
  });

  it('still offers install for a skill that only the Workshop has', () => {
    card(skill);
    expect(screen.getByRole('button', { name: /install/i })).toBeTruthy();
  });
});
