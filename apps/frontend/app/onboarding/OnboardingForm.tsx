'use client';

/**
 * onboarding フォーム (Crescendolls 会員機能 / M2)
 *
 * 表示名 + username (unique・3-24・^[a-zA-Z0-9_]+$) を入力。completeOnboarding
 * (Server Action) で profiles update + JWT claims 反映 (案B)。
 * username 重複 (23505) / 形式エラーをフィールド別に表示する。
 *
 * 完了後は router で /mypage へ。middleware が JWT claims を再評価し、以降の
 * /onboarding 再訪は /mypage に弾く。
 */

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import {
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
} from '@revolution/schemas/profile';

import {
  checkUsernameAvailability,
  completeOnboarding,
  type UsernameAvailability,
} from '@/actions/profile';

/** username 可用性チェックの debounce 待ち時間 (ms)。 */
const USERNAME_DEBOUNCE_MS = 400;

/**
 * username 可用性の表示状態。
 * - idle    : 未入力 / 短すぎて未チェック
 * - checking: debounce 後に問い合わせ中
 * - 以降は checkUsernameAvailability の status をそのまま反映。
 */
type UsernameStatus = 'idle' | 'checking' | UsernameAvailability['status'];

export function OnboardingForm({
  defaultDisplayName = '',
}: {
  defaultDisplayName?: string;
}) {
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // username リアルタイム可用性 (M4 補助表示)。最終判定は submit 時の 23505。
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  // debounce タイマーと「最後の問い合わせ」識別子。古い応答を捨て競合 (レース) を防ぐ。
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  // アンマウント時に保留中の debounce タイマーを破棄する。
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  // 入力起点 (onChange) で debounce して可用性をチェックする。
  // effect 内の同期 setState (cascading render) を避けるため、debounce 管理は
  // ユーザー操作ハンドラ側に置く (react-hooks/set-state-in-effect 準拠)。
  const handleUsernameChange = useCallback((raw: string) => {
    setUsername(raw);
    setUsernameError(null);

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const value = raw.trim();

    if (value === '') {
      setUsernameStatus('idle');
      setAvailabilityError(null);
      return;
    }

    setUsernameStatus('checking');
    setAvailabilityError(null);

    const seq = ++requestSeq.current;
    debounceTimer.current = setTimeout(() => {
      checkUsernameAvailability(value)
        .then((result) => {
          // 後続入力で seq が進んでいたら古い応答なので捨てる。
          if (seq !== requestSeq.current) return;
          setUsernameStatus(result.status);
          setAvailabilityError(result.status === 'invalid' ? result.error : null);
        })
        .catch(() => {
          if (seq !== requestSeq.current) return;
          // 取得失敗は補助表示の不能扱い (submit の 23505 に委ねる)。
          setUsernameStatus('unknown');
          setAvailabilityError(null);
        });
    }, USERNAME_DEBOUNCE_MS);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameError(null);
    setDisplayNameError(null);
    setGeneralError(null);

    startTransition(async () => {
      const result = await completeOnboarding({ username, displayName });
      if (result.ok) {
        // 案B: completeOnboarding が updateUser で新 JWT (onboarded:true) を cookie に
        // 書き込む。soft navigation (router.replace) だと middleware が更新前の JWT を
        // 読み /onboarding に弾き返すことがあるため、フルナビゲーションで最新 cookie を
        // middleware に確実に渡す。middleware が onboarded を見て /mypage を通す。
        window.location.assign('/mypage');
        return;
      }
      if (result.field === 'username') setUsernameError(result.error);
      else if (result.field === 'displayName') setDisplayNameError(result.error);
      else setGeneralError(result.error);
    });
  };

  return (
    <div className="w-full max-w-md">
      <h1 className="font-display text-3xl text-ink-strong md:text-4xl">
        プロフィールを設定
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-body">
        あと少しで完了です。表示名とユーザー名 (ID) を決めましょう。あとから変更できます。
      </p>

      {generalError && (
        <p
          role="alert"
          className="mt-5 border-l-[3px] border-accent-yellow-deep bg-bg-tinted px-4 py-3 text-sm text-ink-strong"
        >
          {generalError}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-5" noValidate>
        <label className="flex flex-col gap-2">
          <span className="font-display text-sm tracking-wide text-ink-strong">
            表示名
          </span>
          <input
            type="text"
            name="displayName"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="例: あにめ太郎"
            aria-invalid={!!displayNameError}
            className="min-h-11 rounded-sm border border-[var(--line-strong)] bg-bg-elevated px-4 py-2 text-base text-ink-strong outline-none focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-500"
          />
          {displayNameError && (
            <span role="alert" className="text-xs text-accent-yellow-deep">
              {displayNameError}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-display text-sm tracking-wide text-ink-strong">
            ユーザー名 (ID)
          </span>
          <input
            type="text"
            name="username"
            required
            value={username}
            onChange={(e) => handleUsernameChange(e.target.value)}
            placeholder="例: anime_taro"
            minLength={USERNAME_MIN_LENGTH}
            maxLength={USERNAME_MAX_LENGTH}
            aria-invalid={!!usernameError || usernameStatus === 'taken' || usernameStatus === 'invalid'}
            aria-describedby="username-help"
            className="font-numeric min-h-11 rounded-sm border border-[var(--line-strong)] bg-bg-elevated px-4 py-2 text-base text-ink-strong outline-none focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-500"
          />
          <span id="username-help" className="text-xs text-ink-muted">
            半角英数字とアンダースコア (_) のみ、{USERNAME_MIN_LENGTH}〜
            {USERNAME_MAX_LENGTH} 文字。
          </span>
          {/*
            リアルタイム可用性 (補助表示)。submit 由来の usernameError (23505) があるときは
            そちらを優先表示し、二重表示を避ける。最終判定は submit 時に確定する。
          */}
          {!usernameError && usernameStatus === 'checking' && (
            <span role="status" className="text-xs text-ink-muted">
              確認中…
            </span>
          )}
          {!usernameError && usernameStatus === 'available' && (
            <span role="status" className="text-xs text-primary-700">
              ✓ 使えます
            </span>
          )}
          {!usernameError && usernameStatus === 'taken' && (
            <span role="alert" className="text-xs text-accent-yellow-deep">
              ✗ 既に使われています
            </span>
          )}
          {!usernameError && usernameStatus === 'invalid' && availabilityError && (
            <span role="alert" className="text-xs text-accent-yellow-deep">
              {availabilityError}
            </span>
          )}
          {usernameError && (
            <span role="alert" className="text-xs text-accent-yellow-deep">
              {usernameError}
            </span>
          )}
        </label>

        <button
          type="submit"
          disabled={isPending}
          className="min-h-11 bg-primary-strong px-6 py-3 font-display tracking-wide text-white transition-colors hover:bg-primary-strong-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {isPending ? '保存中…' : 'はじめる'}
        </button>
      </form>
    </div>
  );
}
