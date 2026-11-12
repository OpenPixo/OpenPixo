// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OPENPIXO_MODEL3D_PROMPT, type OpenPixoAccountStatus } from '@openpixo/contracts';
import { HostedImageCard } from '../../src/components/studio/HostedImageCard';
import { resetStudioCacheForTests } from '../../src/components/studio/studio-cache';
import { resetOpenPixoAccountStoreForTests } from '../../src/hooks/useOpenPixoAccount';

// three.js needs a real canvas; what the viewer draws has its own check.
vi.mock('../../src/components/Model3dViewer', () => ({
  Model3dViewer: ({ src, height }: { src: string; height?: number }) => <div data-testid="model3d-viewer" data-src={src} data-height={height} />,
}));

beforeEach(resetStudioCacheForTests);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetOpenPixoAccountStoreForTests(); });

const signedIn: OpenPixoAccountStatus = { availability: 'available', signedIn: true,
  user: { id: 'u1', email: 'dev@example.com', provider: 'email', displayName: 'Dev', avatarUrl: null } };
const pricing = { longPromptTokens: 2000, longPromptCredits: 1, maxPromptTokens: 3000, extraReferenceCredits: 1 };
const services = { generationPaused: false, services: [
  { id: 'openpixo-image', surface: 'image', label: 'GPT Image 2.5 Flare', credits: 2, priceVersion: 2, maxPromptChars: 12000,
    aspects: ['1:1', '2:3'], styles: [], references: { min: 0, max: 0 }, pricing },
  { id: 'openpixo-image-edit', surface: 'image', label: 'GPT Image 2.5 Flare edit', credits: 7, priceVersion: 2, maxPromptChars: 12000,
    aspects: ['1:1', '2:3'], styles: [], references: { min: 1, max: 4 }, pricing }] };
const quote = { quoteId: '0b9c8d7e-6f5a-4b3c-8d2e-1f0a9b8c7d6e', service: 'openpixo-image', credits: 2, priceVersion: 2,
  paramsDigest: 'a'.repeat(64), expiresAt: '2026-11-03T00:10:00.000Z', available: 40, breakdown: { base: 2, longPrompt: 0, extraReferences: 0 } };
const files = [{ name: 'sprites/slime.png' }, { name: 'sprites/bat.webp' }, { name: 'notes.md' }] as unknown as import('@openpixo/contracts').ProjectFile[];

type Reply = Record<string, unknown> | (() => Response);
function mockApi(options: { account?: OpenPixoAccountStatus; task?: Record<string, unknown>; quote?: Reply; generate?: () => Response } = {}) {
  const request = vi.fn(async (url: string, _init?: RequestInit) => {
    const path = new URL(url, 'http://localhost').pathname;
    if (path === '/api/openpixo/account') return Response.json(options.account ?? signedIn);
    if (path === '/api/openpixo/credits') return Response.json({ available: 40, reserved: 0, subscription: null });
    if (path === '/api/openpixo/cloud-media/services') return Response.json(services);
    if (path === '/api/projects/p1/media/openpixo-quote') {
      return typeof options.quote === 'function' ? options.quote() : Response.json(options.quote ?? quote);
    }
    if (path === '/api/projects/p1/media/generate') return options.generate?.() ?? Response.json({ taskId: 'task-1', status: 'running' }, { status: 202 });
    if (path === '/api/media/tasks/task-1/wait') return Response.json(options.task ?? { status: 'done', progress: [], nextSince: 0,
      file: { name: 'images/slime.png', creditsCharged: 2 } });
    return Response.json({});
  });
  vi.stubGlobal('fetch', request);
  return request;
}

const body = (call: unknown[] | undefined) => JSON.parse(String((call?.[1] as RequestInit | undefined)?.body));
const callsTo = (request: ReturnType<typeof mockApi>, suffix: string) => request.mock.calls.filter(call => String(call[0]).endsWith(suffix));
const errorReply = (code: string, status: number) => () => Response.json({ error: { code, message: code } }, { status });

function show(extra: Partial<Parameters<typeof HostedImageCard>[0]> = {}) {
  return render(<HostedImageCard projectId="p1" onSaved={async () => {}} onOpenFile={() => {}} {...extra} />);
}
async function fillPrompt(value = 'a pixel slime') {
  const card = within(await screen.findByTestId('studio-hosted-image'));
  fireEvent.change(await card.findByRole('textbox', { name: 'Prompt' }), { target: { value } });
  return card;
}

