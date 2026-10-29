/**
 * @jest-environment node
 */
/**
 * Tests for scripts/vercel-ignore-build.sh (frontend の Vercel の Ignored Build Step)
 *
 * Layer 戦略:
 *   - 一時ディレクトリに bare repo (GitHub 役) と作業用 repo を作り、Vercel と同じ浅い clone
 *     (`git clone --depth=10`) の apps/frontend でスクリプトを実行して、終了コードと理由の行を検証する
 *   - 終了コードは Vercel の規約で 0 = ビルドしない / 1 = ビルドする
 *   - 浅い clone に無い commit は VERCEL_IGNORE_BUILD_REMOTE (= bare repo) から取得させる。
 *     GitHub と同じく SHA を指定した取得を許すため、bare repo で uploadpack.allowAnySHA1InWant を有効にする
 *   - git の設定・hook・署名はテストを動かす人の環境を拾わないよう、env を一から組む
 *
 * 検証項目:
 *   1. Production は常にビルドする
 *   2. Preview は frontend の入力 (apps/frontend / 記事の MDX / shared / ルートの依存の定義) が
 *      変わった時だけビルドする
 *   3. 比べる commit: 前回の成功デプロイ。初回は main の先頭。浅い clone に無ければ取得する
 *   4. 判定できない時 (取得できない / 存在しない / git の外 / 前回と同じ commit) はビルドする
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

const SCRIPT = join(__dirname, '../../../../scripts/vercel-ignore-build.sh');

// 初期状態のファイル。キーはリポジトリのルートからのパス
const INITIAL_FILES: Record<string, string> = {
  'apps/frontend/vercel.json': '{}\n',
  'apps/frontend/app/page.tsx': 'export default function Page() {}\n',
  'apps/frontend/lib/mdx/article-index.json': '{"articles":[]}\n',
  'apps/ai-writer/lib/pipeline.ts': 'export const v = 1;\n',
  'apps/ai-writer/content/collabo-cafe/a.mdx': '# a\n',
  'apps/ai-writer/package.json': '{"name":"ai-writer"}\n',
  'apps/docs/page.mdx': '# docs\n',
  'docs/readme.md': '# readme\n',
  '.github/workflows/ci.yml': 'name: CI\n',
  'shared/schemas/index.ts': 'export {};\n',
  'package.json': '{"name":"revolution"}\n',
  'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
  'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n",
  'turbo.json': '{}\n',
  'scripts/vercel-ignore-build.sh': '# fixture\n',
};

let root: string;
let bare: string;
let work: string;
let cloneCount = 0;

function baseEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: root,
    LANG: 'C.UTF-8',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CEILING_DIRECTORIES: root,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };
}

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, env: baseEnv(), encoding: 'utf-8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  }
  return r.stdout.trim();
}

/** ファイルを書き換えて commit し、SHA を返す。値が null のファイルは削除する */
function commit(files: Record<string, string | null>, message = 'change'): string {
  for (const [path, content] of Object.entries(files)) {
    const abs = join(work, path);
    if (content === null) {
      rmSync(abs);
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
  }
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', message);
  return git(work, 'rev-parse', 'HEAD');
}

function push(branch: string): void {
  git(work, 'push', '-q', '-f', 'origin', `HEAD:refs/heads/${branch}`);
}

interface RunOptions {
  env?: string;
  previousSha?: string;
  remote?: string;
}

/** Vercel と同じく branch を depth 10 で clone し、apps/frontend でスクリプトを実行する */
function runIgnore(branch: string, opts: RunOptions = {}): { status: number | null; stdout: string } {
  const clone = join(root, `clone-${cloneCount++}`);
  git(root, 'clone', '-q', '--depth=10', '--branch', branch, `file://${bare}`, clone);
  return runScriptIn(join(clone, 'apps/frontend'), opts);
}

function runScriptIn(cwd: string, opts: RunOptions): { status: number | null; stdout: string } {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv(),
    VERCEL_ENV: opts.env ?? 'preview',
    VERCEL_IGNORE_BUILD_REMOTE: opts.remote ?? `file://${bare}`,
  };
  if (opts.previousSha !== undefined) env.VERCEL_GIT_PREVIOUS_SHA = opts.previousSha;
  const r = spawnSync('bash', [SCRIPT], { cwd, env, encoding: 'utf-8' });
  return { status: r.status, stdout: r.stdout };
}

const BUILD = 1;
const SKIP = 0;

