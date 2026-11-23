'use client';

import { useEffect, useState } from 'react';

import { validateCron, type CronValidation } from '@/lib/target/cron';
import { FREQUENCY_PRESETS, matchPreset } from '@/lib/target/frequency-presets';
import { formatJst } from '@/lib/format-date';
import { FormField } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

/**
 * 頻度の入力。プリセットから選ぶか、cron を自由に書く。
 *
 * プリセットに無い cron (自由入力で保存された物) は、プリセットに丸めずに自由入力として開く
 * (丸めると、開いて保存しただけで頻度が変わる)。読めた cron には、次に見に行く時刻を出す
 * (Functions と同じ cron-parser で計算するので、表示と動きがずれない)。
 */

const CUSTOM = '__custom__';

export function FrequencySelect({
  value,
  onChange,
  onValidityChange,
  disabled,
  error,
}: {
  value: string;
  onChange: (cron: string) => void;
  /** cron が読めない間は保存させないため、親に伝える */
  onValidityChange: (valid: boolean) => void;
  disabled?: boolean;
  error?: string;
}) {
  // 一度自由入力を選んだら、入力の途中でプリセットと一致しても選択を戻さない
  const [customMode, setCustomMode] = useState(() => matchPreset(value) === undefined);
  const [validation, setValidation] = useState<CronValidation | null>(null);

  useEffect(() => {
    let cancelled = false;

    void validateCron(value).then(result => {
      if (cancelled) return;
      setValidation(result);
      onValidityChange(result.ok);
    });

    return () => {
      cancelled = true;
    };
  }, [value, onValidityChange]);

  const handlePresetChange = (selected: string) => {
    if (selected === CUSTOM) {
      setCustomMode(true);
      return;
    }
    setCustomMode(false);
    onChange(selected);
  };

  return (
    <div className="grid gap-3">
      <FormField
        label="頻度"
        hint="見回りは毎時 05 分に 1 回なので、1 時間より細かい頻度は効きません。"
      >
        {control => (
          <NativeSelect
            {...control}
            className="w-full"
            value={customMode ? CUSTOM : value}
            disabled={disabled}
            onChange={event => handlePresetChange(event.target.value)}
          >
            {FREQUENCY_PRESETS.map(preset => (
              <NativeSelectOption key={preset.cron} value={preset.cron}>
                {preset.label} ({preset.note})
              </NativeSelectOption>
            ))}
            <NativeSelectOption value={CUSTOM}>cron を自由に書く</NativeSelectOption>
          </NativeSelect>
        )}
      </FormField>

      {customMode ? (
        <FormField
          label="cron"
          error={(validation?.ok === false ? validation.reason : null) ?? error}
          hint="crontab の書き方 (分 時 日 月 曜日)。日本時間で読みます。"
        >
          {control => (
            <Input
              {...control}
              value={value}
              disabled={disabled}
              placeholder="0 * * * *"
              onChange={event => onChange(event.target.value)}
            />
          )}
        </FormField>
      ) : null}

      {validation?.ok ? (
        <p className="text-xs text-muted-foreground">
          次に見に行く時刻: {formatJst(validation.nextCheckAt.getTime())} ごろ
        </p>
      ) : null}
    </div>
  );
}
