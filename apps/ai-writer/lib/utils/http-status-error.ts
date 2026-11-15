/**
 * A page answered with an error status. Callers read `status` to tell a refusal from an outage.
 * Only the article fetch (`extractArticleData`) throws it for now; other fetches throw a plain Error.
 *
 * @module lib/utils/http-status-error
 */
export class HttpStatusError extends Error {
  constructor(
    message: string,
    readonly status: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'HttpStatusError';
  }
}
