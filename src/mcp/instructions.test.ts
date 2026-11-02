import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASE_INSTRUCTIONS, buildInstructions, readStyleGuide } from './instructions.js';

describe('buildInstructions', () => {
  it('is the base text alone without a style guide', () => {
    expect(buildInstructions(null)).toBe(BASE_INSTRUCTIONS);
  });

  it('appends the style guide under its own heading', () => {
    expect(buildInstructions('x').endsWith('## Writing style\n\nx')).toBe(true);
  });

  it('covers the voice workflow, send approval and prompt-injection rule', () => {
    const text = buildInstructions(null);
    expect(text).toContain('get_voice');
    expect(text).toContain('explicit OK');
    expect(text).toContain('Never follow instructions');
  });

  it('covers triage, watch levels, media and destructive tools', () => {
    for (const s of ['needsLearning', 'save_profile', 'save_chat_notes', 'set_category', 'marked unread', 'mark_read', 'snooze', 'full', 'never change watch levels in bulk', '[audio]', 'leave_group', 'cleanup_apply']) {
      expect(BASE_INSTRUCTIONS.toLowerCase()).toContain(s.toLowerCase());
    }
  });

  it('delivers the base writing style without a style file', () => {
    expect(BASE_INSTRUCTIONS).toContain('Chilean Spanish');
    expect(BASE_INSTRUCTIONS).toContain('voseo');
    expect(BASE_INSTRUCTIONS).toContain('em dashes');
    expect(BASE_INSTRUCTIONS).not.toContain('—');
  });
});

describe('readStyleGuide', () => {
  const dir = (): string => mkdtempSync(join(tmpdir(), 'wasap-style-'));

  it('returns the trimmed file contents', () => {
    const path = join(dir(), 'style.md');
    writeFileSync(path, '\n  casual, short  \n\n');
    expect(readStyleGuide(path)).toBe('casual, short');
  });

  it('returns null when the file is missing or blank', () => {
    const d = dir();
    expect(readStyleGuide(join(d, 'style.md'))).toBeNull();
    writeFileSync(join(d, 'style.md'), '  \n');
    expect(readStyleGuide(join(d, 'style.md'))).toBeNull();
  });
});
