import { NextRequest, NextResponse } from 'next/server';
import { GraphQLClient } from 'graphql-request';
import {
  GetPostsDocument,
  GetPostsQuery,
  GetPostsQueryVariables,
} from '@generated/graphql';

const endpoint = process.env.NEXT_PUBLIC_WP_ENDPOINT || '';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const first = parseInt(searchParams.get('first') || '10');
    const after = searchParams.get('after') || undefined;

    const client = new GraphQLClient(endpoint);

    const variables: GetPostsQueryVariables = {
      first,
      after,
    };

    const data = await client.request<GetPostsQuery>(
      GetPostsDocument,
      variables
    );

    return NextResponse.json({
      success: true,
      data: data.posts,
    });
  } catch (error) {
    console.error('WordPress API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}