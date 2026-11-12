import type { GameTuningType } from '@openpixo/contracts';
import type { TuningLocation } from './tuning-godot.js';

interface JsonNode { value: unknown; start: number; end: number; fields?: Map<string, JsonNode> }

/** Retain token spans so writing a number never reformats the surrounding document. */
function jsonTree(source: string): JsonNode {
  let offset = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  function whitespace() {
    while (offset < source.length) {
      if (/\s/.test(source[offset]!)) { offset++; continue; }
      if (source.slice(offset, offset + 2) === '//') {
        while (offset < source.length && !/[\r\n]/.test(source[offset]!)) offset++;
      } else if (source.slice(offset, offset + 2) === '/*') {
        const end = source.indexOf('*/', offset + 2); if (end < 0) throw new Error('Unclosed JSON comment'); offset = end + 2;
      } else break;
    }
  }
  function read(depth: number): JsonNode {
    if (depth > 32) throw new Error('JSON nesting limit');
    whitespace(); const start = offset; const ch = source[offset];
    if (ch === '{' || ch === '[') {
      const object = ch === '{'; const close = object ? '}' : ']'; offset++; whitespace();
      const fields = new Map<string, JsonNode>(); const values: unknown[] = [];
      while (source[offset] !== close) {
        let key = '';
        if (object) {
          const name = read(depth + 1);
          if (typeof name.value !== 'string') throw new Error('JSON object key required');
          key = name.value; whitespace();
          if (source[offset++] !== ':' || fields.has(key)) throw new Error('Invalid/duplicate JSON key');
        }
        const node = read(depth + 1);
        if (object) fields.set(key, node); else values.push(node.value);
        whitespace();
        if (source[offset] === close) break;
        if (source[offset++] !== ',') throw new Error('JSON comma required');
        whitespace();
      }
      if (source[offset++] !== close) throw new Error('JSON closing delimiter required');
      return { start, end: offset, value: object ? Object.fromEntries([...fields].map(([key, node]) => [key, node.value])) : values, ...(object ? { fields } : {}) };
    }
    if (ch === '"') {
      offset++;
      while (offset < source.length) {
        if (source[offset] === '\\') { offset += 2; continue; }
        if (source[offset++] === '"') return { start, end: offset, value: JSON.parse(source.slice(start, offset)) as unknown };
      }
      throw new Error('Unclosed JSON string');
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(offset));
    if (!token) throw new Error('JSON literal required');
    offset += token[0].length;
    return { start, end: offset, value: JSON.parse(token[0]) as unknown };
  }
  const tree = read(0); whitespace();
  if (offset !== source.length) throw new Error('Unexpected JSON content');
  return tree;
}

export function scanWebTuning(filePath: string, source: string): TuningLocation[] {
  const tree = jsonTree(source);
  if (!tree.fields) throw new Error('Tuning JSON must be an object');
  const result: TuningLocation[] = [];
  let line = 1; let lineCursor = 0;
  for (const [key, entry] of tree.fields) {
    const fields = entry.fields; const node = fields?.get('value');
    if (!fields || !node) continue;
    const value = node.value;
    if (!['number', 'boolean', 'string'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) continue;
    const number = (name: string): number | undefined => {
      const numberValue = fields.get(name)?.value;
      return typeof numberValue === 'number' && Number.isFinite(numberValue) ? numberValue : undefined;
    };
    const string = (name: string): string | undefined => typeof fields.get(name)?.value === 'string' ? fields.get(name)!.value as string : undefined;
    const translations = (name: string): Record<string, string> | undefined => {
      const value = fields.get(name)?.value;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
      const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0);
      return entries.length ? Object.fromEntries(entries) : undefined;
    };
    const label_i18n = translations('label_i18n'), group_i18n = translations('group_i18n');
    const min = number('min'); const max = number('max'); const step = number('step');
    if ((min !== undefined && max !== undefined && min > max) || (step !== undefined && step <= 0)) continue;
    const type: GameTuningType = typeof value === 'number' ? (step !== undefined && Number.isInteger(step) && Number.isSafeInteger(value) ? 'int' : 'float')
      : typeof value === 'boolean' ? 'bool' : 'string';
    const explicitDefault = fields.get('default')?.value;
    const defaultValue = typeof explicitDefault === typeof value ? explicitDefault : value;
    const description = string('description');
    line += (source.slice(lineCursor, node.start).match(/\r\n|\r|\n/g) ?? []).length;
    lineCursor = node.start;
    result.push({ parameter: { key, label: string('label') ?? key, group: string('group') ?? 'tuning.json', owner: string('group') ?? 'tuning.json',
      ...(description ? { description } : {}), ...(label_i18n ? { label_i18n } : {}), ...(group_i18n ? { group_i18n } : {}), type, source: 'web-json',
      value: value as number | boolean | string, defaultValue: defaultValue as number | boolean | string,
      literal: source.slice(node.start, node.end), filePath, line,
      ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(step !== undefined ? { step } : {}),
    }, start: node.start, end: node.end });
  }
  return result;
}
