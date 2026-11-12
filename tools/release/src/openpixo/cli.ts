import { resolve } from "node:path";
import type { CAC } from "cac";

import { generateMetadata, type MinimumVersion } from "./metadata.ts";
import { publishRelease, rollbackRelease, setMinimumVersion } from "./publish.ts";
import { buildRegistry, generateRegistryKeypair, signRegistry } from "./registry.ts";
import { SITE_RELEASE_MANIFEST, updateSiteManifest } from "./site-manifest.ts";

type Options = {
  artifacts?: string; version?: string; channel?: string; publicOrigin?: string; dryRun?: boolean; execute?: boolean; allowUnsigned?: boolean;
  index?: string; out?: string; file?: string; manifest?: string;
  minVersion?: string; minVersionMessageEn?: string; minVersionMessageZh?: string; minVersionUrl?: string; clear?: boolean;
};

function minimumVersionFrom(options: Options): MinimumVersion | undefined {
  if (options.minVersion == null) {
    if (options.minVersionMessageEn != null || options.minVersionMessageZh != null || options.minVersionUrl != null) {
      throw new Error("--min-version-message-* and --min-version-url need --min-version");
    }
    return undefined;
  }
  const message = {
    ...(options.minVersionMessageEn != null ? { en: options.minVersionMessageEn } : {}),
    ...(options.minVersionMessageZh != null ? { "zh-CN": options.minVersionMessageZh } : {}),
  };
  return {
    min: options.minVersion,
    ...(Object.keys(message).length > 0 ? { message } : {}),
    ...(options.minVersionUrl != null ? { url: options.minVersionUrl } : {}),
  };
}

function need(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

export function registerOpenPixoCommands(cli: CAC): void {
  cli.command("openpixo <action> [subcommand]", "OpenPixo metadata|publish|rollback|set-min-version|site-manifest|registry build|sign|keygen")
    .option("--artifacts <dir>", "Flat directory of built Windows release artifacts")
    .option("--version <version>", "MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-beta.N")
    .option("--channel <channel>", "beta or stable")
    .option("--public-origin <url>", "Public download base URL (default: RELEASE_PUBLIC_ORIGIN or the OpenPixo downloads origin)")
    .option("--execute", "publish/rollback: actually write to storage (default is a dry run)")
    .option("--dry-run", "publish/rollback: print the plan without writing remote objects (the default)")
    .option("--allow-unsigned", "publish/site-manifest: accept an installer that is not Authenticode-signed (warned and recorded as signed: false)")
    .option("--min-version <version>", "metadata/set-min-version: minimum usable version; apps below it must update before they can be used")
    .option("--min-version-message-en <text>", "metadata/set-min-version: reason shown to English users")
    .option("--min-version-message-zh <text>", "metadata/set-min-version: reason shown to zh-CN users")
    .option("--min-version-url <url>", "metadata/set-min-version: manual download page (default: the app's own download page)")
    .option("--clear", "set-min-version: remove the minimum version from the live feed")
    .option("--manifest <path>", `site-manifest: download-page manifest to update, ${SITE_RELEASE_MANIFEST} in the website repository (required)`)
    .option("--index <file>", "Registry input JSON; item paths resolve relative to this file")
    .option("--out <dir>", "Registry output root (v1/ is public; paid/ is private)")
    .option("--file <path>", "Exact marketplace.json file to sign")
    .example("openpixo metadata --artifacts <dir> --version 0.2.0 --channel stable")
    .example("openpixo publish --artifacts <dir> --version 0.2.0 --channel stable")
    .example("openpixo publish --artifacts <dir> --version 0.2.0 --channel stable --execute")
    .example("openpixo metadata --artifacts <dir> --version 0.2.1 --channel stable --min-version 0.2.1 --min-version-message-zh <text>")
    .example("openpixo set-min-version --channel stable --min-version 0.2.1 --execute")
    .example("openpixo set-min-version --channel stable --clear --execute")
    .example("openpixo registry build --index <index.json> --out <dir>")
    .action(async (action: string, subcommand: string | undefined, options: Options) => {
      if (action === "registry") {
        if (subcommand === "build") {
          const result = buildRegistry({ indexPath: need(options.index, "--index"), outDir: need(options.out, "--out") });
          console.log(`built ${result.plugins.length} registry items`);
        } else if (subcommand === "sign") {
          signRegistry(need(options.file, "--file"));
          console.log(`signed ${options.file}.sig`);
        } else if (subcommand === "keygen") {
          console.log(JSON.stringify(generateRegistryKeypair(), null, 2));
        } else throw new Error("registry subcommand must be build, sign, or keygen");
        return;
      }
      if (subcommand) throw new Error(`unexpected argument: ${subcommand}`);
      if (options.execute && options.dryRun) throw new Error("--execute and --dry-run are mutually exclusive");
      const dryRun = options.execute !== true;
      if (action === "set-min-version") {
        const minimumVersion = minimumVersionFrom(options);
        if (options.clear === true ? minimumVersion != null : minimumVersion == null) {
          throw new Error("set-min-version takes either --min-version or --clear");
        }
        await setMinimumVersion({ channel: need(options.channel, "--channel"), minimumVersion: minimumVersion ?? null, dryRun });
        return;
      }
      const version = need(options.version, "--version");
      const channel = need(options.channel, "--channel");
      if (action === "metadata") {
        const metadata = await generateMetadata({
          artifactsDir: need(options.artifacts, "--artifacts"), version, channel,
          publicOrigin: options.publicOrigin || process.env.RELEASE_PUBLIC_ORIGIN || undefined,
          minimumVersion: minimumVersionFrom(options),
        });
        console.log(`wrote ${options.artifacts}/metadata.json and SHA256SUMS.txt (installer signed: ${metadata.platforms.win.signed})`);
        if (metadata.control != null) {
          console.warn(`WARNING: apps below ${metadata.control.app.version.min} on the ${channel} channel will have to update before they can be used.`);
        }
      } else if (action === "publish") {
        await publishRelease({ artifactsDir: need(options.artifacts, "--artifacts"), version, channel, dryRun, allowUnsigned: options.allowUnsigned === true });
      } else if (action === "rollback") {
        await rollbackRelease({ version, channel, dryRun });
      } else if (action === "site-manifest") {
        const manifestPath = resolve(need(options.manifest, "--manifest"));
        const manifest = updateSiteManifest({
          artifactsDir: need(options.artifacts, "--artifacts"), version, channel, manifestPath, allowUnsigned: options.allowUnsigned === true,
        });
        if (manifest.current?.signed === false) console.warn("WARNING: the download page will list an UNSIGNED build, labelled as such.");
        console.log(`site manifest ${manifestPath} now lists ${manifest.current?.version}; run "npm run generate" in the website repository and review before deploying`);
      } else throw new Error("openpixo action must be metadata, publish, rollback, set-min-version, site-manifest, or registry");
    });
}
