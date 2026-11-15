/**
 * Result type and output of the templates validator.
 *
 * `--redact` output is for public logs (the deploy workflow of this public repo): it prints only rule ids,
 * files and counts, never values from the private dictionaries.
 */

export interface TemplateIssue {
  /** Stable rule id, e.g. `yaml/parse`, `title/slug-duplicate` */
  rule: string;
  /**
   * Path relative to the templates root. `--redact` prints it, so it must never be built from YAML values:
   * use the repo's own file names, or report on the file that holds the value (e.g. `_meta.yaml`)
   */
  file: string;
  /** Where in the file (a YAML path such as `titles["…"].slug`). May contain dictionary values */
  at?: string;
  /** Human-readable detail. May contain dictionary values */
  message: string;
}

export function formatIssues(issues: TemplateIssue[], options: { redact?: boolean } = {}): string {
  if (issues.length === 0) return 'Templates are valid (0 issues).';

  if (options.redact) {
    const counts = new Map<string, { rule: string; file: string; count: number }>();
    for (const { rule, file } of issues) {
      const key = JSON.stringify([rule, file]);
      const entry = counts.get(key) ?? { rule, file, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
    const lines = [...counts.values()].map(({ rule, file, count }) => `- ${rule} in ${file}: ${count}`);
    return [`Templates are invalid (${issues.length} issues, details redacted):`, ...lines].join('\n');
  }

  const lines = issues.map((issue) => {
    const where = issue.at ? `${issue.file} ${issue.at}` : issue.file;
    return `- [${issue.rule}] ${where}: ${issue.message}`;
  });
  return [`Templates are invalid (${issues.length} issues):`, ...lines].join('\n');
}
