'use client';

import { useState } from 'react';

import { useAuth } from '@/lib/auth/auth-context';
import { mapAuthError } from '@/lib/auth/auth-error';
import { validateTargetForm, type TargetFieldErrors } from '@/lib/schemas/target-form.schema';
import { TargetService } from '@/lib/services/target.service';
import { EMPTY_TARGET_FORM, TargetFields } from '@/components/targets/target-fields';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Target } from '@/types/target';

/**
 * 監視対象を足すフォーム。保存したら一覧を読み直さず、作った 1 件を先頭に足す
 * (`createdAt` の新しい順なので、新しい物は必ず先頭)。
 */
export function TargetCreateForm({ onCreated }: { onCreated: (target: Target) => void }) {
  const { uid } = useAuth();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(EMPTY_TARGET_FORM);
  const [errors, setErrors] = useState<TargetFieldErrors>({});
  const [cronValid, setCronValid] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const close = () => {
    setValues(EMPTY_TARGET_FORM);
    setErrors({});
    setFailure(null);
    setOpen(false);
  };

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

    setSubmitting(true);
    setFailure(null);

    try {
      const { id, createdAt } = await TargetService.create(validation.data, uid);
      // 作った直後に Functions が見に行って checkedAt を書くが、次に読んだ時に出れば足りる
      onCreated({
        id,
        ...validation.data,
        checkedAt: null,
        createdAt,
        createdBy: uid,
        updatedAt: null,
        updatedBy: null,
      });
      close();
    } catch (caught) {
      setFailure(mapAuthError(caught)?.message ?? '監視対象を足せませんでした。');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return <Button onClick={() => setOpen(true)}>監視対象を足す</Button>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>監視対象を足す</CardTitle>
        <CardDescription>足すと、その場で 1 回目を見に行きます。</CardDescription>
      </CardHeader>
      <CardContent>
        {/* 検証は zod で行い、項目ごとの文言を出す (ブラウザの検証は使わない) */}
        <form
          noValidate
          className="grid gap-4"
          onSubmit={event => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <TargetFields
            values={values}
            errors={errors}
            disabled={submitting}
            onChange={patch => setValues(previous => ({ ...previous, ...patch }))}
            onCronValidityChange={setCronValid}
          />

          {failure ? (
            <Alert variant="destructive">
              <AlertTitle>足せませんでした</AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" disabled={submitting || !cronValid}>
              {submitting ? '足しています…' : '足す'}
            </Button>
            <Button type="button" variant="ghost" disabled={submitting} onClick={close}>
              キャンセル
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
