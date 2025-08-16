import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

type Section = {
  id: string;
  title: string;
  order: string[];
  prerequisites?: string[];
  outcomes?: string[];
};

type IndexJson = {
  version: number;
  language?: string;
  sections: Section[];
  ai_guidance?: {
    read_first?: string[];
    preferred_variants?: Record<string, string>;
  };
};

type TocItem = {
  sectionId: string;
  sectionTitle: string;
  file: string;
  title: string; // H1 from MD
  recommended?: boolean; // v2等の推奨
};

const DOCS_DIR = path.resolve(process.cwd(), 'docs');
const INDEX_PATH = path.join(DOCS_DIR, 'index.json');

async function readIndexJson(): Promise<IndexJson> {
  const buf = await fs.readFile(INDEX_PATH, 'utf8');
  return JSON.parse(buf) as IndexJson;
}

async function readH1(mdAbsPath: string): Promise<string> {
  const text = await fs.readFile(mdAbsPath, 'utf8');
  // 最初の H1 を取得（先頭 # の行）
  const m = text.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : path.basename(mdAbsPath);
}

function detectVariantRecommendation(
  fileRelPath: string,
  preferred?: Record<string, string>
): boolean {
  if (!preferred) return false;
  // 例: key = "02-mono/MONO-integration-guide", val="v2"
  for (const [base, ver] of Object.entries(preferred)) {
    if (fileRelPath.startsWith(base)) {
      // v2推奨なら、ファイル名末尾が v2 なら true
      return fileRelPath.toLowerCase().includes(ver.toLowerCase());
    }
  }
  return false;
}

async function validateFilesExist(pathsRel: string[]) {
  const missing: string[] = [];
  for (const rel of pathsRel) {
    const abs = path.join(DOCS_DIR, rel);
    try {
      const st = await fs.stat(abs);
      if (!st.isFile()) missing.push(rel);
    } catch {
      missing.push(rel);
    }
  }
  if (missing.length) {
    throw new Error(`index.jsonに記載されたファイルが見つかりません:\n- ${missing.join('\n- ')}`);
  }
}

async function buildToc(idx: IndexJson): Promise<TocItem[]> {
  const allPaths = idx.sections.flatMap(s => s.order);
  await validateFilesExist(allPaths);

  // 重複チェック
  const dup = allPaths.filter((p, i, arr) => arr.indexOf(p) !== i);
  if (dup.length) {
    throw new Error(`index.json の order に重複があります: ${[...new Set(dup)].join(', ')}`);
  }

  const toc: TocItem[] = [];
  for (const sec of idx.sections) {
    for (const rel of sec.order) {
      const abs = path.join(DOCS_DIR, rel);
      const h1 = await readH1(abs);
      toc.push({
        sectionId: sec.id,
        sectionTitle: sec.title,
        file: rel,
        title: h1,
        recommended: detectVariantRecommendation(rel, idx.ai_guidance?.preferred_variants)
      });
    }
  }
  return toc;
}

function toMarkdown(toc: TocItem[], idx: IndexJson): string {
  const bySection = new Map<string, TocItem[]>();
  for (const item of toc) {
    const list = bySection.get(item.sectionId) ?? [];
    list.push(item);
    bySection.set(item.sectionId, list);
  }

  const lines: string[] = [];
  lines.push(`# ドキュメント目次`);
  if (idx.ai_guidance?.read_first?.length) {
    lines.push(`\n> **先に読む推奨**`);
    for (const rf of idx.ai_guidance.read_first) {
      lines.push(`> - ${rf}`);
    }
  }
  lines.push('');

  for (const sec of idx.sections) {
    lines.push(`\n## ${sec.title}`);
    if (sec.prerequisites?.length) {
      lines.push(`- 前提: ${sec.prerequisites.join(', ')}`);
    }
    if (sec.outcomes?.length) {
      lines.push(`- 到達点: ${sec.outcomes.join(', ')}`);
    }
    const items = bySection.get(sec.id) ?? [];
    for (const it of items) {
      const mark = it.recommended ? ' **(推奨)**' : '';
      lines.push(`- [${it.title}](${it.file})${mark}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const idx = await readIndexJson();
  const toc = await buildToc(idx);
  const md = toMarkdown(toc, idx);

  // 出力先
  await fs.writeFile(path.join(DOCS_DIR, 'TOC.generated.md'), md, 'utf8');

  // JSON でも出す（ツール連携用）
  await fs.writeFile(
    path.join(DOCS_DIR, 'TOC.generated.json'),
    JSON.stringify(toc, null, 2),
    'utf8'
  );

  console.log(`✅ TOC.generated.md / TOC.generated.json を出力しました`);
}

main().catch(e => {
  console.error('❌ docs-index 失敗:', e.message);
  process.exit(1);
});
