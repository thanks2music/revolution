#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CLAUDE_THINKING_SETTINGS, DEFAULT_CLAUDE_MODEL, claudeMaxTokens } from '../lib/config/claude-models.js';
import { createAnthropicClient } from '../lib/ai/anthropic-client.js';
import { readClaudeText } from '../lib/ai/claude-response.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../.env.local') });

async function testDirect() {
  const client = createAnthropicClient();

  const title = '作品名';

  const prompt = `Convert the following Japanese title to a URL-friendly slug (lowercase alphanumeric characters and hyphens only).

Title: ${title}

Requirements:
- Use English transliteration or common English title if available (e.g., "作品名A" → "work-a", "作品名" → "work-slug")
- If no English title exists, use Romaji (e.g., "作品名B" → "work-b")
- All lowercase, words separated by hyphens
- Remove special characters
- Keep it simple and memorable

Output format: Return ONLY the slug, nothing else. DO NOT include markdown formatting, code blocks, or explanations.

Examples:
- 作品名A → work-a
- 作品名B → work-b
- 作品名 → work-slug

Slug:`;

  console.log('=== Direct Claude API Test ===\n');
  console.log(`Title: "${title}"\n`);

  const response = await client.messages.create({
    model: DEFAULT_CLAUDE_MODEL,
    max_tokens: claudeMaxTokens(100),
    ...CLAUDE_THINKING_SETTINGS,
    messages: [{
      role: 'user',
      content: prompt
    }]
  });

  console.log('Full Response:');
  console.log(JSON.stringify(response, null, 2));

  console.log('\nContent block types:', response.content.map((block) => block.type).join(', '));

  const text = readClaudeText(response, 'test-claude-direct');
  console.log(`\nRaw text: "${text}"`);
  console.log(`Trimmed text: "${text.trim()}"`);
  console.log(`Length: ${text.trim().length}`);
}

testDirect().catch(console.error);
