import type { Book, Command, Condition, Value } from './parser.ts';

/**
 * Plays a book: where the story is, its variables and what is on stage. Pure,
 * so StoryScene draws what it says and scripts/check-story.ts plays every path.
 *
 * step() runs commands until one needs the player and returns it: a line, a
 * choice, a wait or an end. The scene shows it, then calls next() after a line
 * or a wait, or choose() for a choice.
 */

export const START = 'start';
const LOG_LIMIT = 200;

export type Blocking = Extract<Command, { kind: 'line' | 'choice' | 'wait' | 'end' }>;
export interface OnStage { expression: string; position: string }
/** [label, index] for a line read, [label, index, option] for a choice made. */
export type HistoryEntry = [string, number] | [string, number, number];
export interface Saved {
  label: string;
  index: number;
  variables: Record<string, Value>;
  background: string;
  music: string;
  cast: Record<string, OnStage>;
  history: HistoryEntry[];
}

const STORY_OVER: Blocking = { kind: 'end', id: '', title: '', file: '', line: 0 };

export class Runner {
  book: Book;
  label = START;
  index = 0;
  variables: Record<string, Value> = {};
  /** Background name, '' for none. */
  background = '';
  /** Music name, '' for silence. */
  music = '';
  /** Character id to how they stand, in the order they appeared. */
  cast: Record<string, OnStage> = {};
  /** Sound effects step() reached since the scene last took them. */
  pendingSounds: string[] = [];
  history: HistoryEntry[] = [];
  /** Problems met while playing, such as a jump to a missing label. */
  problems: string[] = [];

  constructor(book: Book) {
    this.book = book;
  }

  start(from = START): void {
    Object.assign(this, { label: from, index: 0, variables: {}, background: '', music: '', cast: {}, history: [], pendingSounds: [] });
  }

  /** The command the story is waiting on, running every command before it. */
  step(): Blocking {
    // A story that only loops through jumps and conditions never reaches the player.
    for (let guard = 0; guard < 10000; guard++) {
      const commands = this.book.labels.get(this.label) ?? [];
      if (this.index >= commands.length) {
        if (!this.fallThrough()) return STORY_OVER;
        continue;
      }
      const command = commands[this.index]!;
      switch (command.kind) {
        case 'line': case 'choice': case 'wait': case 'end':
          return command;
        case 'set': this.variables[command.variable] = command.value; break;
        case 'add': this.variables[command.variable] = toNumber(this.variables[command.variable]) + command.amount; break;
        case 'jump': this.go(command.target); continue;
        case 'if':
          if (this.evaluate(command.condition)) { this.go(command.target); continue; }
          break;
        case 'bg': this.background = command.name === 'none' ? '' : command.name; break;
        case 'music': this.music = command.name === 'stop' ? '' : command.name; break;
        case 'sfx': this.pendingSounds.push(command.name); break;
        case 'show': {
          const previous = this.cast[command.character];
          this.cast[command.character] = {
            expression: command.expression || previous?.expression || '',
            position: command.position || previous?.position || 'center',
          };
          break;
        }
        case 'hide':
          if (command.character) delete this.cast[command.character];
          else this.cast = {};
          break;
      }
      this.index++;
    }
    this.problems.push(`the story at ${this.label} loops without reaching a line`);
    return STORY_OVER;
  }

  /** After a line or a wait: remember it and move on. */
  next(): Blocking {
    const current = this.step();
    if (current.kind === 'line') this.remember([this.label, this.index]);
    if (current.kind === 'line' || current.kind === 'wait') this.index++;
    return this.step();
  }

  /** The options of the current choice the player may pick now, each with its index in the choice. */
  options(): Array<{ index: number; text: string; target: string }> {
    const current = this.step();
    if (current.kind !== 'choice') return [];
    return current.options.flatMap((option, index) =>
      !option.condition || this.evaluate(option.condition) ? [{ index, text: option.text, target: option.target }] : []);
  }

  /** Picks an option of the current choice by its index in the choice. */
  choose(optionIndex: number): Blocking {
    const current = this.step();
    if (current.kind !== 'choice' || !current.options[optionIndex]) return current;
    this.remember([this.label, this.index, optionIndex]);
    this.go(current.options[optionIndex]!.target);
    return this.step();
  }

  /** Skips a choice that has no option open, so the story cannot get stuck. */
  skipChoice(): Blocking {
    if (this.step().kind === 'choice') {
      this.problems.push(`a choice at ${this.label} had no option the player could pick`);
      this.index++;
    }
    return this.step();
  }

  evaluate(condition: Condition): boolean {
    switch (condition[0]) {
      case 'flag': return truthy(this.variables[condition[1]]);
      case 'not': return !this.evaluate(condition[1]);
      case 'and': return (condition.slice(1) as Condition[]).every(child => this.evaluate(child));
      case 'or': return (condition.slice(1) as Condition[]).some(child => this.evaluate(child));
      case 'compare': return compare(this.variables[condition[1]], condition[2], condition[3]);
    }
  }

  /** The command a history entry points at, or null when the book no longer has it. */
  commandAt(entry: HistoryEntry): Command | null {
    return this.book.labels.get(entry[0])?.[entry[1]] ?? null;
  }

  toSave(): Saved {
    return structuredClone({
      label: this.label, index: this.index, variables: this.variables, background: this.background,
      music: this.music, cast: this.cast, history: this.history,
    });
  }

  /** Restores a saved position. False when the save does not fit this story. */
  fromSave(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false;
    const saved = data as Partial<Saved>;
    if (typeof saved.label !== 'string' || !this.book.labels.has(saved.label)) return false;
    const copy = structuredClone(saved);
    this.label = copy.label!;
    this.index = Number(copy.index) || 0;
    this.variables = isRecord(copy.variables) ? copy.variables as Record<string, Value> : {};
    this.background = String(copy.background ?? '');
    this.music = String(copy.music ?? '');
    this.cast = isRecord(copy.cast) ? copy.cast as Record<string, OnStage> : {};
    this.history = Array.isArray(copy.history)
      ? copy.history.filter(entry => Array.isArray(entry) && this.book.labels.has(String(entry[0]))) : [];
    return true;
  }

  private go(target: string): void {
    if (!this.book.labels.has(target)) this.problems.push(`no label "${target}" (from ${this.label})`);
    this.label = this.book.labels.has(target) ? target : '';
    this.index = 0;
  }

  /** Running off a label's last line goes on to the next label in file order. */
  private fallThrough(): boolean {
    const at = this.book.order.indexOf(this.label);
    if (at < 0 || at + 1 >= this.book.order.length) return false;
    this.label = this.book.order[at + 1]!;
    this.index = 0;
    return true;
  }

  private remember(entry: HistoryEntry): void {
    this.history.push(entry);
    if (this.history.length > LOG_LIMIT) this.history = this.history.slice(-LOG_LIMIT);
  }
}

function truthy(value: Value | undefined): boolean {
  return value !== undefined && value !== false && value !== 0 && value !== '';
}

function toNumber(value: Value | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return 0;
}

function compare(value: Value | undefined, operator: string, expected: Value): boolean {
  if (typeof expected === 'number') {
    const number = toNumber(value);
    switch (operator) {
      case '==': return number === expected;
      case '!=': return number !== expected;
      case '>=': return number >= expected;
      case '<=': return number <= expected;
      case '>': return number > expected;
      case '<': return number < expected;
    }
  }
  const left = value ?? (typeof expected === 'string' ? '' : false);
  if (operator === '==') return left === expected;
  if (operator === '!=') return left !== expected;
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
