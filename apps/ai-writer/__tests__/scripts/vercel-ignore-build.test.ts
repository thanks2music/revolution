/**
 * @jest-environment node
 */
/**
 * Tests for scripts/vercel-ignore-build.sh (frontend と docs の Vercel の Ignored Build Step)
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
 *   1. Production 以外 (Preview / VERCEL_ENV が無い) は常にビルドする (Preview は GitHub Actions が
 *      要る時だけ作っているため)
 *   2. frontend の Production は常にビルドする (templates の Deploy Hook のため)。docs の Production は
 *      docs の入力 (apps/docs / docs/ 直下の *.md / docs/meta.json / shared / 依存) が変わった時だけビルドする
 *   3. 比べる commit: 前回の成功デプロイ。浅い clone に無ければ取得する。分からなければビルドする
 *   4. 判定できない時 (取得できない / 存在しない / git の外 / 前回と同じ commit / アプリの指定が無い) はビルドする
 *   5. 必須パスの一覧が、frontend の実物の workspace 依存を覆っている。--paths で一覧を出せる
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
  'apps/docs/page.mdx': '# docs\n',
  'apps/docs/vercel.json': '{}\n',
  'docs/readme.md': '# readme\n',
  'docs/meta.json': '{}\n',
  'docs/archive/old.md': '# old\n',
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
  /** 判定するアプリ (スクリプトの引数)。既定は docs、null なら渡さない */
  app?: string | null;
  /** VERCEL_ENV。既定は production、null なら設定しない */
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
  if (opts.env !== null) env.VERCEL_ENV = opts.env ?? 'production';
  if (opts.previousSha !== undefined) env.VERCEL_GIT_PREVIOUS_SHA = opts.previousSha;
  const args = opts.app === null ? [] : [opts.app ?? 'docs'];
  const r = spawnSync('bash', [SCRIPT, ...args], { cwd, env, encoding: 'utf-8' });
  return { status: r.status, stdout: r.stdout };
}

