/**
 * Minimal test: Upload image using fs.readFileSync (like curl does)
 * This isolates the upload logic from imageBuffer creation
 */

import * as fs from 'fs';
import * as path from 'path';

async function testMinimalUpload() {
  console.log('🧪 Minimal Image Upload Test\n');

  // Read file directly from disk (like curl --data-binary)
  const testImagePath = path.join(process.cwd(), '../..', 'temp', 'test.jpg');
  console.log(`📁 Reading: ${testImagePath}`);

  if (!fs.existsSync(testImagePath)) {
    console.error(`❌ File not found: ${testImagePath}`);
    process.exit(1);
  }

  const bodyBuffer = fs.readFileSync(testImagePath);
  console.log(`✅ File loaded: ${bodyBuffer.length} bytes`);
  console.log(`🔍 First 8 bytes (should be JPEG magic): ${bodyBuffer.subarray(0, 8).toString('hex')}`);
  console.log(`   Expected JPEG magic: ff d8 ff e0 or ff d8 ff e1\n`);

  // WordPress REST API endpoint
  const endpoint = 'http://localhost:5555/wp-json/wp/v2/media';
  const authToken = process.env.WORDPRESS_AUTH_TOKEN;
  if (!authToken) {
    console.error('❌ WORDPRESS_AUTH_TOKEN environment variable is not set');
    process.exit(1);
  }
  const base64Token = Buffer.from(authToken).toString('base64');

  // Build headers (exactly like successful curl)
  const headers: Record<string, string> = {
    'Content-Type': 'image/jpeg',
    'Content-Disposition': 'attachment; filename=test.jpg',
    'Content-Length': bodyBuffer.length.toString(),
    'Authorization': `Basic ${base64Token}`,
  };

  console.log('📤 Uploading to WordPress...');
  console.log('Headers:', JSON.stringify(headers, null, 2));

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: bodyBuffer,
    });

    console.log(`\n📊 Response: HTTP ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Upload FAILED');
      console.error('Error:', errorText);
      process.exit(1);
    }

    const result = await response.json();
    console.log('✅ Upload SUCCESS!');
    console.log(`  - Media ID: ${result.id}`);
    console.log(`  - Source URL: ${result.source_url}`);

  } catch (error) {
    console.error('❌ Upload FAILED');
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

testMinimalUpload();
