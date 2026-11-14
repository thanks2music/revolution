/**
 * Whether the process runs on Cloud Run. Cloud Run sets these variables itself:
 * `K_SERVICE` on a Service and `CLOUD_RUN_JOB` on a Job. A blank value counts as unset.
 *
 * Used by the Anthropic auth (federation is required on Cloud Run) and by Slack
 * (mentions only on Cloud Run), so both decide the same way.
 */
export function isCloudRun(env: Record<string, string | undefined> = process.env): boolean {
  return [env.K_SERVICE, env.CLOUD_RUN_JOB].some((value) => value !== undefined && value.trim() !== '');
}
