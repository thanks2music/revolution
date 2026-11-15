/**
 * Validate the templates (the private YAML repo) before they are used.
 *
 * Usage:
 *   pnpm --filter ai-writer validate:templates --dir <templates checkout or synced copy> [--redact]
 *
 * --redact  print only rule ids, files and counts (for public logs; the dictionaries are private)
 *
 * Exit code: 0 when valid, 1 when any issue is found, 2 on usage errors.
 */
import { formatIssues, validateTemplates } from '@/lib/templates-validation';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf('--dir');
  const dir = dirIndex >= 0 ? args[dirIndex + 1] : undefined;
  if (!dir) {
    console.error('Usage: validate-templates --dir <templates directory> [--redact]');
    return 2;
  }
  const redact = args.includes('--redact');

  let issues;
  try {
    issues = await validateTemplates(dir);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const output = formatIssues(issues, { redact });
  if (issues.length === 0) console.log(output);
  else console.error(output);
  return issues.length === 0 ? 0 : 1;
}

main().then((code) => process.exit(code));
