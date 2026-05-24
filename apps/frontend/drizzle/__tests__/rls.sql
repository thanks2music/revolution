-- ============================================================================
-- Crescendolls 会員機能: RLS 否定テスト (★security critical / M1 DoD)
-- ============================================================================
--
-- 目的: 別ユーザーを `request.jwt.claims` で偽装し、本人以外がデータを操作できない
--       ことを SQL で実証する。`authenticated` ロール (rolbypassrls=f) に切り替えて
--       RLS を実際に効かせた状態で assert する。
--
-- 実行: 必ず ローカル `supabase start` の DB に対して実行する (remote 厳禁)。
--   /opt/homebrew/opt/libpq/bin/psql \
--     'postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
--     -v ON_ERROR_STOP=1 -f drizzle/__tests__/rls.sql
--
-- 期待結果:
--   - すべての NOTICE が "PASS: ..." を出力する。
--   - 末尾に "ALL RLS NEGATIVE TESTS PASSED" が出力される。
--   - ON_ERROR_STOP=1 のため、いずれかの assert (RAISE EXCEPTION) で即時失敗・非ゼロ終了。
--   - 他人行への update/delete は「RLS により 0 行ヒット (= 行が見えない)」で拒否される。
--     RLS は他人行を不可視にするため update/delete は権限エラーではなく 0 行更新になる
--     (これが期待挙動)。本人への付け替え (WITH CHECK 違反) は明示的にエラーになる。
--
-- 後始末: テスト用 auth.users は最後に削除し (cascade で profiles/favorites も消える)、
--         冪等に再実行できる。
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. 固定 UUID のテストユーザー 2 名を auth.users に作成
--    (handle_new_user トリガーが profiles を空作成することも同時に検証)
-- ---------------------------------------------------------------------------
-- 既存があれば cascade 削除して冪等化。
DELETE FROM auth.users WHERE id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);

-- auth.users への直接 insert (superuser=postgres で実行、RLS バイパス)。
-- full_name を raw_user_meta_data に入れ、handle_new_user の coalesce を検証する。
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com',
   '{"full_name": "Alice"}'::jsonb, 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com',
   '{}'::jsonb, 'authenticated', 'authenticated');

-- ---------------------------------------------------------------------------
-- 1. handle_new_user トリガー検証: profiles が空作成され、display_name が
--    coalesce(full_name,'') / username が NULL になっていること
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  alice_name text;
  bob_name text;
  alice_username text;
BEGIN
  SELECT display_name, username INTO alice_name, alice_username
    FROM public.profiles WHERE id = '11111111-1111-1111-1111-111111111111';
  SELECT display_name INTO bob_name
    FROM public.profiles WHERE id = '22222222-2222-2222-2222-222222222222';

  IF alice_name IS DISTINCT FROM 'Alice' THEN
    RAISE EXCEPTION 'FAIL: alice display_name expected "Alice" but got %', alice_name;
  END IF;
  IF alice_username IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: alice username expected NULL (onboarding 未完了) but got %', alice_username;
  END IF;
  -- full_name 無しの bob は coalesce で空文字
  IF bob_name IS DISTINCT FROM '' THEN
    RAISE EXCEPTION 'FAIL: bob display_name expected "" (coalesce) but got %', bob_name;
  END IF;
  RAISE NOTICE 'PASS: handle_new_user が profiles を空作成 (display_name=coalesce, username=NULL)';
END $$;

-- ---------------------------------------------------------------------------
-- 2. seed: 各ユーザーの profiles を onboarding 済みに更新 + favorites を作成
--    (superuser で seed。RLS 検証は後段で role 切り替えて行う)
-- ---------------------------------------------------------------------------
UPDATE public.profiles SET username = 'alice', display_name = 'Alice'
  WHERE id = '11111111-1111-1111-1111-111111111111';
UPDATE public.profiles SET username = 'bob', display_name = 'Bob'
  WHERE id = '22222222-2222-2222-2222-222222222222';

