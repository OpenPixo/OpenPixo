import { expect, test } from 'vitest';

import { resolveSafePromptImagePaths } from '../src/server.js';


test('resolveSafePromptImagePaths rejects images larger than 1 MB', () => {
  const result = resolveSafePromptImagePaths(
    ['/tmp/pixo-uploads/too-large.png', '/tmp/pixo-uploads/ok.png'],
    {
      uploadDir: '/tmp/pixo-uploads',
      existsSync: () => true,
      statSync: (inputPath: string) => ({
        isFile: () => true,
        size: inputPath.endsWith('too-large.png') ? 1024 * 1024 + 1 : 1024,
      }),
    },
  );

  expect(result.safeImages).toEqual(['/tmp/pixo-uploads/ok.png']);
  expect(result.oversizedImages).toEqual([
    { path: '/tmp/pixo-uploads/too-large.png', sizeBytes: 1024 * 1024 + 1 },
  ]);
});

test('resolveSafePromptImagePaths keeps images at or below 1 MB', () => {
  const result = resolveSafePromptImagePaths(
    ['/tmp/pixo-uploads/exactly-1mb.png'],
    {
      uploadDir: '/tmp/pixo-uploads',
      existsSync: () => true,
      statSync: () => ({
        isFile: () => true,
        size: 1024 * 1024,
      }),
    },
  );

  expect(result.safeImages).toEqual(['/tmp/pixo-uploads/exactly-1mb.png']);
  expect(result.oversizedImages).toEqual([]);
});

test('resolveSafePromptImagePaths surfaces stat failures instead of dropping the image', () => {
  const result = resolveSafePromptImagePaths(['/tmp/pixo-uploads/unreadable.png'], {
    uploadDir: '/tmp/pixo-uploads',
    existsSync: () => true,
    statSync: () => {
      throw Object.assign(new Error('EACCES: permission denied'), {
        code: 'EACCES',
      });
    },
  });

  expect(result.safeImages).toEqual([]);
  expect(result.oversizedImages).toEqual([]);
  expect(result.failedImages).toEqual([
    { path: '/tmp/pixo-uploads/unreadable.png', error: 'EACCES: permission denied' },
  ]);
});
