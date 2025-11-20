/**
 * Claude API Metadata Generator デバッグスクリプト
 *
 * 使用方法:
 *   pnpm tsx scripts/debug-metadata-generator.ts
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// ES Module で __dirname を取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// .env.local を読み込む
config({ path: resolve(__dirname, '../.env.local') });

import { generateArticleMetadata } from '../lib/claude';

async function main() {
  console.log('🔍 Claude API メタデータ生成のデバッグ開始...\n');

  const testInput = {
    content: `# 今年も「渋谷事変」のコラボレーションカフェが開催決定！「呪術廻戦カフェ2025 渋谷事変」期間限定オープン！！

## “休息”をテーマにした空間の中、キャラクター達の姿を思い浮かべながらゆったりした時間をお楽しみください

[](https://twitter.com/intent/tweet?text=%E4%BB%8A%E5%B9%B4%E3%82%82%E3%80%8C%E6%B8%8B%E8%B0%B7%E4%BA%8B%E5%A4%89%E3%80%8D%E3%81%AE%E3%82%B3%E3%83%A9%E3%83%9C%E3%83%AC%E3%83%BC%E3%82%B7%E3%83%A7%E3%83%B3%E3%82%AB%E3%83%95%E3%82%A7%E3%81%8C%E9%96%8B%E5%82%AC%E6%B1%BA%E5%AE%9A%EF%BC%81%E3%80%8C%E5%91%AA%E8%A1%93%E5%BB%BB%E6%88%A6%E3%82%AB%E3%83%95%E3%82%A72025%20%E6%B8%8B%E8%B0%B7%E4%BA%8B%E5%A4%89%E3%80%8D%E6%9C%9F%E9%96%93%E9%99%90%E5%AE%9A%E3%82%AA%E3%83%BC%E3%83%97%E3%83%B3%EF%BC%81%EF%BC%81&url=https%3A%2F%2Fprtimes.jp%2Fmain%2Fhtml%2Frd%2Fp%2F000000247.000086964.html&via=PRTIMES_JP)

[](https://prtimes.jp/im/action.php?run=html&page=releaseimage&company_id=86964&release_id=247)

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-3e05c6ce318e9693cd5b9be61851fbda-1280x720.jpg?width=1950&height=1350&quality=85%2C75&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

　株式会社CLホールディングス（東京都港区、代表取締役社長：内川 淳一郎）の子会社である株式会社エルティーアール（東京都港区、代表取締役社長：谷 丈太朗）は、株式会社MAPPA協力のもと、TVアニメ『呪術廻戦』第2期「渋谷事変」をテーマにしたカフェ、「呪術廻戦カフェ2025 渋谷事変」を、2025年9月25日（木）より東京にて、10月2日（木）より大阪、愛知にて、期間限定オープンいたします。

■「呪術廻戦カフェ2025 渋谷事変」公式サイト：[https://jujutsukaisen-cafe.jp](https://jujutsukaisen-cafe.jp/)

　『呪術廻戦』は、「週刊少年ジャンプ」にて連載された芥見下々氏による漫画です。TVアニメ1期は2020年10月から2021年3月まで全24話が放送され、2021年12月24日からは映画「劇場版 呪術廻戦 0」も公開されました。その後、TVアニメ第2期が放送され、今年の10月17日『劇場版 呪術廻戦 0』復活上映が劇場公開し、11月7日には『劇場版 呪術廻戦「渋谷事変 特別編集版」×「死滅回游 先行上映」』劇場公開決定。さらに、TVアニメ第3期「死滅回游 前編」は2026年1月放送決定とますます盛り上がりを見せています。

　このたび、“休息”をテーマにした、TVアニメ『呪術廻戦』第2期「渋谷事変」の新規描き下ろしイラストを使用したコラボレーションカフェの開催が決定いたしました。

　メニューは、虎杖悠仁、伏黒恵、釘崎野薔薇、七海建人、五条悟などのキャラクターをイメージしたフードやデザート、ドリンクなどを展開いたします。

　各々の休息を楽しむキャラクターの姿を思い浮かべながら、ゆったりしたカフェタイムをお楽しみください。

**TVアニメ『呪術廻戦』第2期「渋谷事変」**

＜イントロダクション・ストーリー＞

10月31日、ハロウィンで賑わう渋谷駅周辺に突如“帳”が下ろされ大勢の一般人が閉じ込められる。

単独で渋谷平定へと向かう五条だが、これは夏油や真人ら呪詛師・呪霊達による罠だった…。

虎杖、伏黒、釘崎といった高専生のメンバーや呪術師たちも渋谷に集結し、かつてない大規模な戦闘が始まろうしていた。

■TVアニメ『呪術廻戦』公式サイト：[https://www.jujutsukaisen.jp/](https://www.jujutsukaisen.jp/)

■『呪術廻戦』アニメ公式Twitter：@animejujutsu

**＜開催概要＞**

◇開催場所/期間

 ■東京・池袋：BOX cafe&space マツモトキヨシ池袋Part2店/2025年9月25日（木）～11月3日（月・祝）

東京都豊島区東池袋1-22-8 マツモトキヨシ 池袋Part2店 4階

■東京・表参道：BOX cafe&space 表参道店/2025年10月11日（土）～11月3日（月・祝）

　東京都渋谷区神宮前5-13-2 パインアンダーフラット地下1階

■大阪・梅田：BOX cafe&space ＫＩＴＴＥ OSAKA 2号店/2025年10月2日（木）～11月3日（月・祝）

大阪府大阪市北区梅田3-2-2 KITTE大阪 6階

■愛知・名古屋：BOX cafe&space 名古屋ラシック1号店/2025年10月2日（木）～11月3日（月・祝）

愛知県名古屋市中区栄 3-6-1 ラシック 地下1階

＜予約方法＞

抽選予約となります（後日、空席を先着予約受付）

＜予約スケジュール＞

・カフェサイトオープン：9月4日（木） 12：00～

・抽選予約受付期間：9月4日（木） 18：00〜9月7日（日）23：59 　

・当落発表＆入金受付開始：9月12日（金） 15：00～

・一般先着予約開始：9月24日（水） 12：00～

・予約金: 660円(税込) ※予約特典付き

※抽選予約・先着予約ともに、入金期間は決済方法によって異なります。詳しくはカフェサイトをご確認ください。

■「呪術廻戦カフェ2025 渋谷事変」公式サイト：[https://jujutsukaisen-cafe.jp](https://jujutsukaisen-cafe.jp/)

**特典**

 ※画像はイメージです

■事前予約者限定カフェ利用特典：事前予約(税込660円）/1名)にてカフェをご利用いただいた方全員に「A5クリアファイル（全5種）」をランダムで1枚をプレゼント。

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-5573bf1d1c92b8ad08a0faae18c96409-700x862.jpg?width=1950&height=1350&quality=85%2C75&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

予約特典

■ドリンク注文特典：カフェでドリンクメニューをご注文された方に

「オリジナル紙コースター（全5種）」をランダムで1品につき1枚プレゼント。

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-ff79c42113602ac8b631ec3472104444-700x862.jpg?width=1950&height=1350&quality=85%2C75&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

ドリンク注文特典

■通販購入特典：オンラインショップの購入額、税込3,300円毎にランダムで

「ミニカード（全5種）」を1枚プレゼント。

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-df8a166a7626f1d75092393d3337cdb3-700x862.jpg?width=1950&height=1350&quality=85%2C75&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

通販購入特典

**メニュー**

 ※画像はイメージです

**＜フード&デザート＞**

**●【虎杖悠仁】「黒閃」ラーメン　　税込1,890円**

黒いフライドオニオンと赤い担々ソースで虎杖の「黒閃」を表現した鶏白湯ラーメンです。

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-30b8d0b00b2790f08a7a31f3499fdd9e-1080x720.jpg?width=1950&height=1350&quality=85%2C75&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

【虎杖悠仁】「黒閃」ラーメン

●**【伏黒恵】玉犬「渾」カレー　　税込1,890円**

ほうれん草カレーと黒いライスとチーズパウダーで伏黒の玉犬「渾」を表現したカレープレートです。

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-93401c8944425e15124c2dc0c5929c9e-1080x720.jpg?width=1950&height=1350&quality=85%2C75&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

【伏黒恵】玉犬「渾」カレー

●**【釘崎野薔薇】「共鳴り」トルティーヤ　　税込1,890円**

薔薇の花びらやにんじんのピクルスをあしらった釘崎らしいパストラミビーフとハムのトルティーヤです。

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-7ae3e3f1fafa2cec691dac52246fc6ff-1080x720.jpg?width=1950&height=1350&quality=85%2C75&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

【釘崎野薔薇】「共鳴り」トルティーヤ　

●**【七海建人】シーフード集合！トマト煮パスタ　　税込1,890円**

陀艮の領域「蕩蘊平線」内での七海をイメージしたシーフードのトマト煮込み風のパスタプレートです。

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-b6d719d0bfdb16d198ef6b317f0ebd56-1080x720.jpg?width=1950&height=1350&quality=85%2C75&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

【七海建人】シーフード集合！トマト煮パスタ

●**【五条悟】西京「最強」味噌サンド　　税込1,890円**

現代術師の中で最強な五条をイメージした西京味噌ソースのポークサンドウィッチです。

「蒼」と「赫」を表現したマヨネーズソースと一緒にお召し上がりください。

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-0100471d1b246edd186e33ded4740070-1080x720.jpg?width=1950&height=1350&quality=85%2C75&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

【五条悟】西京「最強」味噌サンド

●**【虎杖悠仁】1年の絆パフェ　マンゴー＆ピーチ　　税込1,590円**

虎杖をイメージしたマンゴーソースとイエローピーチをトッピングしたパフェです。

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-5d7cc8bb6625b3f485cadaf352801ff0-1080x720.jpg?width=1950&height=1350&quality=85%2C75&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

【虎杖悠仁】1年の絆パフェ　マンゴー＆ピーチ　

●**【伏黒恵】1年の絆パフェ　キウイ＆メロン　　　税込1,590円**

伏黒をイメージしたキウイとメロンシャーベットをトッピングしたパフェです。

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-27b79f1bca50f2415141c728b8799e8e-1080x720.jpg?width=1950&height=1350&quality=85%2C75&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

【伏黒恵】1年の絆パフェ　キウイ＆メロン　

●**【釘崎野薔薇】1年の絆パフェ　ストロベリー　　税込1,590円**

釘崎をイメージしたストロベリーや薔薇の花びらをトッピングしたパフェです。

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-393847ef6550731e753694a3b0f785e2-1080x720.jpg?width=1950&height=1350&quality=85%2C75&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

【釘崎野薔薇】1年の絆パフェ　ストロベリー

●**【七海建人】ネクタイモチーフシフォンケーキ　　税込1,690円**

七海のネクタイの柄をイメージしたバナナの入ったキャラメル風味のシフォンケーキです。

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-b4d2deb37c0f5ed8713a46ae333b988a-1080x720.jpg?width=1950&height=1350&quality=85%2C75&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

【七海建人】ネクタイモチーフシフォンケーキ　

●**【五条悟】「無下限呪術」パンケーキ　　税込1,690円**

五条の「無下限呪術」をイメージしたマスカルポーネクリーム風味のパンケーキです。

**＜ドリンク＞**

**●【虎杖悠仁】マンゴードリンク　　税込1,090円**

虎杖をイメージしたマンゴー風味のソーダです。

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-af050f0f455be0a46d495f144ce7033c-1080x720.jpg?width=1950&height=1350&quality=85%2C75&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

【虎杖悠仁】マンゴードリンク　

●**【伏黒恵】パインドリンク　　税込1,090円**

伏黒をイメージしたココナッツ＆パイン風味のドリンクです。

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-f86634476afceff2fd00c39b2a751d79-1080x720.jpg?width=1950&height=1350&quality=85%2C75&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

【伏黒恵】パインドリンク　

●**【釘崎野薔薇】ラズベリー＆ローズドリンク　　税込1,090円**

釘崎をイメージしたベリー＆ローズ風味のドリンクです。

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-7036ae9e125f03b7ed147d01bb9f4b13-1080x720.jpg?width=1950&height=1350&quality=85%2C75&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

【釘崎野薔薇】ラズベリー＆ローズドリンク　

●**【七海建人】ハニージンジャーカモミールティー　　税込1,090円**

七海をイメージしたハニージンジャーカモミールティーです。

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-fe946261a2d7453f4178bca497a13653-1080x720.jpg?width=1950&height=1350&quality=85%2C75&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

【七海建人】ハニージンジャーカモミールティー

●**【五条悟】ザクロ＆ライチドリンク　　税込1,090円**

五条をイメージしたザクロ＆ライチ風味のソーダです。

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-b22878fe4e414845700fb4f7401427fd-1080x720.jpg?width=1950&height=1350&quality=85%2C75&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

【五条悟】ザクロ＆ライチドリンク

**＜SIDE DRINK＞**

 ・ホットコーヒー　　　　　　

・ホットティー         

・アイスコーヒー       

・アイスティー　

・コーラ

・オレンジ

・ジンジャエール

 **税込各690円**       

※ワンオーダー対象外です。

※ドリンク特典対象です。

**オリジナルグッズ**

※画像はイメージです。

※発売日はカフェサイトをご覧ください。

●缶バッジ（ランダム5種）　　税込605円

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-78e7f61a7d88669959e69c48ac96fb32-1000x1000.jpg?width=1950&height=1350&quality=85%2C65&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

缶バッジ（ランダム5種）

●アクリルキーホルダー（ランダム5種）　　税込770円

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-6762eb5f72cd9b85f73609874bb301b0-1000x1000.jpg?width=1950&height=1350&quality=85%2C65&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

●アクリルスタンド（全5種）　　税込1,430円

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-c77e96bc00161f98c481571f5d38bf7f-1000x1000.jpg?width=1950&height=1350&quality=85%2C65&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

アクリルスタンド（全5種）　

●ポストカードセット（5枚入り）　　税込770円

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-2ed6bf39314dc4707adbf690b47e31d9-1000x1000.jpg?width=1950&height=1350&quality=85%2C65&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

ポストカードセット（5枚入り）

●ステッカーセット（5枚入り）　　税込1,045円

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-236b085e157e8b8f412eaeaf6cc123b5-1000x1000.jpg?width=1950&height=1350&quality=85%2C65&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

ステッカーセット（5枚入り）

●ミニキャラアクリルキーホルダー（ランダム5種）　　税込770円

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-4e0b6ec472916b6b91ce329e89e11593-1000x1000.jpg?width=1950&height=1350&quality=85%2C65&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

ミニキャラアクリルキーホルダー（ランダム5種）

●ミニキャラアクリルスタンド（ランダム5種）　　税込990円

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-60c9b9c0975399524e02f6ffe378be7f-1000x1000.jpg?width=1950&height=1350&quality=85%2C65&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

ミニキャラアクリルスタンド（ランダム5種）

●アイコンステッカー（全5種）　　税込各605円

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-f3e40703a280f28aae1b91fabf17964b-1000x1000.jpg?width=1950&height=1350&quality=85%2C65&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

アイコンステッカー（全5種）

●巾着（全5種）　税込各1,650円

![](https://prcdn.freetls.fastly.net/release_image/86964/247/86964-247-95f6a979a9bf20ebd05ca147b2637b98-1000x1000.jpg?width=1950&height=1350&quality=85%2C65&format=jpeg&auto=webp&fit=bounds&bg-color=fff)

巾着（全5種）

【コピーライト表記】

©芥見下々／集英社・呪術廻戦製作委員会

## 開催情報

- 開催期間: 2025年12月25日〜2026年1月15日
- 開催場所: アニメイトカフェ池袋店、アニメイトカフェ大阪日本橋店`,
    title: '呪術廻戦×アニメイトカフェ2025が東京・大阪で開催決定',
    workTitle: '呪術廻戦',
    eventType: 'コラボカフェ',
  };

  try {
    console.log('📝 入力データ:');
    console.log('  タイトル:', testInput.title);
    console.log('  作品:', testInput.workTitle);
    console.log('  イベントタイプ:', testInput.eventType);
    console.log('  コンテンツ長:', testInput.content.length, '文字\n');

    console.log('🚀 Claude APIを呼び出し中...\n');

    const metadata = await generateArticleMetadata(testInput);

    console.log('✅ 生成成功!\n');
    console.log('📊 結果:');
    console.log('  カテゴリ:', metadata.categories);
    console.log('  カテゴリ数:', metadata.categories.length);
    console.log('  要約:', metadata.excerpt);
    console.log('  要約文字数:', metadata.excerpt.length);
  } catch (error) {
    console.error('❌ エラー発生:', error);
    if (error instanceof Error) {
      console.error('  メッセージ:', error.message);
      console.error('  スタックトレース:', error.stack);
    }
    process.exit(1);
  }
}

main();
