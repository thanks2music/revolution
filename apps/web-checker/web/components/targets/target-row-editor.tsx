'use client';

import { useState } from 'react';

import { useAuth } from '@/lib/auth/auth-context';
import { mapAuthError } from '@/lib/auth/auth-error';
import { validateTargetForm, type TargetFieldErrors } from '@/lib/schemas/target-form.schema';
import { TargetService } from '@/lib/services/target.service';
import { TargetFields } from '@/components/targets/target-fields';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { Target } from '@/types/target';

/**
 * 一覧の 1 件をその場で編集する。下書きはこのコンポーネントの state に閉じるので、
 * キャンセルは親がこれを外すだけで済む (値を戻す処理が要らない)。
 */
export function TargetRowEditor({
  target,
  onSaved,
  onCancel,
}: {
  target: Target;
  onSaved: (updated: Target) => void;
  onCancel: () => void;
}) {
  const { uid } = useAuth();
  const [values, setValues] = useState({
    title: target.title,
    url: target.url,
    selector: target.selector,
    cron: target.cron,
  });
  const [errors, setErrors] = useState<TargetFieldErrors>({});
  const [cronValid, setCronValid] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // URL か CSS セレクタを変えると、Functions がすぐに見に行く。保存の前に知らせる
  const willRecheck = values.url !== target.url || values.selector !== target.selector;

  const handleSubmit = async () => {
    const validation = validateTargetForm(values);
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }
    setErrors({});

    if (!uid) {
      setFailure('ログインの状態を確かめられませんでした。ページを読み込み直してください。');
      return;
    }

    setSaving(true);
    setFailure(null);

    try {
      const { updatedAt } = await TargetService.update(target.id, validation.data, uid);
      onSaved({ ...target, ...validation.data, updatedAt, updatedBy: uid });
    } catch (caught) {
      setFailure(mapAuthError(caught)?.message ?? '保存できませんでした。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="bg-muted/50 px-4 py-4">
      {/* 検証は zod で行い、項目ごとの文言を出す (ブラウザの検証は使わない) */}
      <form
        noValidate
        className="grid gap-4"
        onSubmit={event => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <h3 className="font-semibold">監視対象を編集</h3>

        <TargetFields
          values={values}
          errors={errors}
          disabled={saving}
          onChange={patch => setValues(previous => ({ ...previous, ...patch }))}
          onCronValidityChange={setCronValid}
        />

        {willRecheck ? (
          <Alert role="status">
            <AlertDescription>
              URL か CSS セレクタを変えたので、保存するとすぐに見に行きます。
            </AlertDescription>
          </Alert>
        ) : null}

        {failure ? (
          <Alert variant="destructive">
            <AlertTitle>保存できませんでした</AlertTitle>
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" disabled={saving || !cronValid}>
            {saving ? '保存しています…' : '保存'}
          </Button>
          <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>
            キャンセル
          </Button>
        </div>
      </form>
    </li>
  );
}
