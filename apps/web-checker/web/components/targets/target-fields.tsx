'use client';

import { DEFAULT_CRON } from '@/lib/firestore/mappers';
import type { TargetFieldErrors, TargetFormValues } from '@/lib/schemas/target-form.schema';
import { FormField } from '@/components/form-field';
import { FrequencySelect } from '@/components/targets/frequency-select';
import { Input } from '@/components/ui/input';

/** 作成と編集で共有する入力欄。検証は呼ぶ側が行い、結果を errors で渡す */

export const EMPTY_TARGET_FORM: TargetFormValues = {
  title: '',
  url: 'https://',
  selector: '',
  cron: DEFAULT_CRON,
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
    </div>
  );
}