INSERT INTO public.favorites (user_id, target_type, target_key) VALUES
  ('11111111-1111-1111-1111-111111111111', 'article', 'collabo-cafe/alice-work/alice-post'),
  ('22222222-2222-2222-2222-222222222222', 'article', 'collabo-cafe/bob-work/bob-post');

-- ---------------------------------------------------------------------------
-- 3. Alice を偽装 (authenticated ロール + request.jwt.claims.sub = Alice)
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","email":"alice@example.com","role":"authenticated"}';

-- 3a. profiles SELECT: 本人 1 行のみ見える (Bob は不可視)
DO $$
DECLARE
  visible_count int;
  bob_visible int;
BEGIN
  SELECT count(*) INTO visible_count FROM public.profiles;
  SELECT count(*) INTO bob_visible FROM public.profiles
    WHERE id = '22222222-2222-2222-2222-222222222222';
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: Alice には profiles 1 行のみ見えるべきだが % 行見えた', visible_count;
  END IF;
  IF bob_visible <> 0 THEN
    RAISE EXCEPTION 'FAIL: Alice から Bob の profiles 行が見えてはならない (% 行)', bob_visible;
  END IF;
  RAISE NOTICE 'PASS: profiles SELECT は本人のみ (Bob 不可視)';
END $$;

-- 3b. favorites SELECT: 本人 1 行のみ見える (Bob は不可視)
DO $$
DECLARE
  visible_count int;
  bob_visible int;
BEGIN
  SELECT count(*) INTO visible_count FROM public.favorites;
  SELECT count(*) INTO bob_visible FROM public.favorites
    WHERE user_id = '22222222-2222-2222-2222-222222222222';
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: Alice には favorites 1 行のみ見えるべきだが % 行見えた', visible_count;
  END IF;
  IF bob_visible <> 0 THEN
    RAISE EXCEPTION 'FAIL: Alice から Bob の favorites 行が見えてはならない (% 行)', bob_visible;
  END IF;
  RAISE NOTICE 'PASS: favorites SELECT は本人のみ (Bob 不可視)';
END $$;

-- 3c. [否定] Alice が Bob の profiles を UPDATE しても 0 行 (RLS で不可視 = 更新不能)
DO $$
DECLARE
  affected int;
BEGIN
  UPDATE public.profiles SET display_name = 'HACKED'
    WHERE id = '22222222-2222-2222-2222-222222222222';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'FAIL: Alice が Bob の profiles を % 行更新できてしまった (RLS 違反)', affected;
  END IF;
  RAISE NOTICE 'PASS: Alice は Bob の profiles を UPDATE 不可 (0 行)';
END $$;

-- 3d. [否定] Alice が Bob の favorites を DELETE しても 0 行
DO $$
DECLARE
  affected int;
BEGIN
  DELETE FROM public.favorites
    WHERE user_id = '22222222-2222-2222-2222-222222222222';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'FAIL: Alice が Bob の favorites を % 行削除できてしまった (RLS 違反)', affected;
  END IF;
  RAISE NOTICE 'PASS: Alice は Bob の favorites を DELETE 不可 (0 行)';
END $$;

-- 3e. [否定] Alice が自分の profiles.id を Bob に付け替えようとすると WITH CHECK 違反でエラー
DO $$
DECLARE
  raised boolean := false;
BEGIN
  BEGIN
    UPDATE public.profiles SET id = '22222222-2222-2222-2222-222222222222'
      WHERE id = '11111111-1111-1111-1111-111111111111';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: Alice が自分の profiles.id を他人へ付け替えできてしまった (WITH CHECK 違反が出なかった)';
  END IF;
  RAISE NOTICE 'PASS: profiles.id の他人付け替えは WITH CHECK で拒否';
END $$;

