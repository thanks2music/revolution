/**
 * Templates validator, command line (Layer 1 with the validation itself mocked): exit codes, flags, and what
 * `--redact` lets through on every path.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import type { TemplateIssue } from '@/lib/templates-validation/issues';

const MARKER = '作品MARKER-value';
let outcome: TemplateIssue[] | Error = [];

jest.mock('@/lib/templates-validation/index', () => ({
  validateTemplates: async () => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  },
}));

import { runCli, USAGE } from '@/lib/templates-validation/cli';
import { TemplatesLayoutError } from '@/lib/templates-validation/layout';

async function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, { log: (m) => out.push(m), error: (m) => err.push(m) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const issue: TemplateIssue = { rule: 'title/slug-duplicate', file: 'ai-writer/config/t.yaml', at: `titles["${MARKER}"]`, message: MARKER };

describe('runCli', () => {
  beforeEach(() => {
    outcome = [];
  });

  it('exits 0 when the templates are valid', async () => {
    expect(await run(['--dir', '/t'])).toEqual({ code: 0, out: 'Templates are valid (0 issues).', err: '' });
  });

  it('exits 1 with the issues, and accepts --dir=<path>', async () => {
    outcome = [issue];
    const result = await run(['--dir=/t']);
    expect(result.code).toBe(1);
    expect(result.err).toContain(MARKER);
  });

  it('keeps values out of the redacted report', async () => {
    outcome = [issue];
    const result = await run(['--dir', '/t', '--redact']);
    expect(result).toMatchObject({ code: 1, err: expect.stringContaining('title/slug-duplicate in ai-writer/config/t.yaml: 1') });
    expect(result.err).not.toContain('MARKER');
  });

  it('exits 2 when the validator cannot run, and redacts the error unless it is a layout error', async () => {
    outcome = new Error(`failed near ${MARKER}`);
    const redacted = await run(['--dir', '/t', '--redact']);
    expect(redacted.code).toBe(2);
    expect(redacted.err).toBe('The validator could not run (Error; details redacted).');

    expect((await run(['--dir', '/t'])).err).toContain(MARKER);

    outcome = new TemplatesLayoutError('/t is not a templates directory');
    expect(await run(['--dir', '/t', '--redact'])).toMatchObject({ code: 2, err: '/t is not a templates directory' });
  });

  it('exits 2 on a missing directory, a flag in its place, or an unknown flag (a typo must not skip redaction)', async () => {
    for (const argv of [[], ['--redact'], ['--dir', '--redact'], ['--dir', '/t', '--redcat'], ['--dir', '/t', 'extra']]) {
      const result = await run(argv);
      expect(result.code).toBe(2);
      expect(result.err).toContain(USAGE);
    }
  });
});
