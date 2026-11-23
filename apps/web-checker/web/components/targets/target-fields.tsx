'use client';

import { DEFAULT_CRON } from '@/lib/firestore/mappers';
import { DEFAULT_NOTIFY_MODE, NOTIFY_MODES, NOTIFY_MODE_LABELS, isNotifyMode } from '@/lib/target/notify-mode';
import type { TargetFieldErrors, TargetFormValues } from '@/lib/schemas/target-form.schema';
import { FormField } from '@/components/form-field';
import { FrequencySelect } from '@/components/targets/frequency-select';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

/** 作成と編集で共有する入力欄。検証は呼ぶ側が行い、結果を errors で渡す */

export const EMPTY_TARGET_FORM: TargetFormValues = {
  title: '',
  url: 'https://',
  selector: '',
  cron: DEFAULT_CRON,
  notifyMode: DEFAULT_NOTIFY_MODE,
};

export function TargetFields({
  values,
  errors,
  disabled,
  onChange,
  onCronValidityChange,
}: {
  values: TargetFormValues;
  errors: TargetFieldErrors;
  disabled?: boolean;
  onChange: (patch: Partial<TargetFormValues>) => void;
  onCronValidityChange: (valid: boolean) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label="名前" error={errors.title} hint="通知と一覧に出す名前です。">
        {control => (
          <Input
            {...control}
            value={values.title}
            disabled={disabled}
            onChange={event => onChange({ title: event.target.value })}
          />
        )}
      </FormField>

      <FormField label="URL" error={errors.url} hint="https:// で始まる URL だけ指定できます。">
        {control => (
          <Input
            {...control}
            type="url"
            value={values.url}
            disabled={disabled}
            placeholder="https://"
            onChange={event => onChange({ url: event.target.value })}
          />
        )}
      </FormField>

      <div className="sm:col-span-2">
        <FormField
          label="CSS セレクタ"
          error={errors.selector}
          hint="ページのどの部分を見るかを、CSS セレクタで指定します。"
        >
          {control => (
            <Input
              {...control}
              value={values.selector}
              disabled={disabled}
              placeholder="#news, .list > li:first-child"
              onChange={event => onChange({ selector: event.target.value })}
            />
          )}
        </FormField>
      </div>

      <div className="sm:col-span-2">
        <FrequencySelect
          value={values.cron}
          disabled={disabled}
          error={errors.cron}
          onChange={cron => onChange({ cron })}
          onValidityChange={onCronValidityChange}
        />
      </div>

      <div className="sm:col-span-2">
        <FormField
          label="通知の仕方"
          error={errors.notifyMode}
          hint="AI ライターに渡すと、更新検知で新しく現れたリンクを、AI ライターの定期実行が記事にするかどうか確かめます。"
        >
          {control => (
            <NativeSelect
              {...control}
              className="w-full"
              value={values.notifyMode}
              disabled={disabled}
              onChange={event => {
                if (isNotifyMode(event.target.value)) onChange({ notifyMode: event.target.value });
              }}
            >
              {NOTIFY_MODES.map(mode => (
                <NativeSelectOption key={mode} value={mode}>
                  {NOTIFY_MODE_LABELS[mode]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>
    </div>
  );
}