-- 3f. [否定] Alice が Bob を user_id にした favorites を INSERT しようとすると WITH CHECK 違反
DO $$
DECLARE
  raised boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.favorites (user_id, target_type, target_key)
      VALUES ('22222222-2222-2222-2222-222222222222', 'article', 'collabo-cafe/x/forged');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: Alice が Bob 名義の favorites を INSERT できてしまった (WITH CHECK 違反が出なかった)';
  END IF;
  RAISE NOTICE 'PASS: favorites の他人 user_id INSERT は WITH CHECK で拒否';
END $$;

-- 3g. [肯定] Alice は自分の profiles を UPDATE できる
DO $$
DECLARE
  affected int;
BEGIN
  UPDATE public.profiles SET display_name = 'Alice Updated'
    WHERE id = '11111111-1111-1111-1111-111111111111';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'FAIL: Alice が自分の profiles を更新できるべきだが % 行', affected;
  END IF;
  RAISE NOTICE 'PASS: Alice は自分の profiles を UPDATE 可能';
END $$;

-- 3h. [肯定] Alice は自分の favorites を INSERT/DELETE できる
DO $$
DECLARE
  affected int;
BEGIN
  INSERT INTO public.favorites (user_id, target_type, target_key)
    VALUES ('11111111-1111-1111-1111-111111111111', 'article', 'collabo-cafe/alice-work/another');
  DELETE FROM public.favorites
    WHERE user_id = '11111111-1111-1111-1111-111111111111'
      AND target_key = 'collabo-cafe/alice-work/another';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'FAIL: Alice が自分の favorites を削除できるべきだが % 行', affected;
  END IF;
  RAISE NOTICE 'PASS: Alice は自分の favorites を INSERT/DELETE 可能';
END $$;

-- ロールを postgres へ戻す (後続の username 制約テスト + 後始末のため)
RESET ROLE;
RESET request.jwt.claims;

-- ---------------------------------------------------------------------------
-- 4. username 三段防御の DB レイヤ検証 (Layer2 CHECK + Layer3 lower() unique)
--    Layer1 zod は別途 Node 側で検証 (progress.md 参照)。
-- ---------------------------------------------------------------------------

-- 4a. [否定] 不正形式 username (記号入り) は CHECK で拒否
DO $$
DECLARE
  raised boolean := false;
BEGIN
  BEGIN
    UPDATE public.profiles SET username = 'bad!name'
      WHERE id = '11111111-1111-1111-1111-111111111111';
  EXCEPTION WHEN check_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: 不正形式 username "bad!name" が CHECK を通過してしまった';
  END IF;
  RAISE NOTICE 'PASS: 不正形式 username は DB CHECK で拒否';
END $$;

-- 4b. [否定] 短すぎる username (2 文字) は CHECK で拒否
DO $$
DECLARE
  raised boolean := false;
BEGIN
  BEGIN
    UPDATE public.profiles SET username = 'ab'
      WHERE id = '11111111-1111-1111-1111-111111111111';
  EXCEPTION WHEN check_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: 2 文字 username "ab" が CHECK を通過してしまった';
  END IF;
  RAISE NOTICE 'PASS: 短すぎる username は DB CHECK で拒否';
END $$;

-- 4c. [否定] case-insensitive 重複 (alice の大小違い "ALICE") は lower() unique で拒否
DO $$
DECLARE
  raised boolean := false;
BEGIN
  BEGIN
    -- bob を "ALICE" に変えようとする → lower('ALICE')=lower('alice') で衝突
    UPDATE public.profiles SET username = 'ALICE'
      WHERE id = '22222222-2222-2222-2222-222222222222';
  EXCEPTION WHEN unique_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'FAIL: case 違いの username "ALICE" が lower() unique を通過してしまった';
  END IF;
  RAISE NOTICE 'PASS: case-insensitive 重複 username は lower() unique index で拒否';
END $$;

-- ---------------------------------------------------------------------------
-- 5. 後始末 (cascade で profiles/favorites も削除。冪等再実行可能に)
-- ---------------------------------------------------------------------------
DELETE FROM auth.users WHERE id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);

DO $$
BEGIN
  RAISE NOTICE 'ALL RLS NEGATIVE TESTS PASSED';
END $$;

COMMIT;
