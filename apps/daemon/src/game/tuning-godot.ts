import path from 'node:path';
import type { GameTuningParameter, GameTuningType, GameTuningValue } from '@openpixo/contracts';

export interface TuningLocation {
  parameter: Omit<GameTuningParameter, 'id' | 'fileHash'>;
  start: number;
  end: number;
  scriptRoot?: boolean;
}
interface SourceLine { text: string; start: number; line: number }
export function tuningSourceLines(source: string): SourceLine[] {
  const result: SourceLine[] = [];
  const re = /[^\r\n]*(?:\r\n|\n|\r|$)/g;
  for (const match of source.matchAll(re)) {
    if (!match[0]) break;
    result.push({ text: match[0].replace(/[\r\n]+$/, ''), start: match.index, line: result.length + 1 });
  }
  return result;
}

const NUMBER = /^[+-]?(?:(?:0[xX][\da-fA-F_]+|0[bB][01_]+)|(?:(?:\d[\d_]*(?:\.[\d_]*)?|\.[\d_]+)(?:[eE][+-]?\d[\d_]*)?))$/;
function numeric(text: string): number | undefined {
  if (!NUMBER.test(text)) return;
  const clean = text.replaceAll('_', '');
  const sign = clean.startsWith('-') ? -1 : 1;
  const unsigned = clean.replace(/^[+-]/, '');
  const value = sign * Number(unsigned);
  return Number.isFinite(value) ? value : undefined;
}

/** A small literal reader, not a GDScript interpreter. Expressions never reach writes. */
function quoted(text: string): string | undefined {
  const quote = text[0];
  if ((quote !== '"' && quote !== "'") || text.at(-1) !== quote || text.startsWith(quote.repeat(3))) return;
  let value = '';
  for (let i = 1; i < text.length - 1; i++) {
    const ch = text[i];
    if (ch === quote || ch === '\n' || ch === '\r') return;
    if (ch !== '\\') { value += ch; continue; }
    const escape = text[++i];
    if (!escape || i >= text.length - 1) return;
    const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', a: '\x07', '\\': '\\', '"': '"', "'": "'" };
    if (escape in escapes) value += escapes[escape];
    else if (escape === 'u' || escape === 'U') {
      const length = escape === 'u' ? 4 : 6;
      const hex = text.slice(i + 1, i + 1 + length);
      const code = Number.parseInt(hex, 16);
      if (!new RegExp(`^[a-fA-F0-9]{${length}}$`).test(hex) || code > 0x10ffff) return;
      value += String.fromCodePoint(code); i += length;
    } else return;
  }
  return value;
}

function withoutComment(text: string): string {
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#' || ch === ';') return text.slice(0, i);
  }
  return text;
}

export function godotNumericColorComponents(text: string): number[] | undefined {
  const match = /^Color\s*\((.*)\)$/.exec(text);
  if (!match) return;
  const values = match[1]!.split(',').map(part => numeric(part.trim()));
  if ((values.length !== 3 && values.length !== 4) || values.some(value => value === undefined)) return;
  const components = values.map(value => value!);
  if (components.length === 3) components.push(1);
  return components;
}

