import { GraphQLClient } from 'graphql-request';
import pino from 'pino';
import type {
  CreatePostMutation,
  CreatePostMutationVariables,
  CreatePostExtendedMutation,
  CreatePostExtendedMutationVariables,
  UpdatePostMutation,
  UpdatePostMutationVariables,
  DeletePostMutation,
  DeletePostMutationVariables,
  GetPostsQuery,
  GetPostsQueryVariables,
  TestConnectionQuery,
  GetCategoriesAndTagsQuery,
  PostCategoriesNodeInput,
  PostTagsNodeInput
} from '../generated/graphql.js';
import { getSdk, PostStatusEnum } from '../generated/graphql.js';

const logger = pino({
  name: 'wordpress-graphql-typed-service',
  level: process.env.LOG_LEVEL || 'info'
});

export interface CreatePostInput {
  title: string;
  content: string;
  status?: PostStatusEnum;
}

export interface CreatePostExtendedInput {
  title: string;
  content: string;
  slug?: string;
  status?: PostStatusEnum;
  authorId?: string;
  excerpt?: string;
  date?: string;
  categoryIds?: string[];
  tagIds?: string[];
  commentStatus?: 'open' | 'closed';
  pingStatus?: 'open' | 'closed';
}

export interface UpdatePostInput {
  id: string;
  title?: string;
  content?: string;
  status?: PostStatusEnum;
}

export class WordPressGraphQLTypedService {
  private sdk: ReturnType<typeof getSdk>;
  private endpoint: string;
  private authToken?: string;

  constructor(endpoint?: string, authToken?: string) {
    this.endpoint = endpoint || process.env.WORDPRESS_GRAPHQL_ENDPOINT || 'http://localhost:8080/graphql';
    this.authToken = authToken || process.env.WORDPRESS_AUTH_TOKEN;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.authToken) {
      const base64Token = Buffer.from(this.authToken).toString('base64');
      headers['Authorization'] = `Basic ${base64Token}`;
      logger.info({
        username: this.authToken.split(':')[0],
        hasPassword: this.authToken.includes(':')
      }, 'WordPress authentication configured');
    }

    // Create custom fetch with timeout using AbortController (graphql-request v7+)
    const createFetchWithTimeout = (timeout: number) => async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const controller = new AbortController();
      const timerId = setTimeout(() => {
        controller.abort();
      }, timeout);

