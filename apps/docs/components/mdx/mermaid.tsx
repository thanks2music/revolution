import { renderMermaidSVG } from 'beautiful-mermaid';
import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock';

// 公式の例 (https://www.fumadocs.dev/docs/markdown/mermaid) と同じく、ビルド時にサーバーで SVG にする。
// 公式の例は try の中で JSX を返すが、描画時のエラーは try で捕まらない (react-hooks/error-boundaries)
// ので、SVG の生成だけを try に入れる。
export function Mermaid({ chart }: { chart: string }) {
  const svg = renderSvg(chart);

  // 描けない記法はコードブロックのまま見せる。
  if (svg === undefined) {
    return (
      <CodeBlock title="Mermaid">
        <Pre>{chart}</Pre>
      </CodeBlock>
    );
  }

  // 図の文字列は beautiful-mermaid がエスケープしてから SVG に入れる (< > & " ')。
  // 元は repo の docs/ で、外部の入力は入らない。
  // SVG は図の大きさの幅を持つので、本文より広い図は横にスクロールさせる (縮めると文字が読めなくなる)。
  return <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function renderSvg(chart: string): string | undefined {
  try {
    return renderMermaidSVG(chart, {
      bg: 'var(--color-fd-background)',
      fg: 'var(--color-fd-foreground)',
      interactive: true,
      transparent: true,
    });
  } catch {
    return undefined;
  }
}