function color(text: string): string | undefined {
  const match = /^Color\s*\((.*)\)$/.exec(text);
  if (!match) return;
  const string = quoted(match[1]!.trim());
  if (string !== undefined) {
    const hex = string.replace(/^#/, '').toLowerCase();
    if (/^[a-f\d]{6}(?:[a-f\d]{2})?$/.test(hex)) return `#${hex.length === 6 ? hex + 'ff' : hex}`;
    if (/^[a-f\d]{3,4}$/.test(hex)) return `#${[...hex].map(ch => ch + ch).join('')}${hex.length === 3 ? 'ff' : ''}`;
    return;
  }
  const parts = godotNumericColorComponents(text);
  if (!parts) return;
  // Preserve HDR components as a validated literal instead of clipping to the color picker's range.
  if (parts.some(part => part < 0 || part > 1)) return text;
  return '#' + parts.map(part => Math.round(part * 255).toString(16).padStart(2, '0')).join('');
}

export function parseGodotTuningLiteral(text: string, type?: GameTuningType): { type: GameTuningType; value: GameTuningValue; literal: string } | undefined {
  const literal = withoutComment(text).trim();
  let found: { type: GameTuningType; value: GameTuningValue } | undefined;
  const num = numeric(literal);
  if (num !== undefined) {
    if ((!literal.match(/^[-+]?0[xb]/i) && /[.eE]/.test(literal)) || !Number.isSafeInteger(num)) found = { type: 'float', value: num };
    else found = { type: 'int', value: num };
  } else if (literal === 'true' || literal === 'false') found = { type: 'bool', value: literal === 'true' };
  else {
    const str = quoted(literal);
    const col = color(literal);
    if (str !== undefined) found = { type: 'string', value: str };
    else if (col !== undefined) found = { type: 'color', value: col };
  }
  if (!found) return;
  if (type && type !== found.type) {
    if (type === 'float' && found.type === 'int') found.type = 'float';
    else return;
  }
  return { ...found, literal };
}

function rangeFields(annotation: string): Pick<GameTuningParameter, 'min' | 'max' | 'step' | 'allowLess' | 'allowGreater'> {
  const match = /^@export_range\s*\((.*)\)$/.exec(annotation);
  if (!match) return {};
  const args = match[1]!.split(',').map(arg => arg.trim());
  const min = numeric(args[0] ?? ''); const max = numeric(args[1] ?? '');
  const step = numeric(args[2] ?? '');
  if (min === undefined || max === undefined || min > max) return {};
  return { min, max, ...(step !== undefined && step > 0 ? { step } : {}),
    ...(args.includes('"or_less"') || args.includes("'or_less'") ? { allowLess: true } : {}),
    ...(args.includes('"or_greater"') || args.includes("'or_greater'") ? { allowGreater: true } : {}),
  };
}

/** Only exported literal defaults are exposed; private variables and expressions stay untouched. */
export function scanGodotScript(filePath: string, source: string): TuningLocation[] {
  const lines = tuningSourceLines(source);
  const owner = /^\s*class_name\s+(\w+)/m.exec(source)?.[1] ?? path.posix.basename(filePath, '.gd');
  const result: TuningLocation[] = [];
  let annotation = ''; let description: string[] = []; let group = owner; let triple = '';
  const localClasses: number[] = [];
  for (const line of lines) {
    const text = line.text.replace(/^\uFEFF/, '');
    // Exports shown inside multiline strings are documentation, not declarations.
    const wasInString = Boolean(triple); let quote = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (triple) { if (text.slice(i, i + 3) === triple) { triple = ''; i += 2; } continue; }
      if (quote) { if (text[i] === '\\') i++; else if (text[i] === quote) quote = ''; continue; }
      if (text[i] === '#') break;
      if (ch === '"' || ch === "'") {
        if (text.slice(i, i + 3) === ch.repeat(3)) { triple = ch.repeat(3); i += 2; }
        else quote = ch;
      }
    }
    if (wasInString) continue;
    const significant = withoutComment(text).trim();
    if (significant) {
      const leading = text.slice(0, text.length - text.trimStart().length);
      const indent = leading.replaceAll('\t', '    ').length;
      while (localClasses.length && indent <= localClasses.at(-1)!) localClasses.pop();
      if (/^class\s+\w+\b.*:\s*$/.test(significant)) {
        localClasses.push(indent); annotation = ''; description = []; continue;
      }
    }
    if (/^\s*##/.test(text)) { description.push(text.replace(/^\s*##\s?/, '')); continue; }
    const exportGroup = /^\s*@export_(?:group|subgroup|category)\s*\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/.exec(text);
    if (exportGroup) { group = quoted(exportGroup[1]!) || owner; annotation = ''; description = []; continue; }
    const annotated = /^\s*(@export_range\s*\([^)]*\)|@export)\s*(.*)$/.exec(text);
    let declaration = text;
    if (annotated) {
      annotation = annotated[1]!;
      declaration = annotated[2]!;
      if (!withoutComment(declaration).trim()) continue;
    }
    if (annotation) {
      const variable = /^\s*var\s+(\w+)\s*(?::\s*(int|float|bool|String|Color)\s*)?(?::=|=)\s*(.*)$/.exec(declaration);
      if (variable) {
        const types: Record<string, GameTuningType> = { int: 'int', float: 'float', bool: 'bool', String: 'string', Color: 'color' };
        const literal = parseGodotTuningLiteral(variable[3]!, variable[2] ? types[variable[2]] : undefined);
        if (literal) {
          const valueStart = text.length - variable[3]!.length;
          const leading = variable[3]!.length - variable[3]!.trimStart().length;
          result.push({ parameter: { key: variable[1]!, label: variable[1]!.replaceAll('_', ' '), group, owner,
            ...(description.length ? { description: description.join('\n') } : {}), ...literal,
            defaultValue: literal.value, source: 'godot-script', filePath, line: line.line,
            ...rangeFields(annotation),
          }, start: line.start + (line.text.length - text.length) + valueStart + leading,
          end: line.start + (line.text.length - text.length) + valueStart + leading + literal.literal.length,
          scriptRoot: localClasses.length === 0 });
        }
      }
    }
    annotation = ''; description = [];
  }
  return result;
}

