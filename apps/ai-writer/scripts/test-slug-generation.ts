#!/usr/bin/env tsx
/**
 * Test script to verify Claude API slug generation
 * Run with: npx tsx test-slug-generation.ts
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env.local
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '.env.local') });

import { ClaudeAPIService } from './lib/services/claude-api.service';

async function testSlugGeneration() {
  console.log('=== Testing Claude API Slug Generation ===\n');

  try {
    const claudeService = new ClaudeAPIService();

  // Monkey-patch to capture responses
  const originalCreate = (claudeService as any).client.messages.create.bind((claudeService as any).client.messages);
  (claudeService as any).client.messages.create = async function(params: any) {
    const response = await originalCreate(params);
    console.log('\n📡 Raw Claude API Response:');
    console.log(JSON.stringify(response.content[0], null, 2));
    return response;
  };

    const testTitles = [
      '作品名A',
      '作品名B',
      '架空作品C',
      'Sample Title'
    ];

    for (const title of testTitles) {
      console.log(`\nTesting: "${title}"`);
      console.log('---');

      try {
        const slug = await claudeService.generateSlug(title);
        console.log(`✅ Success: "${title}" → "${slug}"`);
        console.log(`   Length: ${slug.length}`);
      } catch (error) {
        console.error(`❌ Failed: "${title}"`, error);
      }
    }

    console.log('\n=== Test Complete ===');
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

testSlugGeneration();
