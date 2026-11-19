/**
 * Turns .story text into commands. Pure: no Phaser, no browser and no Node APIs,
 * so the game and scripts/check-story.ts read stories the same way. README.md
 * describes the format; it is the same format as OpenPixo's Godot story kit.
 *
 * A "book" is every file of one language: labels in file order, each a list of
 * commands, plus the problems found while reading them ("file:line: problem").
 */

export type Value = boolean | number | string;
export type Condition =
  | ['flag', string]
  | ['compare', string, Operator, Value]
  | ['not', Condition]
  | ['and', ...Condition[]]
  | ['or', ...Condition[]];
export type Operator = '==' | '!=' | '>=' | '<=' | '>' | '<';

interface At { file: string; line: number }
export interface Option { text: string; target: string; condition: Condition | null }
export type Command = At & (
  | { kind: 'line'; speaker: string; text: string }
  | { kind: 'choice'; prompt: string; options: Option[] }
  | { kind: 'bg' | 'music' | 'sfx'; name: string }
  | { kind: 'show'; character: string; expression: string; position: Position | '' }
  | { kind: 'hide'; character: string }
  | { kind: 'wait'; seconds: number }
  | { kind: 'set'; variable: string; value: Value }
  | { kind: 'add'; variable: string; amount: number }
  | { kind: 'jump'; target: string }
  | { kind: 'if'; condition: Condition; target: string }
  | { kind: 'end'; id: string; title: string }
);
export type Position = 'left' | 'center' | 'right';

export interface Book {
  labels: Map<string, Command[]>;
  order: string[];
  errors: string[];
}

export const POSITIONS: readonly Position[] = ['left', 'center', 'right'];
export const COMMANDS = ['bg', 'show', 'hide', 'music', 'sfx', 'wait', 'set', 'add', 'jump', 'if', 'end'] as const;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SPEAKER = /^([a-z_][a-z0-9_]*):\s*(.*)$/;

export function emptyBook(): Book {
  return { labels: new Map(), order: [], errors: [] };
}

/** Adds one file's labels to `book`. Labels are shared across all files of a language. */
export function parseInto(book: Book, text: string, file: string): void {
  let label = '';
  let choice: Extract<Command, { kind: 'choice' }> | null = null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    const line = i + 1;
    const where = `${file}:${line}`;
    if (!raw || raw.startsWith('#')) continue;
    if (raw === '-' || raw.startsWith('- ')) {
      if (!label) { book.errors.push(`${where}: a choice is outside a label; start the file with a line like "== start"`); continue; }
      if (!choice) {
        choice = { kind: 'choice', file, line, prompt: '', options: [] };
        book.labels.get(label)!.push(choice);
      }
      const option = parseOption(raw.slice(1).trim(), where, book.errors);
      if (option) choice.options.push(option);
      continue;
    }
    choice = null;
    if (raw.startsWith('==')) {
      const name = raw.replace(/^==/, '').replace(/==$/, '').trim();
      if (!IDENTIFIER.test(name)) { book.errors.push(`${where}: "${name}" is not a label name; use letters, digits and _`); label = ''; }
      else if (book.labels.has(name)) { book.errors.push(`${where}: label "${name}" is already defined`); label = ''; }
      else { book.labels.set(name, []); book.order.push(name); label = name; }
      continue;
    }
    if (!label) { book.errors.push(`${where}: this line is outside a label; start the file with a line like "== start"`); continue; }
    const commands = book.labels.get(label)!;
    if (raw.startsWith('?')) {
      choice = { kind: 'choice', file, line, prompt: raw.slice(1).trim(), options: [] };
      commands.push(choice);
      continue;
    }
    if (raw.startsWith('@')) {
      const command = parseCommand(raw.slice(1).trim(), file, line, book.errors);
      if (command) commands.push(command);
      continue;
    }
    let speaker = '';
    let body = raw;
    if (raw.startsWith(':')) body = raw.slice(1).trim();
    else {
      const found = SPEAKER.exec(raw);
      if (found) { speaker = found[1]!; body = found[2]!.trim(); }
    }
    if (!body) { book.errors.push(`${where}: this line has no text`); continue; }
    commands.push({ kind: 'line', file, line, speaker, text: body });
  }
  for (const commands of book.labels.values()) {
    for (const command of commands) {
      if (command.kind === 'choice' && !command.options.length) {
        book.errors.push(`${command.file}:${command.line}: a choice needs at least one "- text -> label" line`);
      }
    }
  }
}

/** The part of a command a translation must keep: everything except its text. */
export function shape(command: Command): string {
  const { file: _file, line: _line, ...rest } = command;
  const copy: Record<string, unknown> = { ...rest };
  for (const key of ['text', 'prompt', 'title']) delete copy[key];
  if (command.kind === 'choice') copy.options = command.options.map(({ target, condition }) => ({ target, condition }));
  return JSON.stringify(copy);
}

