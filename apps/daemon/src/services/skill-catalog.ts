type CatalogEntry = { id: string; dir?: string } & Record<string, unknown>;

export function createSkillCatalog<T extends CatalogEntry>({ roots, skills }: {
  roots: { skillRoots: string[]; templateRoots: string[]; allRoots: string[] };
  skills: {
    listSkills: (roots: string[]) => Promise<T[]>;
    findSkillById: (entries: T[], id: string) => T | undefined;
  };
}) {
  const scansByRoots = new Map<string, { running: Promise<unknown> | null; next: Promise<T[]> | null }>();

  /**
   * One scan per roots list at a time, and never a stale answer: a read only
   * shares a scan that has not begun yet, so whatever changed on disk before the
   * read is in its result. Reads arriving during a scan share the one after it,
   * however many there are. Each read gets its own copy of a shared result.
   */
  const listRoots = async (rootsList: string[]): Promise<T[]> => {
    const key = JSON.stringify(rootsList);
    const scans = scansByRoots.get(key) ?? { running: null, next: null };
    scansByRoots.set(key, scans);
    scans.next ??= Promise.resolve(scans.running).then(() => {
      scans.next = null;
      const scan = skills.listSkills(rootsList);
      const settled = scan.then(() => undefined, () => undefined).then(() => {
        scans.running = null;
        if (!scans.next) scansByRoots.delete(key);
      });
      scans.running = settled;
      return scan;
    });
    return structuredClone(await scans.next);
  };

  const listAllSkills = () => listRoots(roots.skillRoots);
  const listAllTemplates = () => listRoots(roots.templateRoots);
  const listAllSkillLikeEntries = () => listRoots(roots.allRoots);

  async function validateProjectSkillId(id: unknown) {
    if (id === undefined || id === null || id === '') return { ok: true as const, id: null };
    if (typeof id !== 'string') {
      return { ok: false as const, code: 'INVALID_SKILL_ID', message: 'skillId must be a string or null' };
    }
    const resolved = skills.findSkillById(await listAllSkillLikeEntries(), id);
    if (!resolved) return { ok: false as const, code: 'SKILL_NOT_FOUND', message: 'skill not found' };
    return { ok: true as const, id: resolved.id };
  }

  return { listAllSkills, listAllTemplates, listAllSkillLikeEntries, validateProjectSkillId };
}
