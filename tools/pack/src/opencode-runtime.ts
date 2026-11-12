import { chmod, cp, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export const OPEN_CODE_TREE_ENV = 'PIXO_OPENCODE_DIR';
const OPEN_CODE_PACKAGE = 'opencode-ai';

type OpenCodeOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  resolvePackage?: (specifier: string, from?: string) => string;
  requireBundled?: boolean;
};

export type OpenCodeDistribution = {
  source: string;
  packageName: string | null;
  version: string | null;
  notices: Array<{ source: string; target: string }>;
};

async function packageNotices(manifestPath: string, packageName: string): Promise<OpenCodeDistribution['notices']> {
  const root = dirname(manifestPath);
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter(entry => entry.isFile() && /^(licen[sc]e|notice)([.-].*)?$/i.test(entry.name))
    .map(entry => ({ source: join(root, entry.name), target: join('licenses', packageName, entry.name) }));
}

/** Resolve the build target, independently of the packaging host's CPU features. */
export async function resolveOptionalOpenCodeDistribution({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  resolvePackage = (specifier, from) => createRequire(from ?? import.meta.url).resolve(specifier),
  requireBundled = false,
}: OpenCodeOptions = {}): Promise<OpenCodeDistribution | null> {
  try {
    const override = env[OPEN_CODE_TREE_ENV]?.trim();
    const binaryName = platform === 'win32' ? 'opencode.exe' : 'opencode';
    let distribution: OpenCodeDistribution;
    if (override) {
      distribution = { source: override, packageName: null, version: null, notices: [] };
    } else {
      const npmPlatforms: Partial<Record<NodeJS.Platform, string>> = { win32: 'windows', darwin: 'darwin', linux: 'linux' };
      const npmPlatform = npmPlatforms[platform];
      if (!npmPlatform || (arch !== 'x64' && arch !== 'arm64')) {
        throw new Error(`Unsupported OpenCode target ${platform}-${arch}`);
      }
      // Distributable x64 installers must also run on CPUs without AVX2.
      // AppImage targets glibc; custom musl trees use the explicit override.
      const packageName = `opencode-${npmPlatform}-${arch}${arch === 'x64' ? '-baseline' : ''}`;
      const manifestPath = resolvePackage(`${OPEN_CODE_PACKAGE}/package.json`);
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        version: string;
        optionalDependencies?: Record<string, string>;
      };
      const nativeManifestPath = resolvePackage(`${packageName}/package.json`, manifestPath);
      const nativeManifest = JSON.parse(await readFile(nativeManifestPath, 'utf8')) as { version: string };
      if (nativeManifest.version !== manifest.version || manifest.optionalDependencies?.[packageName] !== manifest.version) {
        throw new Error(`${packageName} must match ${OPEN_CODE_PACKAGE}@${manifest.version}`);
      }
      distribution = {
        source: join(dirname(nativeManifestPath), 'bin'),
        packageName,
        version: manifest.version,
        notices: [
          ...await packageNotices(manifestPath, OPEN_CODE_PACKAGE),
          ...await packageNotices(nativeManifestPath, packageName),
        ],
      };
    }
    const binary = join(distribution.source, binaryName);
    if (!await stat(binary).then(entry => entry.isFile(), () => false)) {
      throw new Error(`OpenCode binary is missing: ${binary}`);
    }
    return distribution;
  } catch (error) {
    if (requireBundled) {
      throw new Error(`Unable to bundle official OpenCode: install ${OPEN_CODE_PACKAGE} with its target optional dependencies or set ${OPEN_CODE_TREE_ENV}`, { cause: error });
    }
    return null;
  }
}

export async function resolveOptionalOpenCodeTree(options: OpenCodeOptions = {}): Promise<string | null> {
  return (await resolveOptionalOpenCodeDistribution(options))?.source ?? null;
}

export async function copyOptionalOpenCodeTree(options: OpenCodeOptions & {
  resourceRoot: string;
}): Promise<{ source: string; target: string } | null> {
  const distribution = await resolveOptionalOpenCodeDistribution(options);
  if (!distribution) return null;
  const target = join(options.resourceRoot, 'bin', 'libexec', 'opencode');
  await mkdir(target, { recursive: true });
  await cp(distribution.source, target, { recursive: true, force: true });
  for (const notice of distribution.notices) {
    const destination = join(target, notice.target);
    await mkdir(dirname(destination), { recursive: true });
    await cp(notice.source, destination);
  }
  if ((options.platform ?? process.platform) !== 'win32') await chmod(join(target, 'opencode'), 0o755);
  return { source: distribution.source, target };
}