/** Vercel と同じく branch を depth 10 で clone し、apps/<app> でスクリプトを実行する */
function runIgnore(opts: RunOptions = {}): {
  status: number | null;
  stdout: string;
  clone: string;
} {
  const clone = join(root, 'clone');
  git(root, 'clone', '-q', '--depth=10', '--branch', 'feature', `file://${work}`, clone);
  // docs 以外の指定も、実在するディレクトリで動かす
  const dir = opts.app === undefined || opts.app === 'docs' ? 'apps/docs' : 'apps/frontend';
  return { ...runScriptIn(join(clone, dir), opts), clone };
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
  describe('Production 以外は常にビルドする', () => {
    it.each([
      ['preview', 'Preview は GitHub Actions が要る時だけ作っている'],
      [null, 'Production ではない'],
    ])('VERCEL_ENV=%s なら、入力に関係ない変更でもビルドする', (env, reason) => {
      const r = runAfter({ 'docs/readme.md': '# changed\n' }, { env });
      expect(r.status).toBe(BUILD);
      expect(r.stdout).toContain(reason);
    });
  });

  describe('frontend は Ignored Build Step を使わない (本番は毎回ビルドする)', () => {
    it('apps/frontend/vercel.json に ignoreCommand が無い (templates の Deploy Hook を本番に届けるため)', () => {
      const config = JSON.parse(readFileSync(join(REPO_ROOT, 'apps/frontend/vercel.json'), 'utf-8'));
      expect(config.ignoreCommand).toBeUndefined();
      expect(config.git.deploymentEnabled).toEqual({ '**': false, main: true });
    });
  });

  describe('比べ方 (docs の Production で確かめる)', () => {
    it('apps/docs の外へ移したファイルがあればビルドする', () => {
      const prev = head();
      git(work, 'mv', 'apps/docs/page.mdx', 'apps/page.mdx');
      git(work, 'commit', '-q', '-m', 'move');
      const r = runIgnore({ previousSha: prev });
      expect(r.status).toBe(BUILD);
    });

    it('前回の成功デプロイが浅い clone の外 (12 commit 前) でも、取得して比べる。checkout の浅い履歴は短くならない', () => {
      const prev = head();
      commit(IRRELEVANT);
      emptyCommits(11);
      const r = runIgnore({ previousSha: prev });
      expect(r.status).toBe(SKIP);
      // 取得は使い捨ての repo に行う (ビルドが使う checkout の履歴を変えない)
      expect(git(r.clone, 'rev-list', '--count', 'HEAD')).toBe('10');
    });

    it.each([
      ['docs は変わらない', {}, SKIP],
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

  describe('docs の Production: 前回の成功デプロイと比べる', () => {
    it.each([
      ['frontend', { 'apps/frontend/app/page.tsx': 'export default function Page2() {}\n' }],
      ['記事の MDX', { 'apps/ai-writer/content/collabo-cafe/a.mdx': '# changed\n' }],
      ['docs/ の下の階層 (archive)', { 'docs/archive/old.md': '# changed\n' }],
    ])('%s だけの変更はビルドしない', (_label, files) => {
      const r = runAfter(files, {});
      expect(r.status).toBe(SKIP);
      expect(r.stdout).toContain('docs の入力は');
    });

    it.each([
      ['docs/ 直下の文書', 'docs/readme.md'],
      ['docs/meta.json', 'docs/meta.json'],
      ['apps/docs', 'apps/docs/page.mdx'],
      ['shared', 'shared/schemas/index.ts'],
      ['pnpm-lock.yaml', 'pnpm-lock.yaml'],
    ])('%s の変更はビルドする', (_label, path) => {
      const r = runAfter({ [path]: 'changed\n' }, {});
      expect(r.status).toBe(BUILD);
      expect(r.stdout).toContain(path);
    });
  });

  describe('判定できない時はビルドする', () => {
    it('前回の成功デプロイが分からない (初めての本番)', () => {
      commit(IRRELEVANT);
      const r = runIgnore({});
      expect(r.status).toBe(BUILD);
      expect(r.stdout).toContain('前回の成功デプロイが分からない');
    });

    it.each([[null], ['unknown'], ['frontend']])('アプリの指定が docs ではない (%s)', app => {
      const r = runAfter(IRRELEVANT, { app });
      expect(r.status).toBe(BUILD);
      expect(r.stdout).toContain('アプリの指定が docs ではない');
    });

    it('前回の成功デプロイを取得できない', () => {
      const prev = head();
      commit(IRRELEVANT);
      emptyCommits(11);
      const r = runIgnore({ previousSha: prev, origin: join(root, 'missing') });
      expect(r.status).toBe(BUILD);
      expect(r.stdout).toContain('を取得できない');
    });

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
  function mustBuildPaths(app: string): string[] {
    const r = spawnSync('bash', [SCRIPT, '--paths', app], { encoding: 'utf-8' });
    if (r.status !== 0) throw new Error(`--paths ${app} failed: ${r.stderr}`);
    return r.stdout.split('\n').filter(Boolean);
  }

  it('frontend の一覧は、記事の MDX・shared・依存の定義・判定そのものを含む (Preview の判定が使う)', () => {
    expect(mustBuildPaths('frontend')).toEqual(
      expect.arrayContaining([
        'apps/frontend',
        'apps/ai-writer/content',
        'shared',
        'package.json',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'turbo.json',
      ])
    );
    // 判定のスクリプトは frontend のビルドに効かない (frontend の Preview を作り直す理由にならない)
    expect(mustBuildPaths('frontend')).not.toContain('scripts/vercel-ignore-build.sh');
  });

  it('--changed は、入力が変わったかを終了コードで返し、変わったファイルを出す (Preview の判定が使う)', () => {
    const changed = (app: string, from: string, to = 'HEAD') =>
      spawnSync('bash', [SCRIPT, '--changed', app, from, to], { cwd: work, env: gitEnv(), encoding: 'utf-8' });
    const base = head();
    commit({ 'apps/frontend/app/page.tsx': 'export default function Page2() {}\n' });

    expect(changed('frontend', base)).toMatchObject({ status: 1, stdout: 'apps/frontend/app/page.tsx\n' });
    expect(changed('docs', base).status).toBe(0);
    expect(changed('unknown', base).status).toBe(2);
    expect(changed('docs', 'f'.repeat(40)).status).toBe(2);
  });

  it('--paths はアプリごとの一覧を出し、知らないアプリは失敗する', () => {
    expect(mustBuildPaths('frontend')).toContain('apps/frontend');
    expect(mustBuildPaths('docs')).toEqual(
      expect.arrayContaining(['apps/docs', ':(glob)docs/*.md', 'docs/meta.json'])
    );
    expect(spawnSync('bash', [SCRIPT, '--paths', 'unknown'], { encoding: 'utf-8' }).status).toBe(2);
  });

  it('frontend が依存する workspace パッケージは、すべて必須パスに覆われている', () => {
    const readJson = (path: string) => JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf-8'));
    const frontend = readJson('apps/frontend/package.json');
    const workspaceDeps = Object.entries({ ...frontend.dependencies, ...frontend.devDependencies })
      .filter(([, version]) => String(version).startsWith('workspace:'))
      .map(([name]) => name);
    // pnpm-workspace.yaml の packages (`- 'apps/*'` の形) から、パッケージ名 → ディレクトリを引く
    const globs = [
      ...readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf-8').matchAll(
        /^\s*-\s*'([^']+)\/\*'/gm
      ),
    ];
    const dirByName = new Map<string, string>();
    for (const [, parent] of globs) {
      for (const child of readdirSync(join(REPO_ROOT, parent))) {
        const dir = `${parent}/${child}`;
        if (existsSync(join(REPO_ROOT, dir, 'package.json')))
          dirByName.set(readJson(`${dir}/package.json`).name, dir);
      }
    }
    const paths = mustBuildPaths('frontend');
    const covered = (dir: string) => paths.some(p => dir === p || dir.startsWith(`${p}/`));

    expect(workspaceDeps.length).toBeGreaterThan(0);
    for (const name of workspaceDeps) {
      const dir = dirByName.get(name);
      expect({ name, dir, covered: dir !== undefined && covered(dir) }).toEqual({
        name,
        dir,
        covered: true,
      });
    }
  });
});
