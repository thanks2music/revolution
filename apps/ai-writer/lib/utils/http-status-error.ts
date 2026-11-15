/**
 * A page answered with an error status. Callers read `status` to tell a refusal from an outage.
 *
 * @module lib/utils/http-status-error
 */
export class HttpStatusError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'HttpStatusError';
  }
}
