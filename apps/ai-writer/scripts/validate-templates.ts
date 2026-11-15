/**
 * Validate the templates (the private YAML repo) before they are used.
 *
 * Usage:
 *   pnpm --filter @revolution/ai-writer validate:templates --dir <templates checkout or synced copy> [--redact]
 *
 * --redact  print only rule ids, files and counts (for public logs; the dictionaries are private)
 *
 * Exit code: 0 when valid, 1 when any issue is found, 2 on usage errors or when the validator cannot run.
 * The logic is in lib/templates-validation/cli.ts.
 */
import { runCli } from '@/lib/templates-validation/cli';

// Set the exit code instead of calling process.exit, so a long report written to a pipe is not cut off
runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
