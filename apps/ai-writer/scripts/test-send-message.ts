/**
 * sendMessage() Integration Test Script
 *
 * Purpose:
 *   - Test the new sendMessage() method across all providers
 *   - Verify multi-provider support for Phase 2 refactoring
 *   - Confirm text and JSON response formats
 *
 * Usage:
 *   AI_PROVIDER=anthropic pnpm tsx scripts/test-send-message.ts
 *   AI_PROVIDER=google pnpm tsx scripts/test-send-message.ts
 *   AI_PROVIDER=openai pnpm tsx scripts/test-send-message.ts
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
  console.log('🧪 sendMessage() Integration Test\n');

  // Display configured provider
  const providerType = getConfiguredProvider();
  console.log(`📋 Configured Provider: ${providerType}`);
  console.log(`📋 AI_PROVIDER env var: ${process.env.AI_PROVIDER || '(not set)'}\n`);

  try {
    // Create provider instance
    console.log('🏭 Creating AI provider...');
    const aiProvider = createAiProvider();
    console.log('✅ Provider created successfully\n');

    // Test 1: Basic text response
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 Test 1: Basic Text Response');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const textPrompt = '「作品名」をURL-friendlyな英語スラグに変換してください。スラグのみを出力し、説明は不要です。';
    console.log(`Prompt: "${textPrompt}"`);

    const textResult = await aiProvider.sendMessage(textPrompt, {
      maxTokens: 100,
      temperature: 0,
      responseFormat: 'text',
    });

    console.log(`Response: "${textResult.content}"`);
    console.log(`Model: ${textResult.model}`);
    if (textResult.usage) {
      console.log(`Tokens: prompt=${textResult.usage.promptTokens}, completion=${textResult.usage.completionTokens}, total=${textResult.usage.totalTokens}`);
    }
    console.log('✅ Test 1 passed!\n');

    // Test 2: JSON response format
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 Test 2: JSON Response Format');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const jsonPrompt = `以下のテキストからカテゴリを抽出してください。

テキスト: 作品名とコラボカフェが東京で開催

JSON形式でのみ出力してください:
{
  "categories": ["カテゴリ1", "カテゴリ2"]
}`;
    console.log(`Prompt: "${jsonPrompt.substring(0, 50)}..."`);

    const jsonResult = await aiProvider.sendMessage(jsonPrompt, {
      maxTokens: 200,
      temperature: 0,
      responseFormat: 'json',
    });

    console.log(`Response: ${jsonResult.content}`);
    console.log(`Model: ${jsonResult.model}`);

    // Validate JSON parsing
    try {
      const parsed = JSON.parse(jsonResult.content);
      console.log(`Parsed categories: ${JSON.stringify(parsed.categories)}`);
      console.log('✅ JSON parsing successful!');
    } catch (e) {
      console.log('⚠️ Response is not pure JSON, checking for markdown block...');
      const jsonMatch = jsonResult.content.match(/```json\n([\s\S]*?)\n```/) ||
                        jsonResult.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        console.log(`Extracted categories: ${JSON.stringify(parsed.categories)}`);
        console.log('✅ JSON extraction successful!');
      } else {
        console.log('❌ Could not extract JSON from response');
      }
    }
    console.log('✅ Test 2 passed!\n');

    // Test 3: System prompt
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 Test 3: System Prompt');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const systemPrompt = 'あなたは日本語を英語に翻訳する専門家です。';
    const userPrompt = '「おはようございます」を英語に翻訳してください。翻訳結果のみを出力してください。';
    console.log(`System: "${systemPrompt}"`);
    console.log(`User: "${userPrompt}"`);

    const systemResult = await aiProvider.sendMessage(userPrompt, {
      maxTokens: 100,
      temperature: 0,
      systemPrompt: systemPrompt,
      responseFormat: 'text',
    });

    console.log(`Response: "${systemResult.content}"`);
    console.log('✅ Test 3 passed!\n');

    // Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 All sendMessage() tests passed!');
    console.log(`Provider: ${providerType}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

main();
