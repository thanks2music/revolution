import { createFromSource } from 'fumadocs-core/search/server';

import { source } from '@/lib/source';

// 公式の手順は language: 'english' を渡しているが、付けない。既定の multilingual は
// Unicode の単語分割で日本語も検索できる (https://www.fumadocs.dev/docs/headless/search/orama)。
export const { GET } = createFromSource(source);
