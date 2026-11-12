import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveChatRunFirstOutputTimeoutMs,
  resolveChatRunInactivityTimeoutMs,
} from '../../src/server.js';

const INACTIVITY = 'PIXO_CHAT_RUN_INACTIVITY_TIMEOUT_MS';
const FIRST_OUTPUT = 'PIXO_CHAT_RUN_FIRST_OUTPUT_TIMEOUT_MS';
const original: Record<string, string | undefined> = {
  [INACTIVITY]: process.env[INACTIVITY],
  [FIRST_OUTPUT]: process.env[FIRST_OUTPUT],
};

afterEach(() => {
  for (const key of [INACTIVITY, FIRST_OUTPUT]) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe('operator chat watchdog configuration', () => {
  it('defaults to ten minutes of inactivity and no absolute first-output deadline', () => {
    delete process.env[INACTIVITY];
    delete process.env[FIRST_OUTPUT];
    expect(resolveChatRunInactivityTimeoutMs()).toBe(600_000);
    expect(resolveChatRunFirstOutputTimeoutMs()).toBe(0);
  });

  it('accepts operator inactivity and first-output deadlines', () => {
    process.env[INACTIVITY] = '900000';
    process.env[FIRST_OUTPUT] = '90000';
    expect(resolveChatRunInactivityTimeoutMs()).toBe(900_000);
    expect(resolveChatRunFirstOutputTimeoutMs()).toBe(90_000);
  });

  it('lets the operator disable either watchdog', () => {
    process.env[INACTIVITY] = '0';
    process.env[FIRST_OUTPUT] = '0';
    expect(resolveChatRunInactivityTimeoutMs()).toBe(0);
    expect(resolveChatRunFirstOutputTimeoutMs()).toBe(0);
  });

  it('uses defaults for invalid operator values', () => {
    process.env[INACTIVITY] = 'not-a-number';
    process.env[FIRST_OUTPUT] = 'not-a-number';
    expect(resolveChatRunInactivityTimeoutMs()).toBe(600_000);
    expect(resolveChatRunFirstOutputTimeoutMs()).toBe(0);
  });

  it('clamps oversized deadlines to the Node timer-safe ceiling', () => {
    process.env[INACTIVITY] = String(24 * 60 * 60 * 1000 * 100);
    process.env[FIRST_OUTPUT] = process.env[INACTIVITY];
    expect(resolveChatRunInactivityTimeoutMs()).toBe(24 * 60 * 60 * 1000);
    expect(resolveChatRunFirstOutputTimeoutMs()).toBe(24 * 60 * 60 * 1000);
  });
});