describe('Studio hosted image card', () => {
  it('generates in one click: quotes silently, spends at once and opens the saved image', async () => {
    const request = mockApi();
    const onSaved = vi.fn(async () => {});
    const onOpenFile = vi.fn();
    show({ onSaved, onOpenFile });
    const card = await fillPrompt();
    expect(card.getByText('About 2 credits')).toBeTruthy();
    fireEvent.click(card.getByRole('button', { name: 'Generate' }));

    expect(await card.findByText('Saved to images/slime.png.')).toBeTruthy();
    expect(body(callsTo(request, '/media/openpixo-quote')[0])).toEqual({ service: 'openpixo-image', prompt: 'a pixel slime', aspect: '1:1', images: [] });
    const generate = body(callsTo(request, '/media/generate')[0]);
    expect(generate).toMatchObject({ surface: 'image', model: 'openpixo-image', prompt: 'a pixel slime', aspect: '1:1', quoteId: quote.quoteId });
    expect(generate.images).toBeUndefined();
    expect(generate.cloudRequestId).toMatch(/^studio-[0-9a-f-]{36}$/);
    expect(onSaved).toHaveBeenCalledTimes(1);
    fireEvent.click(card.getByRole('button', { name: 'Open' }));
    expect(onOpenFile).toHaveBeenCalledWith('images/slime.png');
  });

  it('shows only an approximate cost: no balance, ledger, expiry or option prices', async () => {
    mockApi();
    const { container } = show();
    const card = await fillPrompt();
    expect(card.getByRole('combobox', { name: 'Service' }).textContent).not.toMatch(/credit/i);
    fireEvent.click(card.getByRole('button', { name: 'Generate' }));
    await card.findByText('Saved to images/slime.png.');
    expect(container.textContent).not.toMatch(/Available|Reserved|charged|Price|held until|40/);
  });

  it('updates the cost as the prompt grows and references are added', async () => {
    mockApi();
    show({ files });
    const card = await fillPrompt();
    fireEvent.change(card.getByRole('combobox', { name: 'Service' }), { target: { value: 'openpixo-image-edit' } });
    expect(card.getByText('About 7 credits')).toBeTruthy();
    fireEvent.click(card.getByRole('checkbox', { name: /bat.webp/ }));
    expect(card.getByText('About 7 credits')).toBeTruthy();
    fireEvent.click(card.getByRole('checkbox', { name: /slime.png/ }));
    expect(card.getByText('About 8 credits')).toBeTruthy();
    fireEvent.change(card.getByRole('textbox', { name: 'Prompt' }), { target: { value: '像'.repeat(2001) } });
    expect(card.getByText('About 9 credits')).toBeTruthy();
  });

  it('sends edit references in the order the user picked them', async () => {
    const request = mockApi({ quote: { ...quote, service: 'openpixo-image-edit', credits: 8, breakdown: { base: 7, longPrompt: 0, extraReferences: 1 } } });
    show({ files });
    const card = await fillPrompt('make it blue');
    fireEvent.change(card.getByRole('combobox', { name: 'Service' }), { target: { value: 'openpixo-image-edit' } });
    expect(card.getByRole('button', { name: 'Generate' }).hasAttribute('disabled')).toBe(true);
    expect(card.queryByRole('checkbox', { name: /notes.md/ })).toBeNull();
    fireEvent.click(card.getByRole('checkbox', { name: /bat.webp/ }));
    fireEvent.click(card.getByRole('checkbox', { name: /slime.png/ }));
    fireEvent.click(card.getByRole('button', { name: 'Generate' }));
    await card.findByText('Saved to images/slime.png.');
    expect(body(callsTo(request, '/media/openpixo-quote')[0])).toMatchObject({ service: 'openpixo-image-edit', images: ['sprites/bat.webp', 'sprites/slime.png'] });
    expect(body(callsTo(request, '/media/generate')[0])).toMatchObject({ model: 'openpixo-image-edit', images: ['sprites/bat.webp', 'sprites/slime.png'] });
  });

  it('never spends more than the button showed: a higher quote stops and asks', async () => {
    const request = mockApi({ quote: { ...quote, credits: 3, breakdown: { base: 2, longPrompt: 1, extraReferences: 0 } } });
    show();
    const card = await fillPrompt();
    fireEvent.click(card.getByRole('button', { name: 'Generate' }));
    const confirm = await card.findByRole('button', { name: 'Generate for 3 credits' });
    expect(card.getByText('This one costs 3 credits.')).toBeTruthy();
    expect(callsTo(request, '/media/generate')).toHaveLength(0);

    fireEvent.click(card.getByRole('button', { name: 'Cancel' }));
    expect(card.queryByRole('button', { name: 'Generate for 3 credits' })).toBeNull();
    expect(callsTo(request, '/media/generate')).toHaveLength(0);
    expect(confirm.isConnected).toBe(false);

    fireEvent.click(card.getByRole('button', { name: 'Generate' }));
    fireEvent.click(await card.findByRole('button', { name: 'Generate for 3 credits' }));
    await card.findByText('Saved to images/slime.png.');
    expect(callsTo(request, '/media/generate')).toHaveLength(1);
  });

  it('submits without asking when the quote is below the estimate', async () => {
    const request = mockApi({ quote: { ...quote, credits: 1 } });
    show();
    const card = await fillPrompt();
    fireEvent.click(card.getByRole('button', { name: 'Generate' }));
    await card.findByText('Saved to images/slime.png.');
    expect(callsTo(request, '/media/generate')).toHaveLength(1);
  });

  it('drops the stop for a higher price when the prompt changes', async () => {
    mockApi({ quote: { ...quote, credits: 3 } });
    show();
    const card = await fillPrompt();
    fireEvent.click(card.getByRole('button', { name: 'Generate' }));
    await card.findByRole('button', { name: 'Generate for 3 credits' });
    fireEvent.change(card.getByRole('textbox', { name: 'Prompt' }), { target: { value: 'a pixel bat' } });
    expect(card.queryByRole('button', { name: 'Generate for 3 credits' })).toBeNull();
    expect(card.getByRole('button', { name: 'Generate' })).toBeTruthy();
  });

  it('does not submit when the balance is short, and offers credits without printing the balance', async () => {
    const request = mockApi({ quote: { ...quote, available: 1 } });
    const onOpenAccount = vi.fn();
    const { container } = show({ onOpenAccount });
    const card = await fillPrompt();
    fireEvent.click(card.getByRole('button', { name: 'Generate' }));
    expect(await card.findByText("You don't have enough credits for this.")).toBeTruthy();
    expect(callsTo(request, '/media/generate')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/\b1 short\b|Available/);
    fireEvent.click(card.getByRole('button', { name: 'Get credits' }));
    expect(onOpenAccount).toHaveBeenCalledOnce();
  });

  it('treats INSUFFICIENT_CREDITS from the quote or the task the same way', async () => {
    const request = mockApi({ quote: errorReply('INSUFFICIENT_CREDITS', 402) });
    show({ onOpenAccount: () => {} });
    const card = await fillPrompt();
    fireEvent.click(card.getByRole('button', { name: 'Generate' }));
    await card.findByRole('button', { name: 'Get credits' });
    expect(callsTo(request, '/media/generate')).toHaveLength(0);
    cleanup();

    mockApi({ task: { status: 'failed', progress: [], nextSince: 0, error: { code: 'INSUFFICIENT_CREDITS', message: 'Not enough credits for this item.' } } });
    show({ onOpenAccount: () => {} });
    const second = await fillPrompt();
    fireEvent.click(second.getByRole('button', { name: 'Generate' }));
    await second.findByRole('button', { name: 'Get credits' });
    expect(second.queryByText(/Generation failed/)).toBeNull();
  });

  it('retries a failed submit with the same request id and quote, so it can never pay twice', async () => {
    let failing = true;
    const request = mockApi({ generate: () => failing ? errorReply('CLOUD_UNAVAILABLE', 503)() : Response.json({ taskId: 'task-1' }, { status: 202 }) });
    show();
    const card = await fillPrompt();
    fireEvent.click(card.getByRole('button', { name: 'Generate' }));
    const retry = await card.findByRole('button', { name: 'Try again' });
    failing = false;
    fireEvent.click(retry);
    await card.findByText('Saved to images/slime.png.');
    const [first, second] = callsTo(request, '/media/generate');
    expect(body(second).cloudRequestId).toBe(body(first).cloudRequestId);
    expect(body(second).quoteId).toBe(body(first).quoteId);
    expect(callsTo(request, '/media/openpixo-quote')).toHaveLength(1);
  });

  it('gets a fresh quote and a new request after a stale quote', async () => {
    let stale = true;
    const request = mockApi({ generate: () => stale ? errorReply('GENERATION_QUOTE_EXPIRED', 409)() : Response.json({ taskId: 'task-1' }, { status: 202 }) });
    show();
    const card = await fillPrompt();
    fireEvent.click(card.getByRole('button', { name: 'Generate' }));
    await card.findByRole('alert');
    expect(card.queryByRole('button', { name: 'Try again' })).toBeNull();
    stale = false;
    fireEvent.click(card.getByRole('button', { name: 'Generate' }));
    await card.findByText('Saved to images/slime.png.');
    expect(callsTo(request, '/media/openpixo-quote')).toHaveLength(2);
    const [first, second] = callsTo(request, '/media/generate');
    expect(body(second).cloudRequestId).not.toBe(body(first).cloudRequestId);
  });

  it('does not reuse a failed request once the prompt changes, and keeps the message', async () => {
    mockApi({ generate: errorReply('CLOUD_UNAVAILABLE', 503) });
    show();
    const card = await fillPrompt();
    fireEvent.click(card.getByRole('button', { name: 'Generate' }));
    await card.findByRole('button', { name: 'Try again' });
    fireEvent.change(card.getByRole('textbox', { name: 'Prompt' }), { target: { value: 'a pixel bat' } });
    expect(card.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(card.getByRole('button', { name: 'Generate' })).toBeTruthy();
    expect(card.getByText(/Generation failed/)).toBeTruthy();
  });

  it('reports a released failure', async () => {
    mockApi({ task: { status: 'failed', progress: [], nextSince: 0, error: { message: 'Hosted generation failed. Your 2 reserved credits were returned.' } } });
    show();
    const card = await fillPrompt();
    fireEvent.click(card.getByRole('button', { name: 'Generate' }));
    expect(await card.findByText(/Your 2 reserved credits were returned/)).toBeTruthy();
  });

  it('never tells a user who paid that nothing was charged', async () => {
    const paid = 'The image is paid and stored in your OpenPixo account, but downloading it failed. Restart OpenPixo to retry the download.';
    mockApi({ task: { status: 'failed', progress: [], nextSince: 0, error: { message: paid } } });
    show();
    const card = await fillPrompt();
    fireEvent.click(card.getByRole('button', { name: 'Generate' }));
    expect(await card.findByText(/paid and stored in your OpenPixo account/)).toBeTruthy();
    expect(card.queryByText(/Nothing was charged/)).toBeNull();
  });

  it('does not offer to pay again for a file that is paid and still waiting to download', async () => {
    const paid = 'The file is paid and waiting for you for 7 days, but downloading it failed. Restart OpenPixo to retry the download.';
    mockApi({ task: { status: 'failed', progress: [], nextSince: 0, error: { code: 'OPENPIXO_DOWNLOAD_FAILED', message: paid } } });
    show();
    const card = await fillPrompt();
    fireEvent.click(card.getByRole('button', { name: 'Generate' }));
    await card.findByText(/paid and waiting for you/);
    expect((card.getByRole('button', { name: 'Generate' }) as HTMLButtonElement).disabled).toBe(true);
    // Asking for something else is a new request, and the billing message stays beside it.
    fireEvent.change(card.getByRole('textbox'), { target: { value: 'a different hero' } });
    expect((card.getByRole('button', { name: 'Generate' }) as HTMLButtonElement).disabled).toBe(false);
    expect(card.getByText(/paid and waiting for you/)).toBeTruthy();
  });

  it('does not offer to pay again for a file whose download window has passed', async () => {
    const paid = 'This file was paid for, but its 7-day download window has passed. Contact support.';
    mockApi({ task: { status: 'failed', progress: [], nextSince: 0, error: { code: 'OPENPIXO_DOWNLOAD_FAILED', message: paid } } });
    show();
    const card = await fillPrompt();
    fireEvent.click(card.getByRole('button', { name: 'Generate' }));
    await card.findByText(/download window has passed/);
    expect((card.getByRole('button', { name: 'Generate' }) as HTMLButtonElement).disabled).toBe(true);
    expect(card.queryByText(/Nothing was charged/)).toBeNull();
  });

  it('keeps the content filter reason so the user knows to change the prompt', async () => {
    const blocked = 'The image was blocked by the content filter. Change the prompt and try again. Your 2 reserved credits were returned.';
    mockApi({ task: { status: 'failed', progress: [], nextSince: 0, error: { message: blocked } } });
    show();
    const card = await fillPrompt();
    fireEvent.click(card.getByRole('button', { name: 'Generate' }));
    expect(await card.findByText(/blocked by the content filter/)).toBeTruthy();
  });

  it('falls back to the released wording only when a failure says nothing', async () => {
    mockApi({ task: { status: 'failed', progress: [], nextSince: 0 } });
    show();
    const card = await fillPrompt();
    fireEvent.click(card.getByRole('button', { name: 'Generate' }));
    expect(await card.findByText(/Nothing was charged/)).toBeTruthy();
  });

  it('keeps the sign-in panel for a signed-out account', async () => {
    mockApi({ account: { availability: 'available', signedIn: false, user: null } });
    show();
    const card = within(await screen.findByTestId('studio-hosted-image'));
    expect(card.getByText(/Sign in to generate with credits/)).toBeTruthy();
    expect(card.queryByRole('button', { name: 'Generate' })).toBeNull();
  });

  it('tells the user what leaves the machine', async () => {
    mockApi();
    show();
    const card = await fillPrompt();
    expect(card.getByText(/prompt and any reference images you pick are sent to the media provider/)).toBeTruthy();
  });

  describe('audio', () => {
    const audioPricing = { longPromptTokens: 1000, longPromptCredits: 0, maxPromptTokens: 1000, extraReferenceCredits: 0 };
    const audio = { surface: 'audio', priceVersion: 1, aspects: [], references: { min: 0, max: 0 }, pricing: audioPricing };
    const withAudio = { generationPaused: false, services: [...services.services,
      { ...audio, id: 'openpixo-sfx', audioKind: 'sfx', label: 'Sound effect', credits: 7, maxPromptChars: 450, styles: [], durationSeconds: { min: 0.5, max: 10, default: 3 } },
      { ...audio, id: 'openpixo-voice', audioKind: 'speech', label: 'Voice line', credits: 5, maxPromptChars: 300, styles: ['Rachel', 'Aria'] },
      { ...audio, id: 'openpixo-music', audioKind: 'music', label: 'Music', credits: 10, maxPromptChars: 300, minPromptChars: 10, styles: [] },
    ] };
    const savedAudio = { status: 'done', progress: [], nextSince: 0, file: { name: 'audio/coin.mp3', creditsCharged: 7 } };

    function mockAudio(options: { task?: Record<string, unknown>; wait?: () => Response; catalogue?: unknown } = {}) {
      const base = mockApi({ task: options.task ?? savedAudio, quote: { ...quote, service: 'openpixo-sfx', credits: 5 } });
      const request = vi.fn(async (url: string, init?: RequestInit) => {
        const path = new URL(url, 'http://localhost').pathname;
        if (path === '/api/openpixo/cloud-media/services') return Response.json(options.catalogue ?? withAudio);
        if (path === '/api/media/tasks/task-1/wait' && options.wait) return options.wait();
        return base(url, init);
      });
      vi.stubGlobal('fetch', request);
      return request as unknown as ReturnType<typeof mockApi>;
    }
    const pick = async (name: string) => {
      const card = within(await screen.findByTestId('studio-hosted-image'));
      fireEvent.click(await card.findByRole('tab', { name }));
      return card;
    };
    const type = (card: ReturnType<typeof within>, value: string) => fireEvent.change(card.getByRole('textbox', { name: 'Prompt' }), { target: { value } });

    it('shows what can be made only when the catalogue has audio', async () => {
      mockApi();
      show();
      const images = await fillPrompt();
      expect(images.queryByRole('tablist')).toBeNull();
      cleanup();
      resetStudioCacheForTests();

      mockAudio();
      show();
      const card = within(await screen.findByTestId('studio-hosted-image'));
      expect((await card.findAllByRole('tab')).map(tab => tab.textContent)).toEqual(['Image', 'Sound effect', 'Voice line', 'Music']);
      cleanup();
      resetStudioCacheForTests();

      const sfxOnly = { generationPaused: false, services: [...services.services, withAudio.services[2]] };
      mockAudio({ catalogue: sfxOnly });
      show();
      const fewer = within(await screen.findByTestId('studio-hosted-image'));
      expect((await fewer.findAllByRole('tab')).map(tab => tab.textContent)).toEqual(['Image', 'Sound effect']);
    });

    it('keeps the service select to images, and hides shape and references for audio', async () => {
      mockAudio();
      show({ files });
      const card = await pick('Sound effect');
      expect(card.queryByRole('combobox', { name: 'Service' })).toBeNull();
      expect(card.queryByRole('combobox', { name: 'Aspect ratio' })).toBeNull();
      expect(card.queryByRole('checkbox')).toBeNull();
      expect(card.getByRole('textbox', { name: 'Prompt' }).getAttribute('placeholder')).toMatch(/coin pickup/);
      expect(card.getByText(/Your prompt is sent to the media provider/)).toBeTruthy();
      fireEvent.click(card.getByRole('tab', { name: 'Image' }));
      expect(card.getByRole('combobox', { name: 'Service' })).toBeTruthy();
      expect(card.getByRole('combobox', { name: 'Aspect ratio' })).toBeTruthy();
    });

    it('sends a sound effect with its length and no aspect, and estimates its flat price', async () => {
      const request = mockAudio();
      show();
      const card = await pick('Sound effect');
      type(card, 'a short coin pickup');
      expect(card.getByText('About 7 credits')).toBeTruthy();
      const length = card.getByRole('combobox', { name: 'Length' }) as HTMLSelectElement;
      expect(length.value).toBe('3');
      expect([...length.options].map(option => option.textContent)).toEqual(['1 s', '3 s', '5 s', '10 s']);
      fireEvent.change(length, { target: { value: '5' } });
      fireEvent.click(card.getByRole('button', { name: 'Generate' }));
      await card.findByText('Saved to audio/coin.mp3.');
      expect(body(callsTo(request, '/media/openpixo-quote')[0])).toEqual({ service: 'openpixo-sfx', prompt: 'a short coin pickup', duration: 5, images: [] });
      const generate = body(callsTo(request, '/media/generate')[0]);
      expect(generate).toMatchObject({ surface: 'audio', model: 'openpixo-sfx', prompt: 'a short coin pickup', duration: 5 });
      expect(generate).not.toHaveProperty('aspect');
      expect(generate).not.toHaveProperty('style');
      expect(generate.output).toMatch(/^audio\/a-short-coin-pickup-[0-9a-z]+\.mp3$/);
    });

    it('sends a voice line with its voice as the style, and counts near the limit', async () => {
      const request = mockAudio();
      show();
      const card = await pick('Voice line');
      expect(card.queryByRole('combobox', { name: 'Length' })).toBeNull();
      expect(card.queryByText(/characters$/)).toBeNull();
      type(card, 'x'.repeat(240));
      expect(card.getByText('240 / 300 characters')).toBeTruthy();
      type(card, 'Welcome back.');
      expect(card.queryByText(/characters$/)).toBeNull();
      fireEvent.change(card.getByRole('combobox', { name: 'Voice' }), { target: { value: 'Aria' } });
      expect(card.getByText('About 5 credits')).toBeTruthy();
      fireEvent.click(card.getByRole('button', { name: 'Generate' }));
      await card.findByText('Saved to audio/coin.mp3.');
      expect(body(callsTo(request, '/media/openpixo-quote')[0])).toEqual({ service: 'openpixo-voice', prompt: 'Welcome back.', style: 'Aria', images: [] });
      const generate = body(callsTo(request, '/media/generate')[0]);
      expect(generate).toMatchObject({ surface: 'audio', model: 'openpixo-voice', style: 'Aria' });
      expect(generate).not.toHaveProperty('duration');
      expect(generate).not.toHaveProperty('aspect');
    });

    it('blocks music below its shortest prompt, and says what music can\'t do', async () => {
      const request = mockAudio();
      show();
      const card = await pick('Music');
      expect(card.getByText("Music is instrumental, its length can't be chosen, and a track can take a few minutes.")).toBeTruthy();
      expect(card.queryByRole('combobox', { name: 'Length' })).toBeNull();
      type(card, 'too short');
      expect(card.getByRole('button', { name: 'Generate' }).hasAttribute('disabled')).toBe(true);
      expect(card.getByText('Write at least 10 characters.')).toBeTruthy();
      fireEvent.click(card.getByRole('button', { name: 'Generate' }));
      expect(callsTo(request, '/media/openpixo-quote')).toHaveLength(0);
      type(card, 'light 8-bit village');
      expect(card.getByRole('button', { name: 'Generate' }).hasAttribute('disabled')).toBe(false);
      expect(card.queryByText('Write at least 10 characters.')).toBeNull();
      expect(card.getByText('About 10 credits')).toBeTruthy();
      fireEvent.click(card.getByRole('button', { name: 'Generate' }));
      await card.findByText('Saved to audio/coin.mp3.');
      const generate = body(callsTo(request, '/media/generate')[0]);
      expect(generate).not.toHaveProperty('duration');
      expect(generate).not.toHaveProperty('style');
    });

    it.each([['Sound effect', 'sound'], ['Voice line', 'voice'], ['Music', 'music']])('names a %s from a Chinese prompt with a fallback', async (name, slug) => {
      const request = mockAudio();
      show();
      const card = await pick(name);
      type(card, '轻快的村庄音乐可循环播放');
      fireEvent.click(card.getByRole('button', { name: 'Generate' }));
      await card.findByText('Saved to audio/coin.mp3.');
      expect(body(callsTo(request, '/media/generate')[0]).output).toMatch(new RegExp(`^audio/${slug}-[0-9a-z]+\\.mp3$`));
    });

    it('plays the saved file and opens it', async () => {
      mockAudio();
      const onOpenFile = vi.fn();
      const onSaved = vi.fn(async () => {});
      show({ onOpenFile, onSaved });
      const card = await pick('Sound effect');
      type(card, 'a coin');
      fireEvent.click(card.getByRole('button', { name: 'Generate' }));
      await card.findByText('Saved to audio/coin.mp3.');
      const player = card.getByTestId('studio-hosted-audio') as HTMLAudioElement;
      expect(player.getAttribute('src')).toBe('/api/projects/p1/raw/audio/coin.mp3');
      expect(player.hasAttribute('controls')).toBe(true);
      expect(onSaved).toHaveBeenCalledOnce();
      fireEvent.click(card.getByRole('button', { name: 'Open' }));
      expect(onOpenFile).toHaveBeenCalledWith('audio/coin.mp3');
    });

    it('gives an image no player, and drops the player on moving to another kind', async () => {
      mockAudio();
      show();
      const card = await pick('Sound effect');
      type(card, 'a coin');
      fireEvent.click(card.getByRole('button', { name: 'Generate' }));
      await card.findByTestId('studio-hosted-audio');
      fireEvent.click(card.getByRole('tab', { name: 'Music' }));
      expect(card.queryByTestId('studio-hosted-audio')).toBeNull();
    });

    it('keeps each kind\'s own prompt', async () => {
      mockAudio();
      show();
      const card = await pick('Voice line');
      type(card, 'Welcome back.');
      fireEvent.click(card.getByRole('tab', { name: 'Sound effect' }));
      expect((card.getByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement).value).toBe('');
      fireEvent.click(card.getByRole('tab', { name: 'Voice line' }));
      expect((card.getByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement).value).toBe('Welcome back.');
    });

    it('still stops when the quote is above what the button showed', async () => {
      const base = mockAudio();
      const request = vi.fn(async (url: string, init?: RequestInit) => String(url).endsWith('/media/openpixo-quote')
        ? Response.json({ ...quote, service: 'openpixo-sfx', credits: 9 }) : base(url, init));
      vi.stubGlobal('fetch', request);
      show();
      const card = await pick('Sound effect');
      type(card, 'a coin');
      fireEvent.click(card.getByRole('button', { name: 'Generate' }));
      expect(await card.findByRole('button', { name: 'Generate for 9 credits' })).toBeTruthy();
      expect(callsTo(request as unknown as ReturnType<typeof mockApi>, '/media/generate')).toHaveLength(0);
    });

    it('does not read a dropped wait as a failure: the job is still running and can still charge', async () => {
      let waits = 0;
      mockAudio({ wait: () => {
        waits += 1;
        if (waits === 1) throw new TypeError('network dropped');
        if (waits === 2) return Response.json({ error: { message: 'daemon restarting' } }, { status: 503 });
        return Response.json(savedAudio);
      } });
      show();
      const card = await pick('Sound effect');
      type(card, 'a coin');
      fireEvent.click(card.getByRole('button', { name: 'Generate' }));
      await waitFor(() => expect(card.getByText('Saved to audio/coin.mp3.')).toBeTruthy(), { timeout: 6000 });
      expect(card.queryByText(/Generation failed/)).toBeNull();
      expect(waits).toBe(3);
    }, 10_000);

    it('ends the wait when the daemon refuses it', async () => {
      mockAudio({ wait: () => Response.json({ error: { code: 'FORBIDDEN', message: 'task not found' } }, { status: 404 }) });
      show();
      const card = await pick('Sound effect');
      type(card, 'a coin');
      fireEvent.click(card.getByRole('button', { name: 'Generate' }));
      expect(await card.findByText(/Generation failed/)).toBeTruthy();
    });
  });

  describe('3D', () => {
    const model3d = { id: 'openpixo-model3d', surface: 'model3d', label: '3D model', credits: 60, priceVersion: 1, maxPromptChars: 200,
      aspects: ['1:1'], styles: ['ignored'], references: { min: 1, max: 1 }, pricing };
    const sfx = { id: 'openpixo-sfx', surface: 'audio', audioKind: 'sfx', label: 'Sound effect', credits: 7, priceVersion: 1, maxPromptChars: 450,
      aspects: [], styles: [], references: { min: 0, max: 0 }, pricing, durationSeconds: { min: 0.5, max: 10, default: 3 } };
    const catalogue = { generationPaused: false, services: [...services.services, sfx, model3d] };
    const modelQuote = { ...quote, service: 'openpixo-model3d', credits: 60, available: 400, breakdown: { base: 60, longPrompt: 0, extraReferences: 0 } };
    const savedModel = { status: 'done', progress: [], nextSince: 0, file: { name: 'models/slime-abc.glb', creditsCharged: 60 } };

    function mockModel(options: { quote?: Record<string, unknown>; task?: Record<string, unknown> } = {}) {
      const base = mockApi({ task: options.task ?? savedModel, quote: options.quote ?? modelQuote });
      const request = vi.fn(async (url: string, init?: RequestInit) => {
        if (new URL(url, 'http://localhost').pathname === '/api/openpixo/cloud-media/services') return Response.json(catalogue);
        return base(url, init);
      });
      vi.stubGlobal('fetch', request);
      return request as unknown as ReturnType<typeof mockApi>;
    }
    const pickModel = async () => {
      const card = within(await screen.findByTestId('studio-hosted-image'));
      fireEvent.click(await card.findByRole('tab', { name: '3D model' }));
      return card;
    };

    it('adds its tab last, and only when the catalogue has it', async () => {
      mockModel();
      show({ files });
      const card = within(await screen.findByTestId('studio-hosted-image'));
      expect((await card.findAllByRole('tab')).map(tab => tab.textContent)).toEqual(['Image', 'Sound effect', '3D model']);
      cleanup();
      resetStudioCacheForTests();
      mockApi();
      show({ files });
      const without = await fillPrompt();
      expect(without.queryByRole('tab', { name: '3D model' })).toBeNull();
    });

    it('offers three quality tiers, draft to high, starting at medium, and quotes the one picked', async () => {
      const tiers = { generationPaused: false, services: [...services.services,
        { ...model3d, id: 'openpixo-model3d-high', quality: 'high', label: '3D model (high)', credits: 120 },
        { ...model3d, id: 'openpixo-model3d-draft', quality: 'draft', label: '3D model (draft)', credits: 20 },
        { ...model3d, quality: 'medium' }] };
      const base = mockApi({ task: savedModel, quote: { ...modelQuote, service: 'openpixo-model3d-high', credits: 120 } });
      const request = vi.fn(async (url: string, init?: RequestInit) => {
        if (new URL(url, 'http://localhost').pathname === '/api/openpixo/cloud-media/services') return Response.json(tiers);
        return base(url, init);
      });
      vi.stubGlobal('fetch', request);
      show({ files });
      const card = await pickModel();
      const quality = within(card.getByRole('tablist', { name: 'Quality' }));
      const tabs = quality.getAllByRole('tab');
      expect(tabs.map(tab => tab.textContent)).toEqual(['Draft 20', 'Medium 60', 'High 120']);
      expect(tabs.map(tab => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
      expect(card.getByText('Good for most props and characters.')).toBeTruthy();
      expect(card.getByText('About 60 credits')).toBeTruthy();
      // The tiers replace the service picker, so there is still nothing else to choose.
      expect(card.queryByRole('combobox')).toBeNull();
      fireEvent.click(quality.getByRole('tab', { name: /High/ }));
      expect(card.getByText('About 120 credits')).toBeTruthy();
      expect(card.getByText(/Costs twice as much as Medium/)).toBeTruthy();
      fireEvent.click(card.getByRole('checkbox', { name: /slime.png/ }));
      fireEvent.click(card.getByRole('button', { name: 'Generate' }));
      await card.findByText('Saved to models/slime-abc.glb.');
      expect(body(callsTo(request as unknown as ReturnType<typeof mockApi>, '/media/openpixo-quote')[0])).toEqual({ service: 'openpixo-model3d-high', prompt: OPENPIXO_MODEL3D_PROMPT, images: ['sprites/slime.png'] });
      expect(body(callsTo(request as unknown as ReturnType<typeof mockApi>, '/media/generate')[0])).toMatchObject({ surface: 'model3d', model: 'openpixo-model3d-high' });
    });

    it('asks for one picture and nothing else, and states its flat price', async () => {
      mockModel();
      show({ files });
      const card = await pickModel();
      expect(card.queryByRole('textbox')).toBeNull();
      expect(card.queryByRole('combobox')).toBeNull();
      expect(card.getByText(/three-quarter view/)).toBeTruthy();
      expect(card.queryByText(/in the order you want/)).toBeNull();
      expect(card.getByText(/The picture you choose is sent to the media provider/)).toBeTruthy();
      expect(card.getByText('About 60 credits')).toBeTruthy();
      expect(card.getByRole('button', { name: 'Generate' }).hasAttribute('disabled')).toBe(true);
      fireEvent.click(card.getByRole('checkbox', { name: /slime.png/ }));
      expect(card.getByText('About 60 credits')).toBeTruthy();
      expect(card.getByRole('button', { name: 'Generate' }).hasAttribute('disabled')).toBe(false);
      expect(card.getByRole('checkbox', { name: /bat.webp/ }).hasAttribute('disabled')).toBe(true);
    });

    it('quotes the fixed prompt with the picture, then saves a model named after it', async () => {
      const request = mockModel();
      const onOpenFile = vi.fn();
      show({ files, onOpenFile });
      const card = await pickModel();
      fireEvent.click(card.getByRole('checkbox', { name: /slime.png/ }));
      fireEvent.click(card.getByRole('button', { name: 'Generate' }));
      await card.findByText('Saved to models/slime-abc.glb.');
      expect(body(callsTo(request, '/media/openpixo-quote')[0])).toEqual({ service: 'openpixo-model3d', prompt: OPENPIXO_MODEL3D_PROMPT, images: ['sprites/slime.png'] });
      const generate = body(callsTo(request, '/media/generate')[0]);
      expect(generate).toMatchObject({ surface: 'model3d', model: 'openpixo-model3d', prompt: OPENPIXO_MODEL3D_PROMPT, images: ['sprites/slime.png'], quoteId: modelQuote.quoteId });
      expect(generate.output).toMatch(/^models\/slime-[0-9a-z]+\.glb$/);
      expect(generate.aspect).toBeUndefined();
      expect(generate.style).toBeUndefined();
      expect(generate.duration).toBeUndefined();
      const viewer = card.getByTestId('model3d-viewer');
      expect(viewer.getAttribute('data-src')).toBe('/api/projects/p1/raw/models/slime-abc.glb');
      expect(Number(viewer.getAttribute('data-height'))).toBeLessThanOrEqual(240);
      expect(card.queryByTestId('studio-hosted-audio')).toBeNull();
      fireEvent.click(card.getByRole('button', { name: 'Open' }));
      expect(onOpenFile).toHaveBeenCalledWith('models/slime-abc.glb');
    });

    it('still stops when the quote is above the number on the button', async () => {
      const request = mockModel({ quote: { ...modelQuote, credits: 61 } });
      show({ files });
      const card = await pickModel();
      fireEvent.click(card.getByRole('checkbox', { name: /slime.png/ }));
      fireEvent.click(card.getByRole('button', { name: 'Generate' }));
      expect(await card.findByText('This one costs 61 credits.')).toBeTruthy();
      expect(callsTo(request, '/media/generate')).toHaveLength(0);
    });

    it('stops at a short balance without spending', async () => {
      const request = mockModel({ quote: { ...modelQuote, available: 59 } });
      show({ files });
      const card = await pickModel();
      fireEvent.click(card.getByRole('checkbox', { name: /slime.png/ }));
      fireEvent.click(card.getByRole('button', { name: 'Generate' }));
      expect(await card.findByText("You don't have enough credits for this.")).toBeTruthy();
      expect(callsTo(request, '/media/generate')).toHaveLength(0);
    });

    it('drops the saved model and the picture on moving to another kind', async () => {
      mockModel();
      show({ files });
      const card = await pickModel();
      fireEvent.click(card.getByRole('checkbox', { name: /slime.png/ }));
      fireEvent.click(card.getByRole('button', { name: 'Generate' }));
      await card.findByTestId('model3d-viewer');
      fireEvent.click(card.getByRole('tab', { name: 'Sound effect' }));
      expect(card.queryByTestId('model3d-viewer')).toBeNull();
      fireEvent.click(card.getByRole('tab', { name: '3D model' }));
      expect(card.queryByTestId('model3d-viewer')).toBeNull();
      expect((card.getByRole('checkbox', { name: /slime.png/ }) as HTMLInputElement).checked).toBe(false);
    });

    it('gives an image and a sound what they always had, and no viewer', async () => {
      mockApi();
      show({ files });
      const card = await fillPrompt();
      fireEvent.click(card.getByRole('button', { name: 'Generate' }));
      await card.findByText('Saved to images/slime.png.');
      expect(card.queryByTestId('model3d-viewer')).toBeNull();
      expect(card.queryByTestId('studio-hosted-audio')).toBeNull();
    });
  });

  it('stays hidden when this build has no cloud', async () => {
    const request = mockApi({ account: { availability: 'not_configured', signedIn: false, user: null } });
    const { container } = show();
    await waitFor(() => expect(request.mock.calls.some(call => String(call[0]).includes('/account'))).toBe(true));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(container.innerHTML).toBe('');
  });
});