interface SceneNode { nodePath: string; instance?: string; script?: string; properties: Array<{ key: string; line: SourceLine; text: string }> }
interface Scene { resources: Map<string, string>; nodes: SceneNode[] }
function sceneResource(text: string): string | undefined { return /^ExtResource\(\s*"([^"]+)"\s*\)$/.exec(text.trim())?.[1]; }
function parseScene(source: string): Scene {
  const scene: Scene = { resources: new Map(), nodes: [] };
  let node: SceneNode | undefined;
  for (const line of tuningSourceLines(source)) {
    const header = /^\s*\[(\w+)\b(.*)\]\s*$/.exec(withoutComment(line.text));
    if (header) {
      node = undefined;
      const attrs = new Map([...header[2]!.matchAll(/(\w+)=("(?:[^"\\]|\\.)*"|ExtResource\([^)]*\))/g)].map(match => [match[1]!, match[2]!]));
      const attr = (key: string) => quoted(attrs.get(key) ?? '');
      if (header[1] === 'ext_resource') {
        const resourcePath = attr('path'); const id = attr('id');
        if (id && resourcePath?.startsWith('res://')) {
          const relative = path.posix.normalize(resourcePath.slice(6));
          if (relative !== '..' && !relative.startsWith('../') && !path.posix.isAbsolute(relative)) scene.resources.set(id, relative);
        }
      } else if (header[1] === 'node') {
        const parent = attr('parent'); const name = attr('name');
        if (!name) continue;
        const nodePath = parent === undefined ? '.' : parent === '.' ? name : `${parent}/${name}`;
        const instance = sceneResource(attrs.get('instance') ?? '');
        const parsedNode: SceneNode = { nodePath, ...(instance ? { instance } : {}), properties: [] };
        node = parsedNode; scene.nodes.push(parsedNode);
      }
      continue;
    }
    if (!node) continue;
    const prop = /^\s*(\w+)\s*=\s*(.*)$/.exec(line.text);
    if (!prop) continue;
    if (prop[1] === 'script') node.script = scene.resources.get(sceneResource(withoutComment(prop[2]!)) ?? '') ?? '';
    else node.properties.push({ key: prop[1]!, line, text: prop[2]! });
  }
  return scene;
}

/** Resolve instance inheritance in memory, only among files the safe project walker read. */
export function scanGodotScenes(sources: Map<string, string>, scripts: Map<string, TuningLocation[]>): TuningLocation[] {
  const scenes = new Map([...sources].map(([filePath, source]) => [filePath, parseScene(source)]));
  type ResolvedNode = { script: string; defaults: Map<string, GameTuningValue> };
  const cache = new Map<string, Map<string, ResolvedNode>>(); const visiting = new Set<string>();
  const result: TuningLocation[] = [];
  const rootMembers = (scriptPath: string) => (scripts.get(scriptPath) ?? []).filter(item => item.scriptRoot !== false);
  function resolveScene(filePath: string): Map<string, ResolvedNode> {
    const cached = cache.get(filePath); if (cached) return cached;
    const scene = scenes.get(filePath);
    if (!scene || visiting.has(filePath) || visiting.size >= 32) return new Map();
    visiting.add(filePath);
    const resolved = new Map<string, ResolvedNode>();
    for (const node of scene.nodes) {
      const instancePath = scene.resources.get(node.instance ?? '');
      if (instancePath) for (const [child, data] of resolveScene(instancePath)) {
        const combined = node.nodePath === '.' ? child : child === '.' ? node.nodePath : `${node.nodePath}/${child}`;
        resolved.set(combined, { script: data.script, defaults: new Map(data.defaults) });
      }
      if (node.script !== undefined) {
        const declarations = rootMembers(node.script);
        resolved.set(node.nodePath, { script: node.script, defaults: new Map(declarations.map(item => [item.parameter.key, item.parameter.value])) });
      }
      const data = resolved.get(node.nodePath);
      if (!data) continue;
      const declarations = rootMembers(data.script);
      for (const property of node.properties) {
        const declaration = declarations.find(item => item.parameter.key === property.key)?.parameter;
        const literal = declaration && parseGodotTuningLiteral(property.text, declaration.type);
        if (!declaration || !literal) continue;
        const start = property.line.start + property.line.text.length - property.text.length;
        const leading = property.text.length - property.text.trimStart().length;
        result.push({ parameter: { ...declaration, ...literal, defaultValue: data.defaults.get(property.key) ?? declaration.value,
          source: 'godot-scene', filePath, line: property.line.line, scriptPath: data.script, nodePath: node.nodePath,
          group: `${filePath} · ${node.nodePath}`,
        }, start: start + leading, end: start + leading + literal.literal.length });
        data.defaults.set(property.key, literal.value);
      }
    }
    visiting.delete(filePath); cache.set(filePath, resolved); return resolved;
  }
  for (const filePath of scenes.keys()) resolveScene(filePath);
  return result;
}
