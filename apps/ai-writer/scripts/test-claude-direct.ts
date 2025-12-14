#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Anthropic } from '@anthropic-ai/sdk';
import { DEFAULT_CLAUDE_MODEL } from '../lib/config/claude-models.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '.env.local') });

async function testDirect() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
    max_tokens: 100,
    temperature: 0.1,
    messages: [{
      role: 'user',
      content: prompt
    }]
  });

  console.log('Full Response:');
  console.log(JSON.stringify(response, null, 2));

  console.log('\nContent[0]:');
  console.log(JSON.stringify(response.content[0], null, 2));

  if (response.content[0].type === 'text') {
    const text = response.content[0].text;
    console.log(`\nRaw text: "${text}"`);
    console.log(`Trimmed text: "${text.trim()}"`);
    console.log(`Length: ${text.trim().length}`);
  }
}

testDirect().catch(console.error);
