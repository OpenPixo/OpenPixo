import { conditionVariables, shape, type Book, type Command, type Condition } from './parser.ts';
import { Runner, START } from './runner.ts';

/**
 * The story check behind `pnpm run check`: pure, so scripts/check-story.ts runs
 * it on the files and nothing else is needed. For every language it checks that
 * the text parses; a "start" label exists; every jump, condition and choice leads
 * to a label; speakers and @show name a character in characters.json; conditions
 * read only variables something sets; every label can be reached; and every
 * language has the same labels and commands as the first. Then it plays every
 * choice to prove no choice can leave the player with nothing to pick and every
 * ending can be reached. Missing art and sound are notes, not problems.
 */

/** Playthrough states to try before giving up on proving every ending. */
const MAX_STATES = 50000;

export interface StoryFiles {
  /** Language folder to its book, in folder-name order. */
  books: Map<string, Book>;
  characters: Record<string, unknown>;
  /** Whether a picture or sound exists, and where it would go. */
  asset: (kind: 'background' | 'portrait' | 'music' | 'sound', name: string, expression?: string) => { found: boolean; hint: string };
}

export interface CheckResult {
  problems: string[];
  notes: string[];
  summary: string;
}

export function checkStory({ books, characters, asset }: StoryFiles): CheckResult {
  const problems: string[] = [];
  const notes: string[] = [];
  if (!books.size) problems.push('story/ has no language folder, such as story/en');
  let first: Book | null = null;
  let firstLanguage = '';
  for (const [language, book] of books) {
    problems.push(...book.errors);
    if (book.errors.length) continue;
    checkBook(book, characters, problems);
    if (!first) { first = book; firstLanguage = language; } else compareBooks(firstLanguage, first, language, book, problems);
  }
  let states = 0;
  if (first && !problems.length) {
    states = playEverything(first, problems, notes);
    noteMissingFiles(first, asset, notes);
  }
  const summary = `${books.size} language(s) ${[...books.keys()].join(', ')}, ${first?.order.length ?? 0} label(s), ${first ? endingIds(first).length : 0} ending(s), ${states} playthrough state(s) tried`;
  return { problems, notes, summary };
}

function checkBook(book: Book, characters: Record<string, unknown>, problems: string[]): void {
  if (!book.labels.has(START)) problems.push(`${firstFile(book)}: there is no "== ${START}" label; the story begins there`);
  const set = new Set<string>();
  const read: Array<[string, Condition]> = [];
  for (const label of book.order) {
    for (const command of book.labels.get(label)!) {
      const where = `${command.file}:${command.line}`;
      for (const target of targets(command)) if (!book.labels.has(target)) problems.push(`${where}: there is no label "${target}"`);
      const character = command.kind === 'line' ? command.speaker : command.kind === 'show' || command.kind === 'hide' ? command.character : '';
      if (character && !(character in characters)) problems.push(`${where}: no character "${character}" in story/characters.json`);
      if (command.kind === 'set' || command.kind === 'add') set.add(command.variable);
      if (command.kind === 'if') read.push([where, command.condition]);
      if (command.kind === 'choice') for (const option of command.options) if (option.condition) read.push([where, option.condition]);
    }
  }
  for (const [where, condition] of read) {
    for (const variable of conditionVariables(condition)) {
      if (!set.has(variable)) problems.push(`${where}: the condition reads "${variable}", but no @set or @add sets it`);
    }
  }
  if (!book.labels.has(START)) return;
  const reached = new Set([START]);
  const queue = [START];
  while (queue.length) {
    for (const next of exits(book, queue.pop()!)) {
      if (book.labels.has(next) && !reached.has(next)) { reached.add(next); queue.push(next); }
    }
  }
  for (const label of book.order) {
    if (reached.has(label)) continue;
    const first = book.labels.get(label)![0];
    problems.push(`${first ? `${first.file}:${first.line - 1}` : `label "${label}"`}: the label "${label}" is never reached from "${START}"`);
  }
}

/** A translation keeps every label and command and changes only the text. */
function compareBooks(firstLanguage: string, first: Book, language: string, book: Book, problems: string[]): void {
  for (const label of first.order) {
    if (!book.labels.has(label)) problems.push(`story/${language} has no label "${label}", which story/${firstLanguage} has`);
  }
  for (const label of book.order) {
    const expected = first.labels.get(label);
    if (!expected) { problems.push(`story/${language} has the label "${label}", which story/${firstLanguage} does not`); continue; }
    const found = book.labels.get(label)!;
    for (let i = 0; i < Math.max(expected.length, found.length); i++) {
      const want = expected[i];
      const got = found[i];
      if (!got) { problems.push(`${want!.file}:${want!.line}: story/${language} goes on with ${describe(want!)} here`); break; }
      if (!want) { problems.push(`${got.file}:${got.line}: ${describe(got)} is not in story/${firstLanguage}`); break; }
      if (shape(want) !== shape(got)) {
        problems.push(`${got.file}:${got.line}: ${describe(got)}, but ${want.file}:${want.line} has ${describe(want)}; only the text may differ between languages`);
        break;
      }
    }
  }
}

