import { Router, Request, Response } from 'express';
import { WordPressGraphQLService, PostStatus } from '../services/wordpress-graphql.service.js';

const router = Router();

router.post('/test/create-extended-post', async (req: Request, res: Response) => {
  try {
    const authToken = req.body.authToken || process.env.WORDPRESS_AUTH_TOKEN;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        error: 'Authentication token is required. Provide authToken in request body or set WORDPRESS_AUTH_TOKEN environment variable.'
      });
    }

    const wordpressService = new WordPressGraphQLService(
      process.env.WORDPRESS_GRAPHQL_ENDPOINT,
      authToken
    );

    const result = await wordpressService.createPostExtended({
      title: 'Complete Post Example',
      content: '<p>This is a comprehensive post with all fields specified.</p><p>Categories, tags, slug, author, and more are all configured.</p>',
      slug: 'complete-post-example',
      excerpt: 'A comprehensive example demonstrating all available fields in WPGraphQL createPost mutation',
      status: PostStatus.DRAFT,
      commentStatus: 'open',
      pingStatus: 'closed',
    });

    res.json({
      success: true,
      message: 'Extended post created successfully',
      post: result,
      explanation: {
        title: 'Post title',
        content: 'HTML content',
        slug: 'URL-friendly slug (if not provided, generated from title)',
        excerpt: 'Post excerpt/summary',
        status: 'DRAFT | PUBLISH | PENDING | PRIVATE',
        authorId: 'WordPress user global ID (not provided = current user)',
        categoryIds: 'Array of category global IDs',
        tagIds: 'Array of tag global IDs',
        featuredImageId: 'Media library attachment global ID',
        commentStatus: 'open | closed',
        pingStatus: 'open | closed',
        date: 'ISO 8601 datetime for scheduled posts'
      }
    });

  } catch (error) {
    console.error('Error creating extended post:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      troubleshooting: {
        authError: 'Verify authToken format is "username:applicationPassword" without spaces',
        categoryError: 'Category IDs must be global IDs (e.g., "dGVybTox"). Use getPosts query to see format',
        tagError: 'Tag IDs must be global IDs. Use GraphQL query to fetch existing tags',
        authorError: 'Author ID must be global user ID',
        dateError: 'Date must be ISO 8601 format (e.g., "2025-01-15T10:00:00")'
      }
    });
  }
});

export default router;