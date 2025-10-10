import { Router, Request, Response } from 'express';
import { WordPressGraphQLService, PostStatus } from '../services/wordpress-graphql.service.js';
import pino from 'pino';

const logger = pino({
  name: 'test-wordpress-route',
  level: process.env.LOG_LEVEL || 'info'
});

const router = Router();

/**
 * Test endpoint to verify WordPress GraphQL connection
 */
router.get('/test/wordpress/connection', async (req: Request, res: Response) => {
  try {
    const wpService = new WordPressGraphQLService();
    const isConnected = await wpService.testConnection();

    if (isConnected) {
      res.json({
        success: true,
        message: 'WordPress GraphQL connection successful',
        endpoint: wpService.getEndpoint()
      });
    } else {
      res.status(503).json({
        success: false,
        message: 'WordPress GraphQL connection failed',
        endpoint: wpService.getEndpoint()
      });
    }
  } catch (error) {
    logger.error({ error }, 'Connection test failed');
    res.status(500).json({
      success: false,
      error: 'Connection test failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Test endpoint to create a draft post
 */
router.post('/test/wordpress/create-post', async (req: Request, res: Response) => {
  try {
    const { title, content, authToken, slug, excerpt, status, categoryIds, tagIds, commentStatus, pingStatus } = req.body;

    // Validate input
    if (!title || !content) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'Both title and content are required'
      });
    }

    // Create service with optional auth token
    const wpService = new WordPressGraphQLService(
      undefined,
      authToken || process.env.WORDPRESS_AUTH_TOKEN
    );

    // Use extended API if additional fields are provided
    if (slug || excerpt || categoryIds || tagIds || commentStatus || pingStatus) {
      const post = await wpService.createPostExtended({
        title,
        content,
        slug,
        excerpt,
        status: status || PostStatus.DRAFT,
        categoryIds,
        tagIds,
        commentStatus,
        pingStatus
      });

      return res.json({
        success: true,
        message: 'Extended post created successfully',
        post
      });
    }

    // Create basic post
    const post = await wpService.createPost({
      title,
      content,
      status: status || PostStatus.DRAFT
    });

    res.json({
      success: true,
      message: 'Post created successfully',
      post: {
        id: post.id,
        databaseId: post.databaseId,
        title: post.title,
        slug: post.slug,
        uri: post.uri,
        status: post.status
      }
    });
  } catch (error) {
    logger.error({ error }, 'Failed to create post');
    res.status(500).json({
      success: false,
      error: 'Failed to create post',
      message: error instanceof Error ? error.message : 'Unknown error',
      hint: 'Make sure you have provided a valid authentication token or configured WORDPRESS_AUTH_TOKEN environment variable'
    });
  }
});

/**
 * Test endpoint to fetch recent posts
 */
router.get('/test/wordpress/posts', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 5;
    const authToken = req.headers.authorization?.replace('Bearer ', '');

    const wpService = new WordPressGraphQLService(
      undefined,
      authToken || process.env.WORDPRESS_AUTH_TOKEN
    );

    const { posts, hasNextPage } = await wpService.getPosts(limit);

    res.json({
      success: true,
      count: posts.length,
      hasMore: hasNextPage,
      posts: posts.map(post => ({
        id: post.id,
        databaseId: post.databaseId,
        title: post.title,
        slug: post.slug,
        status: post.status,
        date: post.date
      }))
    });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch posts');
    res.status(500).json({
      success: false,
      error: 'Failed to fetch posts',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Test endpoint with sample data for quick testing
 */
router.post('/test/wordpress/create-test-post', async (req: Request, res: Response) => {
  try {
    const authToken = req.body.authToken || req.headers.authorization?.replace('Bearer ', '');

    if (!authToken && !process.env.WORDPRESS_AUTH_TOKEN) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'Please provide an authToken in the request body or set WORDPRESS_AUTH_TOKEN environment variable',
        hint: 'You can get an Application Password from WordPress admin panel: Users > Your Profile > Application Passwords'
      });
    }

    const wpService = new WordPressGraphQLService(
      undefined,
      authToken || process.env.WORDPRESS_AUTH_TOKEN
    );

    // Create a test post with timestamp
    const timestamp = new Date().toISOString();
    const post = await wpService.createPost({
      title: `Test Post from AI Writer - ${timestamp}`,
      content: `<p>This is a test post created by the AI Writer service.</p>
<p>Created at: ${timestamp}</p>
<p>This post was created via WordPress GraphQL API to verify the integration is working correctly.</p>
<h2>Next Steps</h2>
<ul>
  <li>Implement RSS feed monitoring</li>
  <li>Integrate Claude API for content generation</li>
  <li>Add template processing</li>
  <li>Set up Cloud Tasks for queue management</li>
</ul>`,
      status: PostStatus.DRAFT
    });

    res.json({
      success: true,
      message: 'Test post created successfully',
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
    logger.error({ error }, 'Failed to create test post');
    res.status(500).json({
      success: false,
      error: 'Failed to create test post',
      message: error instanceof Error ? error.message : 'Unknown error',
      troubleshooting: {
        checkEndpoint: 'Verify WordPress is running at http://localhost:8080',
        checkGraphQL: 'Ensure WPGraphQL plugin is installed and activated',
        checkAuth: 'Verify authentication token is valid',
        getToken: 'Create an Application Password in WordPress: Users > Your Profile > Application Passwords'
      }
    });
  }
});

export default router;