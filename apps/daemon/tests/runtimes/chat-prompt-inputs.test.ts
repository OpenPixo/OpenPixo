import { describe, expect, it } from 'vitest';
import { composeChatAgentTextPayload } from '../../src/runtimes/chat-prompt-inputs.js';

describe('ordinary chat prompt composition', () => {
  it('preserves the ordinary Markdown prompt byte-for-byte', () => {
    const result = composeChatAgentTextPayload({
      formOverride: '[form override]\n',
      daemonSystemPrompt: '  daemon system  ',
      runtimeToolPrompt: 'runtime tools',
      researchCommandContract: 'research contract',
      runContextPrompt: 'run context',
      connectedExternalMcpReference: 'connected MCP: figma',
      browserUnavailableGuard: 'browser unavailable',
      titleGenerationDirective: 'emit title marker',
      clientSystemPrompt: 'client system',
      cwdReference: '\n\nworkspace: `/project`',
      linkedDirectoryReferences: '\n\nlinked: `/code`',
      echoGuard: '\n\ndo not echo',
      requestOrStageText: 'Build the dashboard.',
      projectAttachmentReferences: '\n\nattachment: `brief.md`',
      imageReferences: '@/uploads/a.png @/uploads/b.png',
    });

    const clientInstruction = [
      'research contract',
      'run context',
      'connected MCP: figma',
      'browser unavailable',
      'emit title marker',
      'client system',
    ].join('\n\n---\n\n');
    const instruction = [
      'daemon system',
      'runtime tools',
      clientInstruction,
    ].join('\n\n---\n\n');
    expect(result.clientInstructionPrompt).toBe(clientInstruction);
    expect(result.instructionPrompt).toBe(instruction);
    expect(result.composedPrompt).toBe(
      '# Instructions (read first)\n\n'
      + '[form override]\n'
      + instruction
      + '\n\nworkspace: `/project`'
      + '\n\nlinked: `/code`'
      + '\n\ndo not echo\n\n---\n'
      + '# User request\n\nBuild the dashboard.'
      + '\n\nattachment: `brief.md`'
      + '\n\n@/uploads/a.png @/uploads/b.png',
    );
  });

});