      try {
        return await fetch(input, { ...init, signal: controller.signal });
      } finally {
        clearTimeout(timerId);
      }
    };

    const client = new GraphQLClient(this.endpoint, {
      headers,
      fetch: createFetchWithTimeout(30000), // 30 second timeout
    });

    this.sdk = getSdk(client);

    logger.info({ endpoint: this.endpoint, hasAuth: !!this.authToken }, 'WordPress GraphQL Typed client initialized');
  }

  async createPost(input: CreatePostInput): Promise<CreatePostMutation['createPost']> {
    try {
      logger.info({ title: input.title, status: input.status }, 'Creating WordPress post');

      const variables: CreatePostMutationVariables = {
        title: input.title,
        content: input.content,
        status: input.status || PostStatusEnum.Draft,
      };

      const response = await this.sdk.CreatePost(variables);
      const post = response.createPost;

      logger.info({ postId: post?.post?.id, slug: post?.post?.slug }, 'Post created successfully');

      return post;
    } catch (error) {
      logger.error({ error, input }, 'Failed to create post');
      throw new Error(`Failed to create WordPress post: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async createPostExtended(input: CreatePostExtendedInput): Promise<CreatePostExtendedMutation['createPost']> {
    try {
      logger.info({ title: input.title, status: input.status }, 'Creating extended WordPress post');

      const categories: PostCategoriesNodeInput[] | undefined = input.categoryIds?.map(id => ({ id }));
      const tags: PostTagsNodeInput[] | undefined = input.tagIds?.map(id => ({ id }));

      const variables: CreatePostExtendedMutationVariables = {
        title: input.title,
        content: input.content,
        slug: input.slug,
        status: input.status || PostStatusEnum.Draft,
        authorId: input.authorId,
        excerpt: input.excerpt,
        date: input.date,
        categories,
        tags,
        commentStatus: input.commentStatus,
        pingStatus: input.pingStatus,
      };

      const response = await this.sdk.CreatePostExtended(variables);
      const post = response.createPost;

      logger.info({ postId: post?.post?.id, slug: post?.post?.slug }, 'Extended post created successfully');

      return post;
    } catch (error) {
      logger.error({ error, input }, 'Failed to create extended post');
      throw new Error(`Failed to create extended WordPress post: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async updatePost(input: UpdatePostInput): Promise<UpdatePostMutation['updatePost']> {
    try {
      logger.info({ id: input.id, title: input.title }, 'Updating WordPress post');

      const variables: UpdatePostMutationVariables = {
        id: input.id,
        title: input.title,
        content: input.content,
        status: input.status,
      };

      const response = await this.sdk.UpdatePost(variables);
      const post = response.updatePost;

      logger.info({ postId: post?.post?.id, slug: post?.post?.slug }, 'Post updated successfully');

      return post;
    } catch (error) {
      logger.error({ error, input }, 'Failed to update post');
      throw new Error(`Failed to update WordPress post: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async deletePost(id: string): Promise<DeletePostMutation['deletePost']> {
    try {
      logger.info({ id }, 'Deleting WordPress post');

      const variables: DeletePostMutationVariables = { id };
      const response = await this.sdk.DeletePost(variables);
      const result = response.deletePost;

      logger.info({ deletedId: result?.deletedId }, 'Post deleted successfully');
      return result;
    } catch (error) {
      logger.error({ error, id }, 'Failed to delete post');
      throw new Error(`Failed to delete WordPress post: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getPosts(first: number = 10, after?: string): Promise<GetPostsQuery['posts']> {
    try {
      logger.info({ first, after }, 'Fetching WordPress posts');

      const variables: GetPostsQueryVariables = { first, after };
      const response = await this.sdk.GetPosts(variables);
      const posts = response.posts;

      logger.info({
        count: posts?.edges?.length || 0,
        hasNextPage: posts?.pageInfo.hasNextPage
      }, 'Posts fetched successfully');

      return posts;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch posts');
      throw new Error(`Failed to fetch WordPress posts: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      logger.info('Testing WordPress GraphQL connection');

      const response = await this.sdk.TestConnection();

      logger.info(
        {
          title: response.generalSettings?.title,
          url: response.generalSettings?.url
        },
        'WordPress GraphQL connection successful'
      );

      return true;
    } catch (error) {
      logger.error({ error }, 'WordPress GraphQL connection failed');
      return false;
    }
  }

  async getCategoriesAndTags(): Promise<GetCategoriesAndTagsQuery> {
    try {
      logger.info('Fetching categories and tags');

      const response = await this.sdk.GetCategoriesAndTags();

      logger.info({
        categoriesCount: response.categories?.nodes?.length || 0,
        tagsCount: response.tags?.nodes?.length || 0
      }, 'Categories and tags fetched successfully');

      return response;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch categories and tags');
      throw new Error(`Failed to fetch categories and tags: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  setAuthToken(token: string): void {
    this.authToken = token;
    const base64Token = Buffer.from(token).toString('base64');

    // Create custom fetch with timeout using AbortController (graphql-request v7+)
    const createFetchWithTimeout = (timeout: number) => async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const controller = new AbortController();
      const timerId = setTimeout(() => {
        controller.abort();
      }, timeout);

      try {
        return await fetch(input, { ...init, signal: controller.signal });
      } finally {
        clearTimeout(timerId);
      }
    };

    const client = new GraphQLClient(this.endpoint, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${base64Token}`
      },
      fetch: createFetchWithTimeout(30000), // 30 second timeout
    });

    this.sdk = getSdk(client);
    logger.info('Authentication token updated');
  }

  getEndpoint(): string {
    return this.endpoint;
  }
}

export const wordPressGraphQLTyped = new WordPressGraphQLTypedService();