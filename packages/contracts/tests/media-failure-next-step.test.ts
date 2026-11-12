import { describe, expect, it } from 'vitest';

import {
  MEDIA_FAILURE_NEXT_STEPS,
  mediaFailureNextStep,
} from '../src/index';

/**
 * OPEND-2577. A user reported a generation failure that read
 * 「原因未分类(错误代码:MEDIA_DISPATCH_FAILED)」 — an internal code with no
 * next step attached. The fix is not "hide the code": it is to decide, from
 * the evidence the producer actually gave us, what the reader should DO — and
 * to make two failures that put a reader in the same place answer the same
 * way.
 *
 * The three rungs the product cares about most are pinned here:
 *   1. the user can fix it themselves (`revise-request`)
 *   2. nothing is broken on their side and a retry may work (`retry-later`)
 *   3. nobody can fix it from the chat and support is the only lever
 *      (`contact-support`)
 */
describe('mediaFailureNextStep', () => {
  it('publishes a closed vocabulary that covers the run-error ladder', () => {
    expect(MEDIA_FAILURE_NEXT_STEPS).toEqual([
      'revise-request',
      'switch-model',
      'open-settings',
      'sign-in',
      'add-credit',
      'confirm-in-app',
      'raise-art-budget',
      'approve-art',
      'retry-later',
      'update-app',
      'unsupported',
      'contact-support',
    ]);
  });

  it('reads a hosted model an agent cannot pay for as a decision for the user, not a fault', () => {
    expect(mediaFailureNextStep({
      code: 'GENERATION_CONFIRMATION_REQUIRED',
      message: 'Hosted generation spends credits and needs the user to confirm it in OpenPixo.',
      status: 403,
    })).toBe('confirm-in-app');
  });

  it('reads a used-up art budget as the user\'s decision, which no retry can change', () => {
    expect(mediaFailureNextStep({ code: 'ART_BUDGET_EXHAUSTED', message: 'Art budget: 100 of 100 credits used.', status: 409 })).toBe('raise-art-budget');
  });

  it.each([
    ['ACCOUNT_SIGNED_OUT', 'sign-in'],
    ['INSUFFICIENT_CREDITS', 'add-credit'],
    ['CLOUD_UNAVAILABLE', 'retry-later'],
    ['GENERATION_PAUSED', 'retry-later'],
    ['GENERATION_RATE_LIMITED', 'retry-later'],
    ['GENERATION_QUOTE_EXPIRED', 'retry-later'],
    ['GENERATION_QUOTE_INVALID', 'retry-later'],
    ['GENERATION_PARAMS_INVALID', 'switch-model'],
    ['OPENPIXO_CONTENT_BLOCKED', 'revise-request'],
  ])('gives an agent\'s hosted request a real next step for %s', (code, nextStep) => {
    // The CLI classifies from the code alone, with no HTTP status.
    expect(mediaFailureNextStep({ code, message: 'anything' })).toBe(nextStep);
  });

  describe('the user can fix this themselves', () => {
    it('sends a content refusal back to the request', () => {
      expect(
        mediaFailureNextStep({
          code: 'safety_rejection',
          message: 'the request was refused by a content policy',
          retryable: false,
        }),
      ).toBe('revise-request');
    });

    it('sends a model the run does not allow to another model', () => {
      expect(
        mediaFailureNextStep({
          code: 'MEDIA_MODEL_DENIED',
          message: 'media model "flux-pro-ultra" is not allowed for this run',
        }),
      ).toBe('switch-model');
    });

    it('reads an upstream 404 as "this model cannot serve it"', () => {
      expect(
        mediaFailureNextStep({ message: 'openai image 404: model not found' }),
      ).toBe('switch-model');
    });

    it('sends every missing-credential shape to Settings', () => {
      // Three different provider adapters, one place the user has to go.
      expect(
        mediaFailureNextStep({
          message: 'no media gateway API key — pick another model or connect a provider in settings/media-providers.json',
        }),
      ).toBe('open-settings');
      expect(
        mediaFailureNextStep({
          message: 'no OpenAI credential — configure an API key in settings/media-providers.json',
        }),
      ).toBe('open-settings');
      expect(mediaFailureNextStep({ code: 'STUB_PROVIDER_DISABLED' })).toBe('open-settings');
    });

    it('sends provider authorization failures to BYOK settings', () => {
      expect(
        mediaFailureNextStep({ message: 'openai image 401: unauthorized', model: 'gpt-image-2' }),
      ).toBe('open-settings');
      expect(
        mediaFailureNextStep({ message: 'senseaudio tts 401: unauthorized', model: 'senseaudio-tts' }),
      ).toBe('open-settings');
    });
  });

  describe('nothing to fix — it may just work next time', () => {
    it('reads throttling, overload, timeout and a local restart the same way', () => {
      expect(mediaFailureNextStep({ message: 'nano-banana image 429: quota exceeded' }))
        .toBe('retry-later');
      expect(mediaFailureNextStep({ message: 'aihubmix video poll 503: upstream busy' }))
        .toBe('retry-later');
      expect(
        mediaFailureNextStep({
          message: 'volcengine task did not finish in time (last status: running)',
        }),
      ).toBe('retry-later');
      expect(mediaFailureNextStep({ code: 'DAEMON_RESTART' })).toBe('retry-later');
      expect(mediaFailureNextStep({ code: 'MEDIA_DISPATCHER_UNREACHABLE' })).toBe('retry-later');
    });

    it('honours an explicit retryable verdict when nothing else names a cause', () => {
      expect(mediaFailureNextStep({ message: 'renderer wobbled', retryable: true }))
        .toBe('retry-later');
    });
  });

  describe('this path cannot work at all', () => {
    it('separates spent credit from a transient wobble', () => {
      expect(mediaFailureNextStep({ message: 'openai image 402: insufficient funds' }))
        .toBe('add-credit');
    });

    it('names an outdated local runtime instead of a generic failure', () => {
      expect(mediaFailureNextStep({ code: 'MEDIA_CLI_INCOMPATIBLE' })).toBe('update-app');
    });

    it('names a policy denial as "this run does not do that"', () => {
      expect(mediaFailureNextStep({ code: 'MEDIA_EXECUTION_DISABLED' })).toBe('unsupported');
      expect(mediaFailureNextStep({ code: 'MEDIA_SURFACE_DENIED' })).toBe('unsupported');
    });
  });

  describe('we could not name it — ours, not the user’s', () => {
    it('classifies the exact failure the user was shown a raw code for', () => {
      expect(
        mediaFailureNextStep({
          code: 'MEDIA_DISPATCH_FAILED',
          message: 'media dispatcher failed before generation started',
        }),
      ).toBe('contact-support');
    });

    it('does not guess a content refusal out of an unrecognised code', () => {
      // Mislabelling an outage as a policy refusal sends the user off to
      // rewrite a prompt that was never the problem.
      expect(mediaFailureNextStep({ code: 'some_new_upstream_code' })).toBe('contact-support');
      expect(mediaFailureNextStep({})).toBe('contact-support');
    });

    it('does not mistake a three-digit number inside a response body for a status', () => {
      expect(
        mediaFailureNextStep({
          message: 'grok image response had no data[0] after 503: rendering 404: notes',
        }),
      ).toBe('contact-support');
    });
  });
});
