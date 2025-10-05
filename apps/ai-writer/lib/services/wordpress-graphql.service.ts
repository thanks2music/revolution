import { GraphQLClient, gql } from 'graphql-request';
import pino from 'pino';

const logger = pino({
  name: 'wordpress-graphql-service',
  level: process.env.LOG_LEVEL || 'info'
});

// GraphQL Mutations for WordPress
const CREATE_POST_MUTATION = gql`
  mutation CreatePost($title: String!, $content: String!, $status: PostStatusEnum) {
    createPost(
      input: {
        title: $title
        content: $content
        status: $status
      }
    ) {
      post {
        id
        databaseId
        title
        slug
        uri
        status
      }
    }
  }
`;

const CREATE_POST_EXTENDED_MUTATION = gql`
  mutation CreatePostExtended(
    $title: String!
    $content: String!
    $slug: String
    $status: PostStatusEnum
    $authorId: ID
    $excerpt: String
    $date: String
    $categories: [PostCategoriesNodeInput]
    $tags: [PostTagsNodeInput]
    $commentStatus: String
    $pingStatus: String
  ) {
    createPost(
      input: {
        title: $title
        content: $content
        slug: $slug
        status: $status
        authorId: $authorId
        excerpt: $excerpt
        date: $date
        categories: { nodes: $categories }
        tags: { nodes: $tags }
        commentStatus: $commentStatus
        pingStatus: $pingStatus
      }
    ) {
      post {
        id
        databaseId
        title
        slug
        uri
        status
        date
        excerpt
        author {
          node {
            id
            name
          }
        }
        categories {
          nodes {
            id
            name
          }
        }
        tags {
          nodes {
            id
            name
          }
        }
      }
    }
  }
`;

const UPDATE_POST_MUTATION = gql`
  mutation UpdatePost($id: ID!, $title: String, $content: String, $status: PostStatusEnum) {
    updatePost(
      input: {
        id: $id
        title: $title
        content: $content
        status: $status
      }
    ) {
      post {
        id
        databaseId
        title
        slug
        uri
        status
      }
    }
  }
`;

const DELETE_POST_MUTATION = gql`
  mutation DeletePost($id: ID!) {
    deletePost(input: { id: $id }) {
      deletedId
    }
  }
`;

// GraphQL Queries
const GET_POSTS_QUERY = gql`
  query GetPosts($first: Int = 10, $after: String) {
    posts(first: $first, after: $after) {
      edges {
        node {
          id
          databaseId
          title
          slug
          content
          status
          date
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const SEARCH_POSTS_BY_CONTENT = gql`
  query SearchPostsByContent($search: String!, $first: Int = 100) {
    posts(where: { search: $search }, first: $first) {
      nodes {
        id
        databaseId
        title
        content
        excerpt
      }
    }
  }
