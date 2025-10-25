/**
 * Test script for featured image functionality
 *
 * This script tests the complete flow:
 * 1. Upload a test image to WordPress via REST API
 * 2. Convert numeric ID to Global ID
 * 3. Create a post with the featured image via GraphQL
 * 4. Verify the featured image is set correctly
 */

import { WordPressGraphQLService, PostStatus } from './lib/services/wordpress-graphql.service';

async function testFeaturedImage() {
  console.log('🧪 Starting featured image test...\n');

  try {
    // Initialize service
    const wpGraphQLService = new WordPressGraphQLService(
      process.env.NEXT_PUBLIC_WP_ENDPOINT || 'http://localhost:5555/graphql'
    );

    // Test image URL (using a reliable test image)
    const testImageUrl = 'https://picsum.photos/800/600';

    console.log('📤 Step 1: Uploading test image...');
    const media = await wpGraphQLService.uploadMediaFromUrl(
      testImageUrl,
      'Test Featured Image',
      'Featured Image Test'
    );
    console.log(`✅ Image uploaded successfully`);
    console.log(`   - Numeric ID: ${media.id}`);
    console.log(`   - URL: ${media.source_url}\n`);

    // Convert to Global ID
    console.log('🔄 Step 2: Converting to Global ID...');
    const globalId = Buffer.from(`attachment:${media.id}`).toString('base64');
    console.log(`✅ Global ID created: ${globalId}\n`);

    // Create a test post with featured image
    console.log('📝 Step 3: Creating post with featured image...');
    const post = await wpGraphQLService.createPostExtended({
      title: `Featured Image Test - ${new Date().toISOString()}`,
      content: `
        <p>This is a test post created to verify the featured image functionality.</p>
        <p>The featured image should be displayed with this post.</p>
        <p>Test performed at: ${new Date().toLocaleString()}</p>
      `,
      slug: `featured-image-test-${Date.now()}`,
      status: PostStatus.PUBLISH,
      excerpt: 'Test post for featured image functionality',
      featuredImageId: globalId
    });

    console.log(`✅ Post created successfully`);
    console.log(`   - Database ID: ${post.databaseId}`);
    console.log(`   - Global ID: ${post.id}`);
    console.log(`   - Slug: ${post.slug}`);
    console.log(`   - URI: ${post.uri}\n`);

    // Verify the featured image is set
    console.log('🔍 Step 4: Verifying featured image is set...');
    const postDetails = await wpGraphQLService.getPostBySlug(post.slug);

    if (postDetails?.featuredImage) {
      console.log(`✅ Featured image verified!`);
      console.log(`   - Image ID: ${postDetails.featuredImage.node?.id}`);
      console.log(`   - Image URL: ${postDetails.featuredImage.node?.sourceUrl}`);
      console.log(`   - Alt Text: ${postDetails.featuredImage.node?.altText}\n`);

      console.log('🎉 All tests passed! Featured image functionality is working correctly.\n');
      return true;
    } else {
      console.error('❌ Featured image was not set on the post');
      console.log('Post details:', JSON.stringify(postDetails, null, 2));
      return false;
    }

  } catch (error) {
    console.error('❌ Test failed with error:');
    console.error(error);

    if (error instanceof Error) {
      console.error('\nError details:');
      console.error('  Message:', error.message);
      console.error('  Stack:', error.stack);
    }

    return false;
  }
}

// Run the test
testFeaturedImage()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
