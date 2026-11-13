import { expect, it } from 'vitest';
import { storeDownloadResponse } from '../../src/account/credits.js';
import { parsePackManifest, PackInstallError } from '../../src/store/pack-install.js';

const grant = (baseUrl: string, extra: Record<string, unknown> = {}) => ({ itemName: 'openpixo/slime-monster-pack', version: '1.0.0',
  baseUrl, token: 't.k', expiresAt: '2026-11-13T00:15:00.000Z', ...extra });

it('accepts only the pack’s own folder on https, or on a local Worker', () => {
  expect(storeDownloadResponse(grant('https://play.example/__pack/slime-monster-pack/1.0.0'), 'openpixo/slime-monster-pack', '1.0.0').baseUrl)
    .toBe('https://play.example/__pack/slime-monster-pack/1.0.0');
  expect(storeDownloadResponse(grant('http://localhost:8787/__pack/slime-monster-pack/1.0.0'), 'openpixo/slime-monster-pack', '1.0.0')).toBeTruthy();
  for (const url of ['http://play.example/__pack/slime-monster-pack/1.0.0', 'https://play.example/__pack/fantasy-item-icons/1.0.0',
    'https://play.example/__pack/slime-monster-pack/1.0.1', 'https://play.example/elsewhere', 'https://u:p@play.example/__pack/slime-monster-pack/1.0.0',
    'https://play.example/__pack/slime-monster-pack/1.0.0?x=1', 'not a url']) {
    expect(() => storeDownloadResponse(grant(url), 'openpixo/slime-monster-pack', '1.0.0'), url).toThrow();
  }
  expect(() => storeDownloadResponse(grant('https://play.example/__pack/slime-monster-pack/1.0.0', { itemName: 'openpixo/other' }),
    'openpixo/slime-monster-pack', '1.0.0')).toThrow();
});

it('refuses a pack file list with unsafe paths, wrong names or missing descriptions before downloading anything', () => {
  const file = { path: 'pieces/a.png', size: 1, sha256: 'a'.repeat(64), kind: 'icon', title: 'A', use: 'Icon.' };
  const manifest = (files: unknown[], extra: Record<string, unknown> = {}) => ({ schema: 1, name: 'openpixo/slime-monster-pack', version: '1.0.0',
    title: 'Slimes', license: 'x', commercialUse: true, attributionRequired: false, animations: [], files, ...extra });
  expect(parsePackManifest(manifest([file]), 'openpixo/slime-monster-pack', '1.0.0').files).toHaveLength(1);
  for (const bad of [
    manifest([{ ...file, path: '../escape.png' }]), manifest([{ ...file, path: '/abs.png' }]), manifest([{ ...file, path: 'C:/x.png' }]),
    manifest([{ ...file, path: 'pieces/run.exe' }]), manifest([{ ...file, path: '.hidden/a.png' }]), manifest([{ ...file, path: 'pack.json' }]),
    manifest([file, { ...file, path: 'PIECES/A.png' }]), manifest([{ ...file, sha256: 'nothex' }]), manifest([{ ...file, size: -1 }]),
    manifest([{ ...file, title: undefined }]), manifest([]), manifest([file], { name: 'openpixo/other' }), manifest([file], { schema: 2 }),
  ]) {
    expect(() => parsePackManifest(bad, 'openpixo/slime-monster-pack', '1.0.0'), JSON.stringify(bad.files)).toThrow(PackInstallError);
  }
});