`;

export enum PostStatus {
  DRAFT = 'DRAFT',
  PUBLISH = 'PUBLISH',
  PENDING = 'PENDING',
  PRIVATE = 'PRIVATE'
}

export interface CreatePostInput {
  title: string;
  content: string;
  status?: PostStatus;
  categories?: string[];
  tags?: string[];
  featuredMediaId?: string;
}

export interface CreatePostExtendedInput {
  title: string;
  content: string;
  slug?: string;
  status?: PostStatus;
  authorId?: string;
  excerpt?: string;
  date?: string;
  categoryIds?: string[];
  tagIds?: string[];
  featuredImageId?: string;
  commentStatus?: 'open' | 'closed';
  pingStatus?: 'open' | 'closed';
}

export interface UpdatePostInput {
  id: string;
  title?: string;
  content?: string;
  status?: PostStatus;
  categories?: string[];
  tags?: string[];
  featuredMediaId?: string;
}

export interface WordPressPost {
  id: string;
  databaseId: number;
  title: string;
  slug: string;
  uri: string;
  content?: string;
  status: string;
  date?: string;
  categories?: {
    nodes: Array<{ id: string; name: string }>;
  };
  tags?: {
    nodes: Array<{ id: string; name: string }>;
  };
}

export class WordPressGraphQLService {
  private client: GraphQLClient;
  private endpoint: string;
  private authToken?: string;

  constructor(endpoint?: string, authToken?: string) {
    this.endpoint = endpoint || process.env.WORDPRESS_GRAPHQL_ENDPOINT || 'http://localhost:8080/graphql';
    this.authToken = authToken || process.env.WORDPRESS_AUTH_TOKEN;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add authorization header if token is provided
    // WordPress Application Passwords use HTTP Basic Authentication
    if (this.authToken) {
      // If token contains ':', it's in format "username:password"
      // Convert to Basic auth by base64 encoding
      const base64Token = Buffer.from(this.authToken).toString('base64');
      headers['Authorization'] = `Basic ${base64Token}`;
      logger.info({
        username: this.authToken.split(':')[0],
        hasPassword: this.authToken.includes(':')
      }, 'WordPress authentication configured');
    }

    this.client = new GraphQLClient(this.endpoint, {
      headers,
      timeout: 30000, // 30 seconds timeout
    });

    logger.info({ endpoint: this.endpoint, hasAuth: !!this.authToken }, 'WordPress GraphQL client initialized');
  }

  /**
   * Create a new post in WordPress
   */
  async createPost(input: CreatePostInput): Promise<WordPressPost> {
    try {
      logger.info({ title: input.title, status: input.status }, 'Creating WordPress post');

      const variables = {
        title: input.title,
        content: input.content,
        status: input.status || PostStatus.DRAFT,
      };

      const response = await this.client.request<{
        createPost: { post: WordPressPost };
      }>(CREATE_POST_MUTATION, variables);

      const post = response.createPost.post;
      logger.info({ postId: post.id, slug: post.slug }, 'Post created successfully');

      return post;
    } catch (error) {
      logger.error({ error, input }, 'Failed to create post');
      throw new Error(`Failed to create WordPress post: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async createPostExtended(input: CreatePostExtendedInput): Promise<WordPressPost> {
    try {
      logger.info({ title: input.title, status: input.status }, 'Creating extended WordPress post');

      const variables = {
        title: input.title,
        content: input.content,
        slug: input.slug,
        status: input.status || PostStatus.DRAFT,
        authorId: input.authorId,
        excerpt: input.excerpt,
        date: input.date,
        categories: input.categoryIds?.map(id => ({ id })),
        tags: input.tagIds?.map(id => ({ id })),
        commentStatus: input.commentStatus,
        pingStatus: input.pingStatus,
      };

      const response = await this.client.request<{
        createPost: { post: WordPressPost };
      }>(CREATE_POST_EXTENDED_MUTATION, variables);

      const post = response.createPost.post;
      logger.info({ postId: post.id, slug: post.slug }, 'Extended post created successfully');

      return post;
    } catch (error) {
      logger.error({ error, input }, 'Failed to create extended post');
      throw new Error(`Failed to create extended WordPress post: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update an existing post
   */
  async updatePost(input: UpdatePostInput): Promise<WordPressPost> {
    try {
      logger.info({ id: input.id, title: input.title }, 'Updating WordPress post');

      const response = await this.client.request<{
        updatePost: { post: WordPressPost };
      }>(UPDATE_POST_MUTATION, input);

      const post = response.updatePost.post;
      logger.info({ postId: post.id, slug: post.slug }, 'Post updated successfully');

      return post;
    } catch (error) {
      logger.error({ error, input }, 'Failed to update post');
      throw new Error(`Failed to update WordPress post: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete a post
   */
  async deletePost(id: string): Promise<string> {
    try {
      logger.info({ id }, 'Deleting WordPress post');

      const response = await this.client.request<{
        deletePost: { deletedId: string };
      }>(DELETE_POST_MUTATION, { id });

      logger.info({ deletedId: response.deletePost.deletedId }, 'Post deleted successfully');
      return response.deletePost.deletedId;
    } catch (error) {
      logger.error({ error, id }, 'Failed to delete post');
      throw new Error(`Failed to delete WordPress post: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get posts from WordPress
   */
  async getPosts(first: number = 10, after?: string): Promise<{
    posts: WordPressPost[];
    hasNextPage: boolean;
    endCursor?: string;
  }> {
    try {
      logger.info({ first, after }, 'Fetching WordPress posts');

      const response = await this.client.request<{
        posts: {
          edges: Array<{ node: WordPressPost }>;
          pageInfo: { hasNextPage: boolean; endCursor?: string };
        };
      }>(GET_POSTS_QUERY, { first, after });

      const posts = response.posts.edges.map(edge => edge.node);
      const { hasNextPage, endCursor } = response.posts.pageInfo;

      logger.info({ count: posts.length, hasNextPage }, 'Posts fetched successfully');

      return { posts, hasNextPage, endCursor };
    } catch (error) {
      logger.error({ error }, 'Failed to fetch posts');
      throw new Error(`Failed to fetch WordPress posts: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Search for posts that contain a specific URL in their content
   * (仮実装: URL照合による既存記事検索)
   */
  async searchPostsByUrl(url: string): Promise<WordPressPost[]> {
    try {
      logger.info({ url }, 'Searching posts by URL');

      // URLをエンコードして検索
      const response = await this.client.request<{
        posts: {
          nodes: WordPressPost[];
        };
      }>(SEARCH_POSTS_BY_CONTENT, { search: url });

      const posts = response.posts.nodes;

      // contentにURLが含まれているかを厳密にチェック
      const matchedPosts = posts.filter(post => {
        return post.content?.includes(url);
      });

      logger.info({ count: matchedPosts.length }, 'Posts found by URL');
      return matchedPosts;
    } catch (error) {
      logger.error({ error, url }, 'Failed to search posts by URL');
      return [];
    }
  }

  /**
   * Test the connection to WordPress GraphQL endpoint
   */
  async testConnection(): Promise<boolean> {
    try {
      logger.info('Testing WordPress GraphQL connection');

      const query = gql`
        query TestConnection {
          generalSettings {
            title
            url
          }
        }
      `;

      const response = await this.client.request<{
        generalSettings: { title: string; url: string };
      }>(query);

      logger.info(
        {
          title: response.generalSettings.title,
          url: response.generalSettings.url
        },
        'WordPress GraphQL connection successful'
      );

      return true;
    } catch (error) {
      logger.error({ error }, 'WordPress GraphQL connection failed');
      return false;
    }
  }

  /**
   * Set authentication token
   */
  setAuthToken(token: string): void {
    this.authToken = token;
    const base64Token = Buffer.from(token).toString('base64');
    this.client.setHeader('Authorization', `Basic ${base64Token}`);
    logger.info('Authentication token updated');
  }

  /**
   * Get current endpoint
   */
  getEndpoint(): string {
    return this.endpoint;
  }
}

// Singleton instance for convenience
export const wordPressGraphQL = new WordPressGraphQLService();