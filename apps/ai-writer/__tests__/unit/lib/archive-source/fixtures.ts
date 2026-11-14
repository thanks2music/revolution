/** Synthetic archive source and article for the archive-source tests (no real site) */
import type { ArchiveSource } from '@/lib/archive-source/config';

export const SOURCE: ArchiveSource = {
  id: 'test',
  hosts: ['archive.example.com'],
  api_base: 'https://archive.example.com/wp-json/wp/v2/events',
  categories: { '10': 'collabo-cafe', '20': 'pop-up-store' },
  fields: { categories: 'event_types', start: 'starts_at', end: 'ends_at' },
  official_url: {
    table_row_labels: ['特設ページ', '公式サイト'],
    fallback_selector: 'a.official-link',
    exclude_hosts: ['twitter.com', 'x.com', 'shop.example.net'],
    exclude_query_params: ['utm_source'],
  },
  noise_selectors: ['ins.adsbygoogle', '.affiliate', 'blockquote.twitter-tweet', '.app-banner'],
  images: {
    path_prefixes: ['/wp-content/uploads/'],
    exclude_name_contains: ['dummy.png', 'app-banner'],
    section_keywords: { menu: ['メニュー'], novelty: ['ノベルティ', '特典'], goods: ['グッズ', '商品'] },
    default_category_by_event_type: { 'pop-up-store': 'goods' },
  },
};

export const ARTICLE_URL = 'https://archive.example.com/events/collabo/sample-event-2019/';

/** An article in the archive's layout: sections under <h2>, a summary table, noise blocks, lazy images */
export const ARTICLE_HTML = `
<p><img src="https://archive.example.com/wp-content/uploads/kv.jpg" alt=""></p>
<h2>サンプル作品カフェのメニュー</h2>
<p><img src="/wp-content/uploads/dummy.png" data-src="https://archive.example.com/wp-content/uploads/menu-1.jpg" alt=""></p>
<p><img src="/wp-content/uploads/menu-2.jpg" alt=""></p>
<ins class="adsbygoogle"><img src="https://ads.example.org/ad.jpg"></ins>
<h2>サンプル作品カフェのノベルティ</h2>
<div class="affiliate"><img src="https://images.example.org/item.jpg"></div>
<p><img src="https://archive.example.com/wp-content/uploads/novelty-1.jpg" alt=""></p>
<h2>サンプル作品カフェのグッズ</h2>
<p>描き下ろしイラストを使用したグッズ</p>
<p><img src="https://archive.example.com/wp-content/uploads/goods-1.jpg" alt=""></p>
<p><img src="https://archive.example.com/wp-content/uploads/menu-2.jpg" alt=""></p>
<div class="app-banner"><img src="https://archive.example.com/wp-content/uploads/app-banner-2.png"></div>
<blockquote class="twitter-tweet"><p>tweet</p></blockquote>
<h2>サンプル作品カフェのイベント開催概要</h2>
<table><tbody>
<tr><th>開催期間</th><td>2019年1月22日〜2月3日</td></tr>
<tr><th>公式サイト</th><td><a href="https://official.example.com/event/">公式</a></td></tr>
<tr><th>公式X</th><td><a href="https://twitter.com/sample">X</a></td></tr>
</tbody></table>
<p><img src="https://archive.example.com/wp-content/uploads/map.jpg" alt=""></p>
`;
