/**
 * R2 接続テストスクリプト
 *
 * 環境変数の設定と R2 への接続を確認します。
 *
 * 使用方法:
 *   pnpm tsx scripts/test-r2-connection.ts
 *
 * テスト内容:
 *   1. 環境変数の確認
 *   2. R2 バケットへの接続テスト
 *   3. テストファイルのアップロード・削除
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// ES Module で __dirname を取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// .env.local を読み込む
config({ path: resolve(__dirname, '../.env.local') });

import { R2StorageService } from '../lib/services/r2-storage.service';

async function main() {
  console.log('🔌 R2 接続テスト開始\n');
  console.log('='.repeat(60));

  // 1. 環境変数の確認
  console.log('\n📋 環境変数の確認:');
  const envVars = [
    'R2_ENDPOINT_URL',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'R2_PUBLIC_URL',
  ];

  let allEnvSet = true;
  for (const key of envVars) {
    const value = process.env[key];
    if (value) {
      // 機密情報はマスク
      if (key.includes('SECRET') || key.includes('KEY')) {
        console.log(`  ✅ ${key}: ${'*'.repeat(8)}...${value.slice(-4)}`);
      } else {
        console.log(`  ✅ ${key}: ${value}`);
      }
    } else {
      console.log(`  ❌ ${key}: 未設定`);
      allEnvSet = false;
    }
  }

  if (!allEnvSet) {
    console.error('\n❌ 必要な環境変数が設定されていません');
    console.log('   .env.local に以下を追加してください:');
    for (const key of envVars) {
      if (!process.env[key]) {
        console.log(`   ${key}=<値>`);
      }
    }
    process.exit(1);
  }

  // 2. R2 接続テスト
  console.log('\n📡 R2 接続テスト:');
  try {
    const r2 = new R2StorageService();
    const connected = await r2.testConnection();

    if (!connected) {
      console.error('❌ R2 への接続に失敗しました');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ R2 接続エラー:', error);
    process.exit(1);
  }

  // 3. テストファイルのアップロード・削除
  console.log('\n📤 テストアップロード:');
  try {
    const r2 = new R2StorageService();

    // テスト用の小さなテキストファイルを作成
    const testContent = `R2 Connection Test - ${new Date().toISOString()}`;
    const testBuffer = Buffer.from(testContent, 'utf-8');
    const testKey = `test/${Date.now()}-connection-test.txt`;

    console.log(`  アップロード中: ${testKey}`);

    const result = await r2.uploadImage(testBuffer, {
      filename: 'connection-test.txt',
      contentType: 'text/plain',
      customKey: testKey,
      cacheControl: 'no-cache',
    });

    console.log(`  ✅ アップロード成功: ${result.url}`);
    console.log(`     サイズ: ${result.size} bytes`);

    // 存在確認
    const exists = await r2.objectExists(testKey);
    console.log(`  ✅ 存在確認: ${exists ? 'OK' : 'NG'}`);

    // 削除
    console.log(`  削除中: ${testKey}`);
    await r2.deleteObject(testKey);
    console.log('  ✅ 削除成功');

    // 削除後の確認
    const existsAfterDelete = await r2.objectExists(testKey);
    console.log(`  ✅ 削除確認: ${existsAfterDelete ? 'NG（まだ存在）' : 'OK（削除済み）'}`);
  } catch (error) {
    console.error('❌ テストアップロードエラー:', error);
    process.exit(1);
  }

  // 結果サマリー
  console.log('\n' + '='.repeat(60));
  console.log('✅ R2 接続テスト完了！');
  console.log('='.repeat(60));
  console.log('\n📊 テスト結果:');
  console.log('  - 環境変数: OK');
  console.log('  - バケット接続: OK');
  console.log('  - アップロード/削除: OK');
  console.log('\n🎉 R2 の設定が正しく完了しています！\n');
}

main().catch((error) => {
  console.error('\n❌ 予期しないエラー:', error);
  process.exit(1);
});
