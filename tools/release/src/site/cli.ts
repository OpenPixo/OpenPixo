import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CAC } from "cac";

import { resolveRepoRoot } from "../catalog/export-catalog.ts";
import { parseMarketplace, readJson, readRecipe } from "./data.ts";

/**
 * What the website needs from this repository, in one file (`data/app.json`
 * in the website repository): the release notes, the official recipes and the
 * bundled Store snapshot. The website owns every page, word and price it shows;
 * this repository only says what the app ships.
 */
export interface SiteAppData {
  schema: 1;
  changelog: string;
  recipes: Record<string, unknown>[];
  marketplace: { plugins: Record<string, unknown>[] };
}

const STORE_FIELDS = ["name", "title", "description", "title_i18n", "description_i18n", "license", "pricing", "kind", "engines"] as const;

/** Drops absent and empty values, so the website's strict parser sees only real fields. */
function compact(entry: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, entry[key]] as const)
    .filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

export function exportSiteData(repoRoot: string): SiteAppData {
  const root = resolve(repoRoot);
  const recipesDir = join(root, "plugins/_official/recipes");
  const recipes = readdirSync(recipesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(recipesDir, entry.name, "pixo.json")))
    .map((entry) => entry.name).sort()
    .flatMap((name) => {
      const recipe = readRecipe(join(recipesDir, name, "pixo.json"));
      return recipe ? [compact(recipe as unknown as Record<string, unknown>, ["name", "title", "description", "title_i18n", "description_i18n", "surface", "category"])] : [];
    });
  const marketplace = readJson(join(root, "plugins/registry/official/openpixo-marketplace.json")) as { plugins?: unknown };
  // Validate with the same rules the website applies, then pass the source fields through.
  parseMarketplace(marketplace);
  const plugins = (marketplace.plugins as Record<string, unknown>[]).map((entry) => compact(entry, STORE_FIELDS));
  return { schema: 1, changelog: readFileSync(join(root, "CHANGELOG.md"), "utf8").replaceAll("\r\n", "\n"), recipes, marketplace: { plugins } };
}

export function writeSiteData(repoRoot: string, out: string): SiteAppData {
  const data = exportSiteData(repoRoot);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return data;
}

export function registerSiteCommand(cli: CAC): void {
  cli.command("site <action>", "Export what the website needs from this repository (site export --out <website>/data/app.json)")
    .option("--out <path>", "Where to write the data file: data/app.json in the website repository")
    .action((action: string, options: { out?: string }) => {
      if (action !== "export") throw new Error(`Unsupported site action: ${action}`);
      if (!options.out) throw new Error("site export needs --out <website>/data/app.json");
      // pnpm runs the script from the package folder; a relative --out means where the command was typed.
      const out = resolve(process.env.INIT_CWD ?? process.cwd(), options.out);
      const data = writeSiteData(resolveRepoRoot(), out);
      console.log(`Wrote ${out}: ${data.recipes.length} recipes, ${data.marketplace.plugins.length} Store entries and the changelog. Run "npm run generate" in the website repository next.`);
    });
}
