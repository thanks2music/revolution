/**
 * Test image upload functionality
 * Usage: pnpm tsx test-image-upload.ts
 */

import { WordPressGraphQLService } from './lib/services/wordpress-graphql.service';
import * as fs from 'fs';
import * as path from 'path';

async function testImageUpload() {
  console.log('🧪 Testing image upload to WordPress...\n');

  const authToken = process.env.WORDPRESS_AUTH_TOKEN;
  if (!authToken) {
    console.error('❌ WORDPRESS_AUTH_TOKEN environment variable is not set');
    process.exit(1);
  }

  const wpService = new WordPressGraphQLService(
    'http://localhost:5555/graphql',
    authToken
  );

  // Test with a real HTTP image URL
  // Using Wikipedia's sample JPEG image
  const testImageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/300px-Cat03.jpg';

  try {
    console.log(`📤 Testing image upload from HTTP URL...`);
    console.log(`URL: ${testImageUrl}\n`);

    const result = await wpService.uploadMediaFromUrl(
      testImageUrl,
      'Test placeholder image',
      'Placeholder Test'
    );

    console.log('\n✅ Image upload SUCCESS!');
    console.log('📊 Upload details:');
    console.log(`  - Media ID: ${result.id}`);
    console.log(`  - Source URL: ${result.source_url}`);
    console.log(`  - Title: ${result.title?.rendered || 'N/A'}`);
    console.log(`  - Alt Text: ${result.alt_text || 'N/A'}`);
    console.log(`  - MIME Type: ${result.mime_type}`);

  } catch (error) {
    console.error('\n❌ Image upload FAILED!');
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

testImageUpload();
