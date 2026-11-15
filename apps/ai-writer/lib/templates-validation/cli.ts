/**
 * The command line of the templates validator (`scripts/validate-templates.ts`).
 *
 * Unknown flags are rejected: a typo such as `--redcat` must not quietly run without redaction in a public log.
 */
import { parseArgs } from 'util';
import { formatIssues } from './issues';
import { TemplatesLayoutError } from './layout';
import { validateTemplates } from './index';

export const USAGE = 'Usage: validate-templates --dir <templates directory> [--redact]';

interface Output {
  log: (message: string) => void;
  error: (message: string) => void;
}

/** @returns the exit code: 0 when valid, 1 when any issue is found, 2 on usage errors or when the validator cannot run */
export async function runCli(argv: string[], output: Output = console): Promise<number> {
  let dir: string | undefined;
  let redact: boolean;
  try {
    const { values } = parseArgs({
      args: argv,
      options: { dir: { type: 'string' }, redact: { type: 'boolean', default: false } },
      strict: true,
      allowPositionals: false,
    });
    dir = values.dir;
    redact = values.redact ?? false;
  } catch (error) {
    output.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  if (!dir || dir.startsWith('--')) {
    output.error(USAGE);
    return 2;
  }

  try {
    const issues = await validateTemplates(dir);
    const report = formatIssues(issues, { redact });
    if (issues.length === 0) {
      output.log(report);
      return 0;
    }
    output.error(report);
    return 1;
  } catch (error) {
    output.error(describeFailure(error, redact));
    return 2;
  }
}

/** With --redact, only messages known to hold no template values are printed */
function describeFailure(error: unknown, redact: boolean): string {
  if (error instanceof TemplatesLayoutError || !redact) return error instanceof Error ? error.message : String(error);
  return `The validator could not run (${error instanceof Error ? error.name : typeof error}; details redacted).`;
}