export function parseCondition(text: string, where: string, errors: string[]): Condition | null {
  text = text.trim();
  if (!text) { errors.push(`${where}: the condition is empty`); return null; }
  for (const joiner of ['or', 'and'] as const) {
    const parts = text.split(` ${joiner} `).filter(Boolean);
    if (parts.length > 1) {
      const children: Condition[] = [];
      for (const part of parts) {
        const child = parseCondition(part, where, errors);
        if (!child) return null;
        children.push(child);
      }
      return [joiner, ...children];
    }
  }
  if (text.startsWith('not ')) {
    const inner = parseCondition(text.slice(4), where, errors);
    return inner ? ['not', inner] : null;
  }
  const compare = /^([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(text);
  if (compare) return ['compare', compare[1]!, compare[2] as Operator, parseValue(compare[3]!)];
  if (IDENTIFIER.test(text)) return ['flag', text];
  errors.push(`${where}: cannot read the condition "${text}"; write it like "trust >= 2", "met_ren" or "not met_ren"`);
  return null;
}

/** true and false, numbers, "quoted text", or a bare word as text. */
export function parseValue(text: string): Value {
  text = text.trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(text)) return Number(text);
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1);
  return text;
}

/** Variable names a condition reads. */
export function conditionVariables(condition: Condition | null): string[] {
  if (!condition) return [];
  if (condition[0] === 'flag' || condition[0] === 'compare') return [condition[1]];
  return (condition.slice(1) as Condition[]).flatMap(conditionVariables);
}

function parseOption(body: string, where: string, errors: string[]): Option | null {
  const arrow = body.lastIndexOf('->');
  if (arrow < 0) { errors.push(`${where}: write a choice as "- what the player picks -> label"`); return null; }
  const text = body.slice(0, arrow).trim();
  const rest = body.slice(arrow + 2).trim();
  const guard = rest.indexOf(' if ');
  const target = guard < 0 ? rest : rest.slice(0, guard).trim();
  const condition = guard < 0 ? null : parseCondition(rest.slice(guard + 4), where, errors);
  if (!text) { errors.push(`${where}: the choice has no text before ->`); return null; }
  if (!IDENTIFIER.test(target)) { errors.push(`${where}: "${target}" is not a label name`); return null; }
  return { text, target, condition };
}

const EXAMPLES: Record<string, string> = { bg: 'classroom', music: 'rain', sfx: 'door' };

function parseCommand(body: string, file: string, line: number, errors: string[]): Command | null {
  const where = `${file}:${line}`;
  const words = body.split(/\s+/).filter(Boolean);
  const name = words[0] ?? '';
  const args = words.slice(1);
  const rest = body.slice(name.length).trim();
  switch (name) {
    case 'bg': case 'music': case 'sfx':
      if (args.length !== 1) { errors.push(`${where}: @${name} takes one name, like "@${name} ${EXAMPLES[name]}"`); return null; }
      return { kind: name, file, line, name: args[0]! };
    case 'show': {
      if (!args.length) { errors.push(`${where}: @show needs a character, like "@show ren happy left"`); return null; }
      let expression = '';
      let position: Position | '' = '';
      for (const word of args.slice(1)) {
        if ((POSITIONS as readonly string[]).includes(word)) position = word as Position;
        else if (!expression) expression = word;
        else { errors.push(`${where}: @show takes a character, an expression and one of left, center, right`); return null; }
      }
      return { kind: 'show', file, line, character: args[0]!, expression, position };
    }
    case 'hide':
      if (args.length > 1) { errors.push(`${where}: @hide takes one character, or nothing to hide everyone`); return null; }
      return { kind: 'hide', file, line, character: args[0] ?? '' };
    case 'wait': {
      const seconds = Number(args[0]);
      if (args.length !== 1 || !(seconds > 0)) { errors.push(`${where}: @wait takes seconds, like "@wait 0.5"`); return null; }
      return { kind: 'wait', file, line, seconds };
    }
    case 'set': {
      const assignment = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*|\s+)(.+)$/.exec(rest);
      if (!assignment) { errors.push(`${where}: write @set like "@set met_ren = true"`); return null; }
      return { kind: 'set', file, line, variable: assignment[1]!, value: parseValue(assignment[2]!) };
    }
    case 'add': {
      const amount = Number(args[1]);
      if (args.length !== 2 || !IDENTIFIER.test(args[0]!) || !Number.isFinite(amount)) {
        errors.push(`${where}: write @add like "@add trust 1" or "@add trust -1"`); return null;
      }
      return { kind: 'add', file, line, variable: args[0]!, amount };
    }
    case 'jump':
      if (args.length !== 1 || !IDENTIFIER.test(args[0]!)) { errors.push(`${where}: @jump takes one label, like "@jump ending"`); return null; }
      return { kind: 'jump', file, line, target: args[0]! };
    case 'if': {
      const arrow = rest.lastIndexOf('->');
      const target = arrow >= 0 ? rest.slice(arrow + 2).trim() : '';
      if (arrow < 0 || !IDENTIFIER.test(target)) { errors.push(`${where}: write @if like "@if trust >= 2 -> good_end"`); return null; }
      const condition = parseCondition(rest.slice(0, arrow), where, errors);
      return condition ? { kind: 'if', file, line, condition, target } : null;
    }
    case 'end': {
      const ending = /^([A-Za-z_][A-Za-z0-9_]*)?\s*(.*)$/.exec(rest)!;
      return { kind: 'end', file, line, id: ending[1] ?? '', title: ending[2]!.trim() };
    }
    default:
      errors.push(`${where}: unknown command @${name}; the commands are @${COMMANDS.join(', @')}`);
      return null;
  }
}
