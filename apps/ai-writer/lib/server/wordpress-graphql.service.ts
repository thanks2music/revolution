import 'server-only';
import { cache } from 'react';
import { WordPressGraphQLService } from '../services/wordpress-graphql.service';

/**
 * Server-only WordPress GraphQL service instance getter
 *
 * This module is marked as 'server-only' to ensure it never gets bundled into the client.
 * The service is wrapped with React's cache() to provide request-scoped memoization.
 *
 * IMPORTANT: This will execute during build for statically rendered routes.
 * API routes using this service should export `const dynamic = 'force-dynamic'`
 * to prevent build-time execution when secrets are unavailable.
 *
 * @returns WordPressGraphQLService instance
 * @throws Error if WORDPRESS_AUTH_TOKEN is missing in production
 */
export const getWordPressService = cache((): WordPressGraphQLService => {
  const authToken = process.env.WORDPRESS_AUTH_TOKEN;
  const endpoint = process.env.WORDPRESS_GRAPHQL_ENDPOINT || process.env.NEXT_PUBLIC_WP_ENDPOINT;

  // Runtime validation based on environment
  // Allow builds without real secrets in development/CI environments
  if (!authToken) {
    // Production requires real auth token
    if (process.env.NODE_ENV === 'production' && process.env.CI !== 'true') {
      throw new Error(
        'WORDPRESS_AUTH_TOKEN is required in production. ' +
        'Please set this environment variable in your deployment configuration.'
      );
    }

    // Development/CI: Log warning and use dummy value
    console.warn(
      '[WordPressGraphQLService] WORDPRESS_AUTH_TOKEN not found. ' +
      'Using dummy service (this is expected in development/CI builds).'
    );
  }

  if (!endpoint) {
    throw new Error(
      'WordPress GraphQL endpoint is not configured. ' +
      'Please set WORDPRESS_GRAPHQL_ENDPOINT or NEXT_PUBLIC_WP_ENDPOINT environment variable.'
    );
  }

  return new WordPressGraphQLService(
    endpoint,
    authToken || 'dummy-token-for-build-only'
  );
});
