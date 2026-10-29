/**
 * @jest-environment node
 */
/**
 * Tests for scripts/vercel-ignore-build.sh (frontend の Vercel の Ignored Build Step)
 *
 * Layer 戦略:
 *   - 一時ディレクトリの作業用 repo (GitHub 役も兼ねる) から、Vercel と同じ浅い clone
 *     (`git clone --depth=10`) を作り、その apps/frontend でスクリプトを実行して、終了コードと理由の行を検証する
 *   - 終了コードは Vercel の規約で 0 = ビルドしない / 1 = ビルドする
 *   - スクリプトが組み立てる GitHub の URL は、git の insteadOf で作業用 repo へ向け替える
 *     (本物の URL の組み立てを通しつつ、ネットワークには出ない)。GitHub と同じく、SHA を指定した取得と
 *     blob を除いた取得を許す (uploadpack.allowAnySHA1InWant / allowFilter)
 *   - git の設定・hook・署名はテストを動かす人の環境を拾わないよう、env を一から組む
 *   - 初期状態の repo は beforeAll で 1 回だけ作り、テストごとにコピーする
 *
 * 検証項目:
 *   1. Preview 以外 (Production / VERCEL_ENV が無い) は常にビルドする
 *   2. Preview は frontend の入力 (apps/frontend / 記事の MDX / shared / ルートの依存の定義) が
 *      変わった時だけビルドする
 *   3. 比べる commit: 前回の成功デプロイ。初回は main の先頭。浅い clone に無ければ取得する
 *   4. 判定できない時 (取得できない / 存在しない / git の外 / 前回と同じ commit) はビルドする
 *   5. 必須パスの一覧が、frontend の実物の workspace 依存を覆っている
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { spawnSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

const REPO_ROOT = join(__dirname, '../../../..');
const SCRIPT = join(REPO_ROOT, 'scripts/vercel-ignore-build.sh');
const GITHUB_URL = 'https://github.com/test-owner/test-repo.git';

// 初期状態のファイル。キーはリポジトリのルートからのパス
const INITIAL_FILES: Record<string, string> = {
  'apps/frontend/vercel.json': '{}\n',
  'apps/frontend/app/page.tsx': 'export default function Page() {}\n',
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
// frontend の入力に当たらない変更
const IRRELEVANT = { 'apps/ai-writer/lib/pipeline.ts': 'export const v = 2;\n' };

const TMP = realpathSync(tmpdir()); // macOS の tmpdir は symlink (/var → /private/var)
let template: string;
let root: string;
let work: string;

function gitEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: TMP,
    LANG: 'C.UTF-8',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CEILING_DIRECTORIES: TMP,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };
}

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, env: gitEnv(), encoding: 'utf-8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  }
  return r.stdout.trim();
}

const head = (): string => git(work, 'rev-parse', 'HEAD');

/** ファイルを書き換えて commit する。値が null のファイルは削除する */
function commit(files: Record<string, string | null>, repo = work): void {
  for (const [path, content] of Object.entries(files)) {
    const abs = join(repo, path);
    if (content === null) {
      rmSync(abs);
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'change');
}

/** 履歴の深さだけを稼ぐ空の commit */
function emptyCommits(n: number): void {
  for (let i = 0; i < n; i++) git(work, 'commit', '-q', '--allow-empty', '-m', `empty ${i}`);
}

interface RunOptions {
  /** VERCEL_ENV。既定は preview、null なら設定しない */
  env?: string | null;
  previousSha?: string;
  /** GitHub の URL の向け先。既定は作業用 repo */
  origin?: string;
}

function runScriptIn(cwd: string, opts: RunOptions): { status: number | null; stdout: string } {
  const env: NodeJS.ProcessEnv = {
    ...gitEnv(),
    VERCEL_GIT_REPO_OWNER: 'test-owner',
    VERCEL_GIT_REPO_SLUG: 'test-repo',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `url.file://${opts.origin ?? work}.insteadOf`,
    GIT_CONFIG_VALUE_0: GITHUB_URL,
  };
  if (opts.env !== null) env.VERCEL_ENV = opts.env ?? 'preview';
  if (opts.previousSha !== undefined) env.VERCEL_GIT_PREVIOUS_SHA = opts.previousSha;
  const r = spawnSync('bash', [SCRIPT], { cwd, env, encoding: 'utf-8' });
  return { status: r.status, stdout: r.stdout };
}

/** Vercel と同じく feature branch を depth 10 で clone し、apps/frontend でスクリプトを実行する */
function runIgnore(opts: RunOptions = {}): { status: number | null; stdout: string; clone: string } {
  const clone = join(root, 'clone');
  git(root, 'clone', '-q', '--depth=10', '--branch', 'feature', `file://${work}`, clone);
  return { ...runScriptIn(join(clone, 'apps/frontend'), opts), clone };
}

/** 今の HEAD を前回の成功デプロイとして、files を commit してから判定する */
function runAfter(files: Record<string, string | null>, opts: RunOptions = {}) {
  const prev = head();
  commit(files);
  return runIgnore({ previousSha: prev, ...opts });
}

const BUILD = 1;
const SKIP = 0;

beforeAll(() => {
  template = mkdtempSync(join(TMP, 'vercel-ignore-build-template-'));
  git(template, 'init', '-q', '-b', 'main');
  git(template, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  git(template, 'config', 'uploadpack.allowFilter', 'true');
  commit(INITIAL_FILES, template);
  git(template, 'checkout', '-q', '-b', 'feature');
});

afterAll(() => {
  rmSync(template, { recursive: true, force: true });
});

beforeEach(() => {
  root = mkdtempSync(join(TMP, 'vercel-ignore-build-'));
  work = join(root, 'work');
  cpSync(template, work, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('vercel-ignore-build.sh', () => {
  describe('Preview 以外は常にビルドする', () => {
    it.each([
      ['production', 'Production は常にビルドする'],
      [null, 'Preview ではない'],
    ])('VERCEL_ENV=%s なら、frontend に関係ない変更でもビルドする', (env, reason) => {
      const r = runAfter({ 'docs/readme.md': '# changed\n' }, { env });
      expect(r.status).toBe(BUILD);
      expect(r.stdout).toContain(reason);
    });
  });

  describe('Preview: 前回の成功デプロイと比べる', () => {
    it.each([
      ['ai-writer の lib', IRRELEVANT],
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
      const r = runAfter(files);
      expect(r.status).toBe(SKIP);
      expect(r.stdout).toContain('前回の成功デプロイ');
    });

    it.each([
      ['記事の MDX', 'apps/ai-writer/content/collabo-cafe/a.mdx'],
      ['記事の MDX の追加', 'apps/ai-writer/content/collabo-cafe/new.mdx'],
      ['shared', 'shared/schemas/index.ts'],
      ['pnpm-lock.yaml', 'pnpm-lock.yaml'],
      ['pnpm-workspace.yaml', 'pnpm-workspace.yaml'],
      ['ルートの package.json', 'package.json'],
      ['turbo.json', 'turbo.json'],
      ['.npmrc の追加', '.npmrc'],
      ['.pnpmfile.cjs の追加', '.pnpmfile.cjs'],
      ['patches の追加', 'patches/next.patch'],
      ['apps/frontend/vercel.json', 'apps/frontend/vercel.json'],
      ['このスクリプト自身', 'scripts/vercel-ignore-build.sh'],
    ])('%s の変更はビルドし、変わったファイルを出す', (_label, path) => {
      const r = runAfter({ [path]: 'changed\n' });
      expect(r.status).toBe(BUILD);
      expect(r.stdout).toContain(path);
    });

    it('apps/frontend の外へ移したファイルがあればビルドする', () => {
      const prev = head();
      git(work, 'mv', 'apps/frontend/app/page.tsx', 'apps/page.tsx');
      git(work, 'commit', '-q', '-m', 'move');
      const r = runIgnore({ previousSha: prev });
      expect(r.status).toBe(BUILD);
    });

    it('前回の成功デプロイが浅い clone の外 (12 commit 前) でも、取得して比べる', () => {
      const prev = head();
      commit(IRRELEVANT);
      emptyCommits(11);
      const r = runIgnore({ previousSha: prev });
      expect(r.status).toBe(SKIP);
    });

    it.each([
      ['frontend は変わらない', {}, SKIP],
      ['lockfile も変わる', { 'pnpm-lock.yaml': 'changed\n' }, BUILD],
    ])('rebase で前回の commit が祖先でなくなっても、取得して比べる (%s)', (_label, extra, expected) => {
      commit({ 'apps/ai-writer/lib/pipeline.ts': 'export const v = 3;\n' });
      const prev = head();
      git(work, 'reset', '-q', '--hard', 'main');
      commit({ 'apps/ai-writer/lib/pipeline.ts': 'export const v = 4;\n', ...extra });
      const r = runIgnore({ previousSha: prev });
      expect(r.status).toBe(expected);
    });
  });

  describe('Preview: branch の初回デプロイは main の先頭と比べる', () => {
    it('frontend の入力が main と同じならビルドしない', () => {
      commit(IRRELEVANT);
      const r = runIgnore();
      expect(r.status).toBe(SKIP);
      expect(r.stdout).toContain('main の先頭');
    });

    it('frontend の入力を変えていればビルドする', () => {
      commit({ 'apps/frontend/app/page.tsx': 'export default function Page2() {}\n' });
      const r = runIgnore();
      expect(r.status).toBe(BUILD);
    });

    it('main を取得しても、ビルドが使う checkout の浅い履歴は短くならない', () => {
      // main の先頭が clone の範囲 (depth 10) に入る形: main 5 commit + feature 5 commit
      git(work, 'checkout', '-q', 'main');
      emptyCommits(4);
      git(work, 'checkout', '-q', '-B', 'feature', 'main');
      commit(IRRELEVANT);
      emptyCommits(4);
      const r = runIgnore();
      expect(r.status).toBe(SKIP);
      expect(git(r.clone, 'rev-list', '--count', 'HEAD')).toBe('10');
    });

    it('main を取得できなければビルドする', () => {
      commit(IRRELEVANT);
      const r = runIgnore({ origin: join(root, 'missing') });
      expect(r.status).toBe(BUILD);
      expect(r.stdout).toContain('main を取得できない');
    });
  });

  describe('判定できない時はビルドする', () => {
    it('前回と同じ commit (手動の Redeploy)', () => {
      commit(IRRELEVANT);
      const r = runIgnore({ previousSha: head() });
      expect(r.status).toBe(BUILD);
      expect(r.stdout).toContain('前回と同じ commit');
    });

    it('前回の SHA が commit の SHA の形ではない (git のオプションとして読まれない)', () => {
      commit(IRRELEVANT);
      const r = runIgnore({ previousSha: '--upload-pack=touch-pwned' });
      expect(r.status).toBe(BUILD);
      expect(r.stdout).toContain('commit の SHA ではない');
    });

    it('前回の commit がどこにも存在しない', () => {
      commit(IRRELEVANT);
      const r = runIgnore({ previousSha: 'f'.repeat(40) });
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

describe('必須パスの一覧 (実物の repo と照合)', () => {
  function mustBuildPaths(): string[] {
    const body = readFileSync(SCRIPT, 'utf-8').match(/^MUST_BUILD_PATHS=\(\n([\s\S]*?)\n\)/m);
    if (!body) throw new Error('MUST_BUILD_PATHS が見つからない');
    return body[1]
      .split('\n')
      .map((line) => line.replace(/#.*/, '').trim())
      .filter(Boolean);
  }

  it('frontend が依存する workspace パッケージは、すべて必須パスに覆われている', () => {
    const readJson = (path: string) => JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf-8'));
    const frontend = readJson('apps/frontend/package.json');
    const workspaceDeps = Object.entries({ ...frontend.dependencies, ...frontend.devDependencies })
      .filter(([, version]) => String(version).startsWith('workspace:'))
      .map(([name]) => name);
    // pnpm-workspace.yaml の packages (`- 'apps/*'` の形) から、パッケージ名 → ディレクトリを引く
    const globs = [...readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf-8').matchAll(/^\s*-\s*'([^']+)\/\*'/gm)];
    const dirByName = new Map<string, string>();
    for (const [, parent] of globs) {
      for (const child of readdirSync(join(REPO_ROOT, parent))) {
        const dir = `${parent}/${child}`;
        if (existsSync(join(REPO_ROOT, dir, 'package.json'))) dirByName.set(readJson(`${dir}/package.json`).name, dir);
      }
    }
    const paths = mustBuildPaths();
    const covered = (dir: string) => paths.some((p) => dir === p || dir.startsWith(`${p}/`));

    expect(workspaceDeps.length).toBeGreaterThan(0);
    for (const name of workspaceDeps) {
      const dir = dirByName.get(name);
      expect({ name, dir, covered: dir !== undefined && covered(dir) }).toEqual({ name, dir, covered: true });
    }
  });
});