/** Plays every option of every choice. Returns how many states it tried. */
function playEverything(book: Book, problems: string[], notes: string[]): number {
  const seen = new Set<string>();
  const reached = new Set<string>();
  const stuck = new Set<string>();
  const start = new Runner(book);
  start.start();
  const stack = [start.toSave()];
  while (stack.length && seen.size < MAX_STATES) {
    const runner = new Runner(book);
    runner.fromSave(stack.pop());
    const current = runner.step();
    const key = `${runner.label}|${runner.index}|${JSON.stringify(runner.variables)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const problem of runner.problems) if (!problems.includes(problem)) problems.push(problem);
    if (current.kind === 'line' || current.kind === 'wait') {
      runner.next();
      stack.push(runner.toSave());
    } else if (current.kind === 'choice') {
      const open = runner.options();
      if (!open.length) stuck.add(`${current.file}:${current.line}`);
      for (const option of open) {
        const branch = new Runner(book);
        branch.fromSave(runner.toSave());
        branch.choose(option.index);
        stack.push(branch.toSave());
      }
    } else {
      reached.add(current.id);
    }
  }
  for (const where of stuck) problems.push(`${where}: in some playthrough none of this choice's options can be picked`);
  if (stack.length) {
    notes.push(`stopped after ${MAX_STATES} playthrough states, so not every ending was proven reachable`);
    return seen.size;
  }
  for (const id of endingIds(book)) if (!reached.has(id)) problems.push(`${endingWhere(book, id)}: the ending "${id}" can never be reached`);
  return seen.size;
}

function noteMissingFiles(book: Book, asset: StoryFiles['asset'], notes: string[]): void {
  const add = (note: string) => { if (!notes.includes(note)) notes.push(note); };
  for (const label of book.order) {
    for (const command of book.labels.get(label)!) {
      if (command.kind === 'bg' && command.name !== 'none') {
        const found = asset('background', command.name);
        if (!found.found) add(`no picture for the background "${command.name}": add ${found.hint}`);
      } else if (command.kind === 'show') {
        const found = asset('portrait', command.character, command.expression);
        if (!found.found) add(`no picture for "${command.character}": add ${found.hint}`);
      } else if (command.kind === 'music' && command.name !== 'stop') {
        const found = asset('music', command.name);
        if (!found.found) add(`no music "${command.name}": add ${found.hint}`);
      } else if (command.kind === 'sfx') {
        const found = asset('sound', command.name);
        if (!found.found) add(`no sound "${command.name}": add ${found.hint}`);
      }
    }
  }
}

/** Labels a label can lead to, including the next label when it runs off its end. */
function exits(book: Book, label: string): string[] {
  const commands = book.labels.get(label)!;
  const found = commands.flatMap(targets);
  const last = commands.at(-1);
  if (!last || !['jump', 'end', 'choice'].includes(last.kind)) {
    const next = book.order[book.order.indexOf(label) + 1];
    if (next) found.push(next);
  }
  return found;
}

function targets(command: Command): string[] {
  if (command.kind === 'jump' || command.kind === 'if') return [command.target];
  if (command.kind === 'choice') return command.options.map(option => option.target);
  return [];
}

export function endingIds(book: Book): string[] {
  const ids: string[] = [];
  for (const label of book.order) {
    for (const command of book.labels.get(label)!) if (command.kind === 'end' && command.id && !ids.includes(command.id)) ids.push(command.id);
  }
  return ids;
}

function endingWhere(book: Book, id: string): string {
  for (const label of book.order) {
    for (const command of book.labels.get(label)!) if (command.kind === 'end' && command.id === id) return `${command.file}:${command.line}`;
  }
  return 'story';
}

function describe(command: Command): string {
  if (command.kind === 'line') return command.speaker ? `a line by ${command.speaker}` : 'a narration line';
  if (command.kind === 'choice') return `a choice leading to ${targets(command).join(', ')}`;
  const { kind, file: _file, line: _line, ...rest } = command;
  const words = ['@' + kind, ...Object.entries(rest).filter(([key, value]) => key !== 'title' && value !== '' && key !== 'condition').map(([, value]) => String(value))];
  return `"${words.join(' ')}"`;
}

function firstFile(book: Book): string {
  for (const label of book.order) { const first = book.labels.get(label)![0]; if (first) return first.file; }
  return 'story';
}
