import { describe, expect, it } from 'vitest';
import { apiProtocolLabel, apiProtocolModelLabel } from '../../src/utils/apiProtocol';
import {
  agentDisplayName,
  agentModelDisplayName,
} from '../../src/utils/agentLabels';

describe('api protocol labels', () => {
  it('labels the selected API protocol instead of assuming Anthropic', () => {
    expect(apiProtocolLabel('openai')).toBe('OpenAI API');
    expect(apiProtocolLabel('google')).toBe('Google Gemini');
    expect(apiProtocolLabel(undefined)).toBe('Anthropic API');
  });

  it('includes the selected model when labeling API assistant messages', () => {
    expect(apiProtocolModelLabel('openai', 'google/gemma-4-e4b')).toBe(
      'OpenAI API via OpenCode · google/gemma-4-e4b',
    );
    expect(apiProtocolModelLabel('azure', '  ')).toBe('Azure OpenAI via OpenCode');
  });

  it('labels canonical DeepSeek and OpenRouter as native Codex without reclassifying other API providers', () => {
    expect(apiProtocolModelLabel('openai', 'deepseek-flash', 'https://api.deepseek.com')).toBe('DeepSeek via Codex · deepseek-flash');
    expect(apiProtocolModelLabel('openai', 'anthropic/claude-sonnet-4.6', 'https://openrouter.ai/api/v1')).toBe('OpenRouter via Codex · anthropic/claude-sonnet-4.6');
    expect(apiProtocolModelLabel('anthropic', 'deepseek-v4-flash', 'https://api.deepseek.com/anthropic')).toBe('Anthropic API via OpenCode · deepseek-v4-flash');
    expect(apiProtocolModelLabel('openai', 'custom', 'https://api.deepseek.com.example.org')).toBe('OpenAI API via OpenCode · custom');
  });

  it('includes explicit local CLI models when labeling agent messages', () => {
    expect(agentModelDisplayName('claude', 'Claude Code', 'claude-sonnet-4-6')).toBe(
      'Claude · claude-sonnet-4-6',
    );
    expect(agentModelDisplayName('claude', 'Claude Code', 'default')).toBe('Claude');
  });

  it('labels OpenCode-backed BYOK protocol agent ids', () => {
    expect(agentDisplayName('senseaudio-api')).toBe('SenseAudio API via OpenCode');
  });
});