beforeEach(() => {
  // macOS の tmpdir は symlink (/var → /private/var)。git が返すパスと揃えるため実体パスにする
  root = realpathSync(mkdtempSync(join(tmpdir(), 'vercel-ignore-build-')));
  bare = join(root, 'origin.git');
  work = join(root, 'work');
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  git(bare, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  git(root, 'init', '-q', '-b', 'main', work);
  git(work, 'remote', 'add', 'origin', bare);
  commit(INITIAL_FILES, 'initial');
  push('main');
  git(work, 'checkout', '-q', '-b', 'feature');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('vercel-ignore-build.sh', () => {
  describe('Production', () => {
    it('frontend に関係ない変更でもビルドする', () => {
      const prev = git(work, 'rev-parse', 'HEAD');
      commit({ 'docs/readme.md': '# changed\n' });
      push('feature');
      const r = runIgnore('feature', { env: 'production', previousSha: prev });
      expect(r.status).toBe(BUILD);
      expect(r.stdout).toContain('Production は常にビルドする');
    });
  });

  describe('Preview: 前回の成功デプロイと比べる', () => {
    it.each([
      ['ai-writer の lib', { 'apps/ai-writer/lib/pipeline.ts': 'export const v = 2;\n' }],
      ['ai-writer の package.json (ルートの package.json ではない)', { 'apps/ai-writer/package.json': '{"name":"x"}\n' }],
      [
        'docs / apps/docs / .github',
        {
          'docs/readme.md': '# changed\n',
          'apps/docs/page.mdx': '# changed\n',
          '.github/workflows/ci.yml': 'name: CI2\n',
        },
      ],
    ])('%s だけの変更はビルドしない', (_label, files) => {
      const prev = git(work, 'rev-parse', 'HEAD');
      commit(files);
      push('feature');
      const r = runIgnore('feature', { previousSha: prev });
      expect(r.status).toBe(SKIP);
      expect(r.stdout).toContain('前回の成功デプロイ');
    });

    it.each([
      ['記事の MDX', 'apps/ai-writer/content/collabo-cafe/a.mdx'],
      ['shared', 'shared/schemas/index.ts'],
      ['pnpm-lock.yaml', 'pnpm-lock.yaml'],
      ['ルートの package.json', 'package.json'],
      ['apps/frontend/vercel.json', 'apps/frontend/vercel.json'],
      ['このスクリプト自身', 'scripts/vercel-ignore-build.sh'],
    ])('%s の変更はビルドし、変わったファイルを出す', (_label, path) => {
      const prev = git(work, 'rev-parse', 'HEAD');
      commit({ [path]: 'changed\n' });
      push('feature');
      const r = runIgnore('feature', { previousSha: prev });
      expect(r.status).toBe(BUILD);
      expect(r.stdout).toContain(path);
    });

    it('apps/frontend の外へ移したファイルがあればビルドする', () => {
      const prev = git(work, 'rev-parse', 'HEAD');
      git(work, 'mv', 'apps/frontend/app/page.tsx', 'apps/page.tsx');
      git(work, 'commit', '-q', '-m', 'move');
      push('feature');
      const r = runIgnore('feature', { previousSha: prev });
      expect(r.status).toBe(BUILD);
    });

    it('前回の成功デプロイが浅い clone の外 (12 commit 前) でも、取得して比べる', () => {
      const prev = git(work, 'rev-parse', 'HEAD');
      for (let i = 0; i < 12; i++) {
        commit({ 'apps/ai-writer/lib/pipeline.ts': `export const v = ${i + 10};\n` });
      }
      push('feature');
      const r = runIgnore('feature', { previousSha: prev });
      expect(r.status).toBe(SKIP);
    });

    it('rebase で前回の commit が祖先でなくなっても、取得して比べる (frontend は変わらない)', () => {
      const prev = commit({ 'apps/ai-writer/lib/pipeline.ts': 'export const v = 3;\n' });
      push('feature');
      git(work, 'reset', '-q', '--hard', 'main');
      commit({ 'apps/ai-writer/lib/pipeline.ts': 'export const v = 4;\n' });
      push('feature');
      const r = runIgnore('feature', { previousSha: prev });
      expect(r.status).toBe(SKIP);
    });

    it('rebase 後に lockfile も変わっていればビルドする', () => {
      const prev = commit({ 'apps/ai-writer/lib/pipeline.ts': 'export const v = 3;\n' });
      push('feature');
      git(work, 'reset', '-q', '--hard', 'main');
      commit({ 'apps/ai-writer/lib/pipeline.ts': 'export const v = 4;\n', 'pnpm-lock.yaml': 'changed\n' });
      push('feature');
      const r = runIgnore('feature', { previousSha: prev });
      expect(r.status).toBe(BUILD);
    });
  });

  describe('Preview: branch の初回デプロイは main の先頭と比べる', () => {
    it('frontend の入力が main と同じならビルドしない', () => {
      commit({ 'apps/ai-writer/lib/pipeline.ts': 'export const v = 5;\n' });
      push('feature');
      const r = runIgnore('feature');
      expect(r.status).toBe(SKIP);
      expect(r.stdout).toContain('main の先頭');
    });

    it('frontend の入力を変えていればビルドする', () => {
      commit({ 'apps/frontend/app/page.tsx': 'export default function Page2() {}\n' });
      push('feature');
      const r = runIgnore('feature');
      expect(r.status).toBe(BUILD);
    });

    it('main を取得できなければビルドする', () => {
      commit({ 'apps/ai-writer/lib/pipeline.ts': 'export const v = 6;\n' });
      push('feature');
      const r = runIgnore('feature', { remote: `file://${join(root, 'missing.git')}` });
      expect(r.status).toBe(BUILD);
      expect(r.stdout).toContain('main を取得できない');
    });
  });

  describe('判定できない時はビルドする', () => {
    it('前回と同じ commit (手動の Redeploy)', () => {
      commit({ 'apps/ai-writer/lib/pipeline.ts': 'export const v = 7;\n' });
      push('feature');
      const head = git(work, 'rev-parse', 'HEAD');
      const r = runIgnore('feature', { previousSha: head });
      expect(r.status).toBe(BUILD);
      expect(r.stdout).toContain('前回と同じ commit');
    });

    it('前回の commit がどこにも存在しない', () => {
      commit({ 'apps/ai-writer/lib/pipeline.ts': 'export const v = 8;\n' });
      push('feature');
      const r = runIgnore('feature', { previousSha: 'f'.repeat(40) });
      expect(r.status).toBe(BUILD);
    });

    it('git の作業ツリーの外で実行された', () => {
      const outside = join(root, 'outside');
      mkdirSync(outside);
      const r = runScriptIn(outside, { previousSha: 'f'.repeat(40) });
      expect(r.status).toBe(BUILD);
      expect(r.stdout).toContain('git の作業ツリーではない');
    });
  });
});
