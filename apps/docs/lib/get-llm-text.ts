import type { DocsPage } from '@/lib/source';

// 公式の例 (https://www.fumadocs.dev/docs/integrations/llms) どおり。
// getText('processed') は lib/source.ts の includeProcessedMarkdown が必要。
export async function getLLMText(page: DocsPage): Promise<string> {
  const processed = await page.data.getText('processed');

  return `# ${page.data.title} (${page.url})

${processed}`;
}
