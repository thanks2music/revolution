/**
 * AI Factory Test Script
 *
 * Purpose:
 *   - Test the AI provider factory pattern
 *   - Verify Anthropic provider integration
 *   - Confirm provider switching mechanism
 *
 * Usage:
 *   pnpm tsx scripts/test-ai-factory.ts
 *   (Reads AI_PROVIDER from .env.local automatically)
 */

// Load environment variables from .env.local
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get current directory in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env.local from the ai-writer directory
config({ path: join(__dirname, '../.env.local') });

import { createAiProvider, getConfiguredProvider } from '../lib/ai/factory/ai-factory';

async function main() {
  console.log('🧪 AI Factory Test Script\n');

  // Display configured provider
  const providerType = getConfiguredProvider();
  console.log(`📋 Configured Provider: ${providerType}`);
  console.log(`📋 AI_PROVIDER env var: ${process.env.AI_PROVIDER || '(not set)'}\n`);

  try {
    // Create provider instance
    console.log('🏭 Creating AI provider...');
    const aiProvider = createAiProvider();
    console.log('✅ Provider created successfully\n');

    // Test 1: Connection Test
    console.log('🔌 Test 1: Connection Test');
    const isConnected = await aiProvider.testConnection();
    console.log(`Result: ${isConnected ? '✅ Connected' : '❌ Failed'}\n`);

    if (!isConnected) {
      console.error('❌ Connection test failed. Please check your API key.');
      process.exit(1);
    }

    // Test 2: Slug Generation
    console.log('🔤 Test 2: Slug Generation');
    const testTitle = '呪術廻戦';
    console.log(`Input: "${testTitle}"`);
    const slug = await aiProvider.generateSlug(testTitle);
    console.log(`Result: "${slug}"\n`);

    // Test 3: Excerpt Generation
    console.log('📝 Test 3: Excerpt Generation');
    const testContent = 'これはテスト記事です。AIプロバイダーの切り替え機能をテストしています。';
    console.log(`Input: "${testContent}"`);
    const excerpt = await aiProvider.generateExcerpt(testContent, 50);
    console.log(`Result: "${excerpt}"\n`);

    console.log('✅ All tests passed!');
    console.log('\n🎉 AI Factory is working correctly with Anthropic provider.');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

main();
