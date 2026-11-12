// Node 24 executes this TypeScript fixture directly. It never calls a provider.
import { spawn } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
if (args[0] !== 'exec') {
  if (args[0] === 'login') process.stdout.write('Logged in using ChatGPT\n');
  else if (args[0] === '--version') process.stdout.write('codex-cli 0.153.0\n');
  else process.stdout.write('[]\n');
  process.exit(0);
}
let input = '';
for await (const chunk of process.stdin) input += chunk;
const mode = process.env.T6_CODEX_MODE;
const generated = path.join(process.env.CODEX_HOME!, 'generated_images');
let childPid: number | undefined;
if (mode === 'hang') {
  childPid = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore', windowsHide: true,
  }).pid;
}
await writeFile(process.env.T6_CODEX_RECORD!, JSON.stringify({
  args, input, cwd: process.cwd(), entries: await readdir(process.cwd()),
  pid: process.pid, childPid, dataRoot: process.env.PIXO_DATA_DIR,
}));
const event = JSON.stringify({ type: 'thread.started', thread_id: 't6-thread' }) + '\n';
// A real JSON line can arrive across several writes.
process.stdout.write(event.slice(0, 12));
process.stdout.write(event.slice(12));
if (mode === 'hang') {
  setInterval(() => {}, 1000);
} else if (mode === 'auth' || mode === 'quota' || mode === 'rate') {
  const message = mode === 'auth' ? 'Not logged in. Run codex login.'
    : mode === 'quota' ? 'You have hit your usage limit. Try again after reset.'
    : 'Rate limit reached: too many requests (429).';
  process.stdout.write(JSON.stringify({ type: 'turn.failed', error: { message } }) + '\n');
  process.exitCode = 1;
} else {
  const count = Number(/exactly (\d+) image/.exec(input)?.[1] ?? '1');
  if (mode !== 'none') {
    const root = path.join(generated, mode === 'foreign' ? 'another-thread' : 't6-thread');
    await mkdir(root, { recursive: true });
    for (let i = 0; i < count; i++) {
      await writeFile(path.join(root, String(i + 1) + '.png'),
        Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64'));
    }
  }
  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'DONE' } }) + '\n');
  process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }) + '\n');
}
