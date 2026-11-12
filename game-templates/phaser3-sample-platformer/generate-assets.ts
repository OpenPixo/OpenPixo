/**
 * Original OpenPixo sample media, generated without third-party art or samples.
 * Output assets: Apache-2.0 OR CC0-1.0. Generator source: Apache-2.0.
 * Run from any directory: node game-templates/phaser3-sample-platformer/generate-assets.ts
 * Requires Node 24; no packages or network access are needed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

type Color = readonly [number, number, number, number?];

class PixelImage {
  width: number;
  height: number;
  pixels: Buffer;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = Buffer.alloc(width * height * 4);
  }

  rect(x: number, y: number, width: number, height: number, color: Color): void {
    for (let py = Math.max(0, y); py < Math.min(this.height, y + height); py++) {
      for (let px = Math.max(0, x); px < Math.min(this.width, x + width); px++) {
        const offset = (py * this.width + px) * 4;
        this.pixels[offset] = color[0];
        this.pixels[offset + 1] = color[1];
        this.pixels[offset + 2] = color[2];
        this.pixels[offset + 3] = color[3] ?? 255;
      }
    }
  }
}

// PNG is a signature plus CRC-protected chunks. Each RGBA row uses filter 0.
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(name: string, data: Buffer): Buffer {
  const tag = Buffer.from(name);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, checksum]);
}

const output = new URL('./files/public/assets/', import.meta.url);
mkdirSync(output, { recursive: true });

function savePng(name: string, image: PixelImage): void {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8; // Eight bits per channel.
  header[9] = 6; // RGBA.
  const stride = image.width * 4;
  const rows = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) image.pixels.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(new URL(name, output), png);
  console.log(`${name}: ${png.length} bytes (${image.width} x ${image.height})`);
}

const ink: Color = [23, 43, 69];
const skin: Color = [255, 214, 160];
const orange: Color = [245, 132, 77];
const teal: Color = [42, 174, 160];

// Six hand-drawn poses: a calm two-frame idle, then a four-frame run cycle.
const player = new PixelImage(192, 32);
for (let frame = 0; frame < 6; frame++) {
  const x = frame * 32;
  const bob = frame === 1 || frame === 3 || frame === 5 ? 1 : 0;
  const stride = [0, 0, -3, 0, 3, 0][frame];
  const box = (px: number, py: number, w: number, h: number, color: Color) => player.rect(x + px, py + bob, w, h, color);
  box(9, 4, 14, 13, ink);
  box(11, 5, 10, 10, skin);
  box(9, 4, 14, 4, [151, 76, 49]);
  box(9, 7, 3, 4, [151, 76, 49]);
  box(19, 9, 2, 2, ink);
  box(20, 12, 3, 2, skin);
  box(10, 16, 12, 10, ink);
  box(11, 17, 10, 8, orange);
  box(10, 15, 13, 3, teal);
  box(6 - Math.abs(stride), 17, 5 + Math.abs(stride), 2, teal);
  box(8 - stride, 18, 3, 7, ink);
  box(9 - stride, 19, 2, 5, skin);
  box(21 + stride, 18, 3, 7, ink);
  box(21 + stride, 19, 2, 5, skin);
  box(11 + stride, 25, 4, 5 - bob, ink);
  box(18 - stride, 25, 4, 5 - bob, ink);
  player.rect(x + 10 + stride, 29, 6, 2, [52, 75, 96]);
  player.rect(x + 17 - stride, 29, 6, 2, [52, 75, 96]);
}
savePng('player.png', player);

const ground = new PixelImage(32, 32);
ground.rect(0, 0, 32, 32, [122, 83, 60]);
ground.rect(0, 0, 32, 7, [71, 148, 95]);
ground.rect(0, 0, 32, 3, [141, 206, 111]);
for (const x of [1, 8, 15, 25]) ground.rect(x, 5, 4, 5, [71, 148, 95]);
for (let y = 12; y < 31; y += 7) {
  for (let x = (y % 3) * 3; x < 31; x += 11) {
    ground.rect(x, y, 5, 2, [158, 109, 73]);
    ground.rect((x + 6) % 29, y + 3, 3, 2, [99, 68, 55]);
  }
}
savePng('ground.png', ground);

const coin = new PixelImage(16, 16);
coin.rect(5, 1, 6, 14, [167, 98, 35]);
coin.rect(3, 3, 10, 10, [167, 98, 35]);
coin.rect(4, 3, 8, 10, [255, 199, 71]);
coin.rect(6, 2, 4, 12, [255, 199, 71]);
coin.rect(5, 4, 2, 7, [255, 238, 157]);
coin.rect(7, 4, 3, 2, [255, 238, 157]);
coin.rect(9, 7, 2, 5, [226, 153, 45]);
savePng('coin.png', coin);

// A quiet landscape stays behind the level and leaves space for the HUD.
const background = new PixelImage(400, 225);
for (let y = 0; y < 225; y++) {
  const blend = y / 224;
  background.rect(0, y, 400, 1, [Math.round(149 + 64 * blend), Math.round(204 + 27 * blend), Math.round(220 - 13 * blend)]);
}
background.rect(316, 28, 22, 22, [255, 235, 169]);
background.rect(312, 33, 30, 12, [255, 235, 169]);
for (const [x, y] of [[32, 56], [162, 34], [263, 75]]) {
  background.rect(x, y, 48, 8, [238, 248, 235]);
  background.rect(x + 9, y - 7, 28, 15, [238, 248, 235]);
}
for (let x = 0; x < 400; x++) {
  const far = Math.round(133 + Math.sin(x / 53) * 15 + Math.cos(x / 27) * 7);
  const near = Math.round(176 + Math.sin(x / 38 + 1) * 13);
  background.rect(x, far, 1, 225 - far, [126, 178, 166]);
  background.rect(x, near, 1, 225 - near, [91, 151, 135]);
}
for (const [x, y] of [[40, 152], [128, 170], [278, 168], [367, 151]]) {
  background.rect(x + 5, y + 13, 4, 24, [81, 123, 114]);
  background.rect(x, y + 5, 15, 17, [78, 137, 122]);
  background.rect(x + 3, y, 9, 26, [78, 137, 122]);
}
savePng('background.png', background);

function saveTone(name: string, duration: number, frequencyAt: (t: number) => number): void {
  const sampleRate = 22050;
  const count = Math.round(duration * sampleRate);
  const wav = Buffer.alloc(44 + count * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM.
  wav.writeUInt16LE(1, 22); // Mono.
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(count * 2, 40);
  let phase = 0;
  for (let i = 0; i < count; i++) {
    const t = i / count;
    phase += frequencyAt(t) / sampleRate;
    const triangle = 1 - 4 * Math.abs(Math.round(phase) - phase);
    const envelope = Math.min(1, t * 30) * (1 - t) ** 2;
    wav.writeInt16LE(Math.round(triangle * envelope * 12000), 44 + i * 2);
  }
  writeFileSync(new URL(name, output), wav);
  console.log(`${name}: ${wav.length} bytes (${duration}s, mono PCM16, ${sampleRate} Hz)`);
}

saveTone('jump.wav', 0.16, (t) => 250 + 600 * t);
saveTone('coin.wav', 0.18, (t) => t < 0.45 ? 880 : 1320);
console.log(`Generated originals in ${fileURLToPath(output)}`);
