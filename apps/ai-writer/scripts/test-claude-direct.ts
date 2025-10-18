#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Anthropic } from '@anthropic-ai/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '.env.local') });

async function testDirect() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const title = '呪術廻戦';

  const prompt = `Convert the following Japanese title to a URL-friendly slug (lowercase alphanumeric characters and hyphens only).

Title: ${title}

Requirements:
- Use English transliteration or common English title if available (e.g., "魔法少女まどか☆マギカ" → "madoka-magica", "呪術廻戦" → "jujutsu-kaisen")
- If no English title exists, use Romaji (e.g., "鬼滅の刃" → "kimetsu-no-yaiba")
- All lowercase, words separated by hyphens
- Remove special characters
- Keep it simple and memorable

Output format: Return ONLY the slug, nothing else. DO NOT include markdown formatting, code blocks, or explanations.

Examples:
- 魔法少女まどか☆マギカ → madoka-magica
- 呪術廻戦 → jujutsu-kaisen
- 鬼滅の刃 → kimetsu-no-yaiba

Slug:`;

  console.log('=== Direct Claude API Test ===\n');
  console.log(`Title: "${title}"\n`);

  const response = await client.messages.create({
    model: 'claude-3-7-sonnet-20250219',
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
