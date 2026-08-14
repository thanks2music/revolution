/**
 * PostgREST の行数上限を跨いで**全行を確実に読む**ためのページング。
 *
 * ## なぜ必要か (PR #303 のレビュー指摘)
 *
 * `generateStaticParams` は「全件を列挙する」ことが前提の関数だが、PostgREST は
 * **サーバ側の `db.max_rows`（Supabase ホスティングの既定は 1000）で結果を打ち切る**。
 * 打ち切られてもエラーにはならないため、行が閾値を超えた瞬間から
 * **「順序不定の先頭 N 件だけが静的生成される」**という無言の劣化が始まる。
 *
 * これは PR #302 で「0 件とクエリ失敗を区別する」ために throw を入れたのと
 * **同じクラスの問題**（黙って壊れて気づけない）なので、同じ姿勢で塞ぐ。
 *
 * ## 設計
 *
 * - **`order` は呼び出し側の責務**。`range()` はサーバ側の順序に依存するので、
 *   order の無いページングは**ページ間で行が重複・欠落し得る**。
 *   ⚠️ ただし **型では強制できていない** (`fetchPage` の中身は呼び出し側が組む)。
 *   規律に依存している箇所なので、新しい呼び出し側を足すときは必ず order を付ける。
 * - 上限に達したら例外にする。無限ループを避けつつ、**「多すぎる」を沈黙させない**。
 *
 * ## ⚠️ 終端判定は `PAGE_SIZE < db.max_rows` を前提にしている
 *
 * `chunk.length < PAGE_SIZE` を終端と見なすため、**サーバ側の `max_rows` が
 * `PAGE_SIZE` より小さいと 1 ページ目で「完了」と誤判定する**。
 * Supabase 既定の `max_rows = 1000` に対して `PAGE_SIZE = 500` を選んでいるのは
 * この前提を満たすため。**`max_rows` を 500 未満に設定したらここが壊れる。**
 *
 * 前提に依存せず正確に判定するには `count: 'exact'` の総件数 (Content-Range) と
 * 取得件数を突き合わせる必要がある。現状は前提で足りているので入れていない。
 */

const PAGE_SIZE = 500;

/** 安全弁。これを超えたら設計側の想定が崩れているので黙って切り詰めない。 */
const MAX_PAGES = 200;

/**
 * PostgREST の戻り値の最小形。
 *
 * ⚠️ **クエリビルダは `Promise` ではなく `PromiseLike`**（`then` だけを持つ）。
 *    `Promise` で受けると型が合わない。
 */
type PageResult = { data: unknown[] | null; error: { message: string } | null };

/**
 * `from` を渡すのではなく **ページ範囲を受け取ってクエリを実行する関数**を渡す。
 * 呼び出し側が select / filter を自由に組めるようにするため。
 *
 * 戻り値は `unknown[]` にしている。行の形の真実源は zod であり、ここで
 * ジェネリクスに型を書くと**検証していない型注釈**（見せかけの型安全）に
 * なるため、呼び出し側の `parse()` に委ねる。
 */
export async function fetchAllRows(args: {
  /** ログに出す対象名 (エラーメッセージ用)。 */
  label: string;
  /** `(from, to)` の閉区間でクエリを実行する。order は呼び出し側で必ず付ける。 */
  fetchPage: (from: number, to: number) => PromiseLike<PageResult>;
}): Promise<unknown[]> {
  const rows: unknown[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await args.fetchPage(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`failed to fetch ${args.label} (page ${page}): ${error.message}`);
    }

    const chunk = data ?? [];
    rows.push(...chunk);

    // ページサイズ未満で終端。サーバ側 max_rows がページサイズより小さい場合も
    // ここで止まるが、その場合は次ページが空になるので取りこぼさない。
    if (chunk.length < PAGE_SIZE) return rows;
  }

  throw new Error(
    `failed to fetch ${args.label}: exceeded ${MAX_PAGES} pages (${MAX_PAGES * PAGE_SIZE} rows). ` +
      'ページングの想定を超えています。切り詰めて進めると静的生成から無言で漏れるため停止します。',
  );
}
