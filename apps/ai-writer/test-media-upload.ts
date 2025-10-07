import { WordPressGraphQLService } from './lib/services/wordpress-graphql.service';

async function testMediaUpload() {
  console.log('🧪 Media Upload Test Starting...');

  // 環境変数が設定されていない場合はエラー
  if (!process.env.WORDPRESS_AUTH_TOKEN) {
    throw new Error('WORDPRESS_AUTH_TOKEN environment variable is required');
  }

  const service = new WordPressGraphQLService(
    process.env.NEXT_PUBLIC_WP_ENDPOINT || 'http://localhost:8080/graphql',
    process.env.WORDPRESS_AUTH_TOKEN
  );

  // より小さい、より速くダウンロードできる画像
  const testImageUrl = 'https://via.placeholder.com/300x200.jpg';
  
  console.log(`📤 Uploading image: ${testImageUrl}`);
  
  try {
    const result = await service.uploadMediaFromUrl(
      testImageUrl,
      'test-placeholder-image.jpg',
      'Test: Placeholder Image',
      'Small test image for debugging'
    );
    
    console.log('\n✅ Upload successful!');
    console.log('Media ID:', result.id);
    console.log('Media URL:', result.url);
    console.log('Full result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('\n❌ Upload failed!');
    console.error('Error:', error);
    if (error instanceof Error) {
      console.error('Message:', error.message);
      console.error('Stack:', error.stack);
    }
  }
}

testMediaUpload();
