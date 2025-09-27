import { Router, Request, Response } from 'express';
import { WordPressGraphQLService, PostStatus } from '../services/wordpress-graphql.service.js';
import pino from 'pino';

const logger = pino({
  name: 'test-specific-route',
  level: process.env.LOG_LEVEL || 'info'
});

const router = Router();

/**
 * Test endpoint to create a specific post with predefined content
 */
router.post('/test/create-specific-post', async (req: Request, res: Response) => {
  try {
    const authToken = req.body.authToken || req.headers.authorization?.replace('Bearer ', '');

    // Create service - try without auth first, then with auth if provided
    const wpService = new WordPressGraphQLService(
      undefined,
      authToken || process.env.WORDPRESS_AUTH_TOKEN
    );

    // Create the post with specified content
    const post = await wpService.createPost({
      title: 'PostTitle By Node.js',
      content: '<p>Post Content by Node.js</p>',
      status: PostStatus.DRAFT
    });

    res.json({
      success: true,
      message: 'Post created successfully with specified content',
      post: {
        id: post.id,
        databaseId: post.databaseId,
        title: post.title,
        slug: post.slug,
        uri: post.uri,
        status: post.status,
        adminUrl: `http://localhost:8080/wp-admin/post.php?post=${post.databaseId}&action=edit`,
        viewUrl: `http://localhost:8080${post.uri}`
      },
      requestedContent: {
        title: 'PostTitle By Node.js',
        content: 'Post Content by Node.js'
      }
    });
  } catch (error) {
    logger.error({ error }, 'Failed to create specific post');

    // Provide detailed error information
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isAuthError = errorMessage.includes('not allowed') || errorMessage.includes('unauthorized');

    res.status(isAuthError ? 401 : 500).json({
      success: false,
      error: 'Failed to create specific post',
      message: errorMessage,
      authenticationRequired: isAuthError,
      troubleshooting: {
        step1: 'Check if WordPress is running: http://localhost:8080',
        step2: 'Verify WPGraphQL plugin is activated in WordPress admin',
        step3: isAuthError ? 'Create Application Password in WordPress: Users > Your Profile > Application Passwords' : 'Check server logs for detailed error',
        step4: isAuthError ? 'Include authToken in request body or set WORDPRESS_AUTH_TOKEN environment variable' : 'Verify GraphQL endpoint accessibility'
      }
    });
  }
});

/**
 * Test endpoint to create post without authentication (if possible)
 */
router.post('/test/create-post-no-auth', async (req: Request, res: Response) => {
  try {
    logger.info('Attempting to create post without authentication');

    // Create service without authentication
    const wpService = new WordPressGraphQLService('http://localhost:8080/graphql');

    const post = await wpService.createPost({
      title: 'PostTitle By Node.js',
      content: '<p>Post Content by Node.js</p>',
      status: PostStatus.DRAFT
    });

    res.json({
      success: true,
      message: 'Post created successfully without authentication',
      post: {
        id: post.id,
        databaseId: post.databaseId,
        title: post.title,
        slug: post.slug,
        uri: post.uri,
        status: post.status,
        adminUrl: `http://localhost:8080/wp-admin/post.php?post=${post.databaseId}&action=edit`
      }
    });
  } catch (error) {
    logger.error({ error }, 'Failed to create post without auth');

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: errorMessage,
      hint: 'WordPress requires authentication for post creation',
      nextStep: 'Use /test/create-specific-post endpoint with authToken'
    });
  }
});

/**
 * Helper endpoint to check WordPress authentication settings
 */
router.get('/test/auth-status', async (req: Request, res: Response) => {
  try {
    const authToken = req.headers.authorization?.replace('Bearer ', '') || process.env.WORDPRESS_AUTH_TOKEN;

    res.json({
      hasEnvToken: !!process.env.WORDPRESS_AUTH_TOKEN,
      hasHeaderToken: !!req.headers.authorization,
      endpoint: 'http://localhost:8080/graphql',
      instructions: {
        step1: 'Go to WordPress admin: http://localhost:8080/wp-admin',
        step2: 'Navigate to Users > Your Profile',
        step3: 'Scroll to "Application Passwords" section',
        step4: 'Create new application password with name "AI Writer"',
        step5: 'Copy the generated password (format: xxxx xxxx xxxx xxxx)',
        step6: 'Use format: "username:password" for authentication',
        example: 'If username is "admin" and password is "abcd efgh ijkl mnop", use "admin:abcd efgh ijkl mnop"'
      }
    });
  } catch (error) {
    logger.error({ error }, 'Failed to check auth status');
    res.status(500).json({
      success: false,
      error: 'Failed to check authentication status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;