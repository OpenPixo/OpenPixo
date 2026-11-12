import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  namespaceBaseRootFromPayloadExecutable,
  PACKAGED_NAMESPACE_BASE_ROOT_ENV,
  resolvePackagedNamespaceBaseRoot,
} from '../src/config.js';

describe('resolvePackagedNamespaceBaseRoot', () => {
  it('lets a historical handoff preserve the already-resolved namespace base root', () => {
    const inheritedRoot = join('C:', 'tools-pack', 'runtime', 'namespaces');
    const bakedRoot = join('C:', 'Users', 'Sample', 'AppData', 'Roaming', 'OpenPixo', 'namespaces');

    expect(resolvePackagedNamespaceBaseRoot(bakedRoot, join('C:', 'fallback'), {
      [PACKAGED_NAMESPACE_BASE_ROOT_ENV]: inheritedRoot,
    })).toBe(resolve(inheritedRoot));
  });

  it('falls back to the payload config and then Electron userData', () => {
    const bakedRoot = join('C:', 'packaged', 'namespaces');
    const userDataRoot = join('C:', 'user-data');

    expect(resolvePackagedNamespaceBaseRoot(bakedRoot, userDataRoot, {})).toBe(resolve(bakedRoot));
    expect(resolvePackagedNamespaceBaseRoot(undefined, userDataRoot, {})).toBe(
      join(userDataRoot, 'namespaces'),
    );
  });

  it('keeps an update on the data of the install it updates, whatever the payload was built with', () => {
    const payloadExe = 'C:\\Users\\Dev\\runtime\\win\\launcher\\channels\\beta\\namespaces\\release-beta-win\\versions\\1.0.0-beta.4\\payload\\OpenPixo.exe';
    const installRoot = 'C:\\Users\\Dev\\runtime\\win\\namespaces';

    expect(namespaceBaseRootFromPayloadExecutable(payloadExe)).toBe(installRoot);
    // A public payload has no root of its own: it must not fall back to userData.
    expect(resolvePackagedNamespaceBaseRoot(undefined, 'C:\\Users\\Dev\\AppData\\Roaming\\OpenPixo', {}, payloadExe))
      .toBe(installRoot);
    expect(resolvePackagedNamespaceBaseRoot('C:\\elsewhere\\namespaces', 'C:\\user-data', {}, payloadExe))
      .toBe(installRoot);
  });

  it('leaves an installed outer app and a historical handoff to their own rules', () => {
    const outerExe = 'C:\\Users\\Dev\\AppData\\Local\\Programs\\OpenPixo\\OpenPixo.exe';
    const payloadExe = '/root/launcher/channels/beta/namespaces/ns/versions/1.0.0/payload/OpenPixo';

    expect(namespaceBaseRootFromPayloadExecutable(outerExe)).toBeNull();
    expect(namespaceBaseRootFromPayloadExecutable('payload/OpenPixo.exe')).toBeNull();
    expect(namespaceBaseRootFromPayloadExecutable(payloadExe)).toBe('/root/namespaces');
    expect(resolvePackagedNamespaceBaseRoot(undefined, join('C:', 'user-data'), {}, outerExe))
      .toBe(join('C:', 'user-data', 'namespaces'));
    expect(resolvePackagedNamespaceBaseRoot(undefined, join('C:', 'user-data'), {
      [PACKAGED_NAMESPACE_BASE_ROOT_ENV]: join('C:', 'handoff', 'namespaces'),
    }, payloadExe)).toBe(resolve(join('C:', 'handoff', 'namespaces')));
  });
});
