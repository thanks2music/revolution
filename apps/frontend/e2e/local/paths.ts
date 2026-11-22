import path from 'node:path';

/**
 * setup が書き、member のテストが読み、teardown が消すファイルの置き場所。
 * `.auth/` は gitignore 済み (cookie とテスト会員の ID が入るため)。
 */
const AUTH_DIR = path.join(__dirname, '.auth');

/** 会員としてログインした状態 (Playwright の storageState) */
export const MEMBER_STATE_PATH = path.join(AUTH_DIR, 'member.json');

/** setup が作った会員の ID。teardown が消すのに使う */
export const MEMBER_RECORD_PATH = path.join(AUTH_DIR, 'member-record.json');
