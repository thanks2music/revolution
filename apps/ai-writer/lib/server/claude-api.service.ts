import 'server-only';
import { cache } from 'react';
import { ClaudeAPIService } from '../services/claude-api.service';

/**
 * Server-only Claude API service instance getter
 *
 * This module is marked as 'server-only' to ensure it never gets bundled into the client.
 * The service is wrapped with React's cache() to provide request-scoped memoization.
 *
 * IMPORTANT: This will execute during build for statically rendered routes.
 * API routes using this service should export `const dynamic = 'force-dynamic'`
 * to prevent build-time execution when secrets are unavailable.
 *
 * @returns ClaudeAPIService instance
 * @throws Error if ANTHROPIC_API_KEY is missing in production
 */
export const getClaudeService = cache((): ClaudeAPIService => {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Runtime validation based on environment
  // Allow builds without real secrets in development/CI environments
  if (!apiKey) {
    // Production requires real API key
    if (process.env.NODE_ENV === 'production' && process.env.CI !== 'true') {
      throw new Error(
        'ANTHROPIC_API_KEY is required in production. ' +
        'Please set this environment variable in your deployment configuration.'
      );
    }

    // Development/CI: Log warning and use dummy value
    console.warn(
      '[ClaudeAPIService] ANTHROPIC_API_KEY not found. ' +
      'Using dummy service (this is expected in development/CI builds).'
    );

    // Return service with dummy key for build-time compatibility
    // This instance should never be used at runtime in production
    return new ClaudeAPIService('dummy-key-for-build-only');
  }

  return new ClaudeAPIService(apiKey);
});
