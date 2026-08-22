/**
 * 空状態のカード (Claude Design v6)。
 *
 * v6 は 6 画面すべてで空状態を「枠付き・中央寄せのカード」として描いている。
 * 旧実装は件数行のテキストを差し替えるだけだったため、0 件のときにページが
 * 「見出しの下に何も無い」状態に見えていた。
 *
 * ## 空状態は異常ではない
 *
 * 作品ハブ・会場ページは**開催 0 件でもページを生成する**方針 (集合を絞ると
 * 一覧・生成対象・詳細の 404 ゼロが崩れるため)。つまり空状態は通常状態であり、
 * エラー表現にしない — 枠線も文字色も通常のカードと同じトーンで置く。
 *
 * 文言は呼び出し側が持つ (画面ごとに主語が変わるため)。
 *
 * ⚠️ **補助アクション用の `children` は置かない。** v6 #18 の空状態には
 *    「すべての記事を見る」ボタンがあるが、そのページは記事 0 件のカテゴリを
 *    そもそも生成しない (`notFound()` に倒す) ため**到達しない**。
 *    実際に必要になった呼び出し側が現れた時点で足す
 *    (`development-principles.md` の YAGNI: 「将来使うかもしれないオプション
 *    パラメータを追加」しない)。
 */

type Props = {
  /** 「まだ登録されていません」等。画面ごとの主語を含めた完全な文で渡す。 */
  message: string;
};

export const EmptyState = ({ message }: Props) => (
  <div className="rounded-xl border border-[var(--line-soft)] bg-bg-elevated p-6 text-center">
    <p className="text-sm text-ink-muted">{message}</p>
  </div>
);

export default EmptyState;
