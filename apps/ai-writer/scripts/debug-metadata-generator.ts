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
    content: `# 作品名と店舗名のコラボイベントが開催決定

## コンセプト
作品の世界観を再現した店内で、オリジナルメニューや限定グッズを提供する期間限定カフェです。

## 開催概要
- 開催期間: 2025年10月〜11月
- 開催場所: 東京・大阪・名古屋の主要エリア
- 予約方法: 事前予約制（先着順）

## メニュー例
- キャラクターをイメージしたフード3種
- 限定デザート2種
- カラーを合わせたドリンク3種

## 特典
- 予約特典: クリアファイル
- ドリンク特典: コースター
- グッズ特典: ミニカード`,
    title: '作品名×店舗名2025が主要都市で開催決定',
    workTitle: '作品名',
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
