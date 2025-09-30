/**
 * Admin Setup Script
 * 管理者権限を設定するためのセットアップスクリプト
 *
 * 使用方法:
 * 1. .env.local に ADMIN_EMAILS を設定
 * 2. npm run setup:admin を実行
 */

import admin from 'firebase-admin';
import dotenv from 'dotenv';
import path from 'path';

// 環境変数を読み込み
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Firebase Admin SDK初期化
if (!admin.apps.length) {
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!serviceAccountPath) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS environment variable is not set');
  }

  const serviceAccount = require(serviceAccountPath);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

/**
 * 指定したメールアドレスのユーザーに管理者権限を付与
 */
async function setAdminClaim(email: string): Promise<void> {
  try {
    // メールアドレスからユーザーを取得
    const user = await admin.auth().getUserByEmail(email);

    // Custom Claimsを設定（既存のClaimsとマージ）
    const currentClaims = user.customClaims || {};
    await admin.auth().setCustomUserClaims(user.uid, {
      ...currentClaims,
      admin: true,
      allowedEditor: true,
    });

    console.log(`✅ Admin privileges granted to: ${email} (UID: ${user.uid})`);
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      console.log(`⚠️  User not found: ${email} (User needs to sign in at least once)`);
    } else {
      console.error(`❌ Error setting admin claim for ${email}:`, error.message);
    }
  }
}

/**
 * 環境変数から管理者メールアドレスを取得して権限を設定
 */
async function setupAdmins(): Promise<void> {
  const adminEmails = process.env.ADMIN_EMAILS;

  if (!adminEmails) {
    console.error('❌ ADMIN_EMAILS environment variable is not set');
    console.log('Please add ADMIN_EMAILS to your .env.local file:');
    console.log('ADMIN_EMAILS=user1@example.com,user2@example.com');
    process.exit(1);
  }

  const emails = adminEmails.split(',').map(email => email.trim());

  console.log('🔧 Setting up admin privileges for:', emails);
  console.log('');

  for (const email of emails) {
    if (email) {
      await setAdminClaim(email);
    }
  }

  console.log('');
  console.log('✨ Admin setup complete!');
  console.log('Note: Users need to sign out and sign in again for changes to take effect.');
}

/**
 * 現在の管理者リストを表示
 */
async function listAdmins(): Promise<void> {
  console.log('📋 Listing all users with admin privileges...\n');

  let adminCount = 0;
  const listAllUsers = async (nextPageToken?: string): Promise<void> => {
    const result = await admin.auth().listUsers(1000, nextPageToken);

    for (const user of result.users) {
      if (user.customClaims?.admin === true) {
        console.log(`  👤 ${user.email} (UID: ${user.uid})`);
        adminCount++;
      }
    }

    if (result.pageToken) {
      await listAllUsers(result.pageToken);
    }
  };

  await listAllUsers();

  console.log(`\nTotal admins: ${adminCount}`);
}

/**
 * 指定したメールアドレスのユーザーから管理者権限を削除
 */
async function removeAdminClaim(email: string): Promise<void> {
  try {
    const user = await admin.auth().getUserByEmail(email);

    const currentClaims = user.customClaims || {};
    delete currentClaims.admin;
    delete currentClaims.allowedEditor;

    await admin.auth().setCustomUserClaims(user.uid, currentClaims);

    console.log(`✅ Admin privileges removed from: ${email}`);
  } catch (error: any) {
    console.error(`❌ Error removing admin claim for ${email}:`, error.message);
  }
}

// コマンドライン引数を処理
const command = process.argv[2];

switch (command) {
  case 'setup':
    setupAdmins().catch(console.error).finally(() => process.exit(0));
    break;
  case 'list':
    listAdmins().catch(console.error).finally(() => process.exit(0));
    break;
  case 'remove':
    const emailToRemove = process.argv[3];
    if (!emailToRemove) {
      console.error('❌ Please provide an email address to remove');
      process.exit(1);
    }
    removeAdminClaim(emailToRemove).catch(console.error).finally(() => process.exit(0));
    break;
  default:
    console.log('Usage:');
    console.log('  npm run admin:setup    - Setup admin privileges from .env.local');
    console.log('  npm run admin:list     - List all admin users');
    console.log('  npm run admin:remove <email> - Remove admin privileges from a user');
    process.exit(0);
}