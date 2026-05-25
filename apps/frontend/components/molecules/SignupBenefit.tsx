import { SparkRule } from '@/components/atoms/ornament/SparkRule';
import { AuthNav } from '@/components/molecules/AuthNav';

/**
 * 会員登録ベネフィットブロック (Crescendolls 会員機能 / M4・任意ブロック D)
 *
 * 食べログのサイドカード相当を、Revolution の Editorial/余白基調に翻訳した
 * 「静かに常設された導線」。煽らず、体験の記録という動機に寄り添うコピー。
 * CTA は AuthNav (未ログイン=「ログイン / 登録」塗りボタン / ログイン済み=「マイページ」) を流用。
 *
 * Sky×Lightning Editorial トークン厳守 (bg-tinted + 稲妻アクセント罫、紫グラデ・煽り文言なし)。
 * 確定コピー: creative-director/copy/2026-05-25-signup-cta-copy.md
 */
export const SignupBenefit = () => {
  return (
    <aside className="bg-bg-tinted px-7 py-10 md:px-12 md:py-12">
      <SparkRule className="mb-5" width="2.5em" />
      <h2 className="font-display text-2xl text-ink-strong md:text-3xl">
        記録は、ここに残す。
      </h2>
      <p className="mt-4 max-w-prose text-base leading-relaxed text-ink-body">
        気になった体験を、いいねで記録。
        <br />
        ログインすると、あなたのページに集まります。
      </p>
      <div className="mt-7">
        <AuthNav variant="header" />
      </div>
    </aside>
  );
};

export default SignupBenefit;
