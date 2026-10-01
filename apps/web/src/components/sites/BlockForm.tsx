'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { deriveBlockFormSpec, type BlockFormField, type BlockType } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { Badge, Button, ChipButton, FieldGroup, Input, List, ListItem, Select, Switch, Textarea } from '@/components/ui';
import {
  blockErrors,
  choiceLabelKey,
  fieldLabelKey,
  getAt,
  pathKey,
  setConfigField,
  setLocaleField,
  type DataPath,
  type FieldError,
} from '@/lib/sites/block-form';

export interface SectorOption {
  value: string;
  label: string;
}

/**
 * Field-based editor of one block (docs/SAYFA_MOTORU.md "Editörler"). The form is derived from the block's Zod
 * schema (`deriveBlockFormSpec`), so every field of `blocks.ts` has an input: labelled text inputs per language
 * (language chips), repeatable lists for FAQ, feature and step items, switches, choice chips, a sector picker.
 * Validation messages are the schema's issues shown inline under the field in the interface language. A collapsed
 * "Advanced (JSON)" view edits the same data as raw JSON for anything the form does not cover. The block's data
 * stays one JSON object: the save payload is the same one the JSON editor produced.
 */
export function BlockForm({
  type,
  data,
  onChange,
  locales,
  sectorOptions,
}: {
  type: BlockType;
  data: unknown;
  onChange: (next: unknown) => void;
  /** The site's languages; a language that already has text in the block is added to the chips. */
  locales: readonly string[];
  /** Sector choices for `sector_cards` (id -> label); null when the list is unavailable (free text keys). */
  sectorOptions: readonly SectorOption[] | null;
}) {
  const t = useT();
  const spec = useMemo(() => deriveBlockFormSpec(type), [type]);
  const errors = useMemo(() => blockErrors(type, data), [type, data]);

  const textLocales = Object.keys((getAt(data, ['text']) as Record<string, unknown> | undefined) ?? {});
  const chips = Array.from(new Set([...locales, ...textLocales]));
  const [locale, setLocale] = useState(chips[0] ?? 'tr');
  const activeLocale = chips.includes(locale) ? locale : (chips[0] ?? 'tr');
  const translated = textLocales.includes(activeLocale);

  const errorText = (path: DataPath): string | null => {
    const error: FieldError | undefined = errors[pathKey(path)];
    return error ? t(error.key, error.params) : null;
  };

  /** Writes a field value: a language text field, or a config field, pruning emptied optional values. */
  const write = (scope: 'text' | 'config', path: DataPath, value: unknown, field: Pick<BlockFormField, 'required'>) => {
    onChange(scope === 'text' ? setLocaleField(data, activeLocale, path, value, field.required) : setConfigField(data, path, value, field.required));
  };

  const renderField = (field: BlockFormField, scope: 'text' | 'config', path: DataPath, key: string): React.ReactNode => {
    const full: DataPath = scope === 'text' ? ['text', activeLocale, ...path] : ['config', ...path];
    const value = getAt(data, full);
    const label = t(fieldLabelKey(type, field));
    const error = errorText(full);

    switch (field.kind) {
      case 'text':
      case 'url':
      case 'href':
        return (
          <FieldGroup key={key} label={label} error={error}>
            <Input
              value={typeof value === 'string' ? value : ''}
              maxLength={field.maxLength}
              invalid={!!error}
              inputMode={field.kind === 'text' ? undefined : 'url'}
              onChange={(e) => write(scope, path, e.target.value, field)}
            />
          </FieldGroup>
        );
      case 'textarea':
        return (
          <FieldGroup key={key} label={label} error={error}>
            <Textarea value={typeof value === 'string' ? value : ''} maxLength={field.maxLength} rows={4} invalid={!!error} onChange={(e) => write(scope, path, e.target.value, field)} />
          </FieldGroup>
        );
      case 'boolean': {
        const checked = typeof value === 'boolean' ? value : field.defaultValue === true;
        return <Switch key={key} label={label} checked={checked} onCheckedChange={(next) => write(scope, path, next, { required: true })} />;
      }
      case 'choice_list': {
        const selected = Array.isArray(value) ? (value as string[]) : ((field.defaultValue as string[] | undefined) ?? []);
        return (
          <fieldset key={key} className="grid gap-2">
            <legend className="ui-strong">{label}</legend>
            <div className="flex flex-wrap gap-2">
              {(field.choices ?? []).map((choice) => {
                const on = selected.includes(choice);
                return (
                  <ChipButton
                    key={choice}
                    selected={on}
                    onClick={() => {
                      const next = (field.choices ?? []).filter((c) => (c === choice ? !on : selected.includes(c)));
                      write(scope, path, next, { required: true });
                    }}
                  >
                    {t(choiceLabelKey(field.key, choice))}
                  </ChipButton>
                );
              })}
            </div>
            {error && <small role="alert">{error}</small>}
          </fieldset>
        );
      }
      case 'string_list':
        return renderStringList(field, scope, path, full, label, error, key);
      case 'repeatable':
        return renderRepeatable(field, scope, path, full, label, error, key);
      default:
        return null;
    }
  };

  const renderStringList = (field: BlockFormField, scope: 'text' | 'config', path: DataPath, full: DataPath, label: string, error: string | null, key: string) => {
    const list = Array.isArray(getAt(data, full)) ? (getAt(data, full) as string[]) : [];
    if (!sectorOptions) {
      return (
        <FieldGroup key={key} label={label} hint={t('sites.editor.blocks.form.sectorNoOptions')} error={error}>
          <Input
            value={list.join(', ')}
            invalid={!!error}
            onChange={(e) =>
              write(
                scope,
                path,
                e.target.value
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean),
                { required: true },
              )
            }
          />
        </FieldGroup>
      );
    }
    const labelOf = (value: string) => sectorOptions.find((o) => o.value === value)?.label ?? value;
    return (
      <div key={key} className="grid gap-2">
        <span className="ui-strong">{label}</span>
        <div className="flex flex-wrap gap-2">
          {list.map((value) => (
            <ChipButton key={value} selected aria-label={t('sites.editor.blocks.form.sectorRemove', { sector: labelOf(value) })} onClick={() => write(scope, path, list.filter((v) => v !== value), { required: true })}>
              {labelOf(value)}
            </ChipButton>
          ))}
        </div>
        <Select
          value=""
          aria-label={t('sites.editor.blocks.form.sectorPick')}
          className="w-auto"
          onChange={(e) => e.target.value && write(scope, path, [...list, e.target.value], { required: true })}
        >
          <option value="">{t('sites.editor.blocks.form.sectorPick')}</option>
          {sectorOptions
            .filter((o) => !list.includes(o.value))
            .map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
        </Select>
        {error && <small role="alert">{error}</small>}
      </div>
    );
  };

  const renderRepeatable = (field: BlockFormField, scope: 'text' | 'config', path: DataPath, full: DataPath, label: string, error: string | null, key: string) => {
    const items = Array.isArray(getAt(data, full)) ? (getAt(data, full) as unknown[]) : [];
    const itemFields = field.itemFields ?? [];
    const atMax = field.maxItems !== undefined && items.length >= field.maxItems;
    const blankItem = () => Object.fromEntries(itemFields.filter((f) => f.required && (f.kind === 'text' || f.kind === 'textarea')).map((f) => [f.key, '']));
    return (
      <div key={key} className="grid gap-3">
        <h5 className="ui-strong">{label}</h5>
        <List>
          {items.map((_, index) => (
            <ListItem key={index} className="grid gap-3 ui-rule">
              <div className="flex items-center justify-between gap-2">
                <span className="ui-caption">{t('sites.editor.blocks.form.itemTitle', { n: index + 1 })}</span>
                <Button variant="outline" tone="error" size="sm" onClick={() => write(scope, path, items.filter((__, i) => i !== index), { required: true })}>
                  {t('sites.editor.blocks.form.removeItem')}
                </Button>
              </div>
              {itemFields.map((itemField) => renderField(itemField, scope, [...path, index, itemField.key], `${key}.${index}.${itemField.key}`))}
            </ListItem>
          ))}
        </List>
        {error && <small role="alert">{error}</small>}
        <div>
          <Button variant="outline" tone="surface" size="sm" disabled={atMax} onClick={() => write(scope, path, [...items, blankItem()], { required: true })}>
            {t('sites.editor.blocks.form.addItem')}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="grid gap-4">
      {spec.config.length > 0 && (
        <fieldset className="grid gap-3">
          <legend className="ui-strong">{t('sites.editor.blocks.form.settings')}</legend>
          {spec.config.map((field) => renderField(field, 'config', [field.key], `config.${field.key}`))}
        </fieldset>
      )}

      {spec.text.length > 0 && (
        <fieldset className="grid gap-3">
          <legend className="ui-strong">{t('sites.editor.blocks.form.texts')}</legend>
          <div className="flex flex-wrap items-center gap-2">
            {chips.map((l) => (
              <ChipButton key={l} selected={l === activeLocale} onClick={() => setLocale(l)}>
                {l}
              </ChipButton>
            ))}
            {!translated && <Badge>{t('sites.editor.blocks.form.untranslated')}</Badge>}
          </div>
          {spec.text.map((field) => renderField(field, 'text', [field.key], `text.${activeLocale}.${field.key}`))}
        </fieldset>
      )}

      <JsonView data={data} onChange={onChange} />
    </div>
  );
}

/** The collapsed raw JSON of the block: valid JSON replaces the data (and so the form); invalid JSON keeps the last valid value. */
function JsonView({ data, onChange }: { data: unknown; onChange: (next: unknown) => void }) {
  const t = useT();
  const pretty = (value: unknown) => JSON.stringify(value, null, 2);
  const [text, setText] = useState(() => pretty(data));
  const [invalid, setInvalid] = useState(false);
  // The JSON the user last typed and we emitted: a data change that equals it came from here, not from the form.
  const emitted = useRef<string | null>(null);

  useEffect(() => {
    const current = JSON.stringify(data);
    if (emitted.current !== null && emitted.current === current) return;
    emitted.current = null;
    setText(pretty(data));
    setInvalid(false);
  }, [data]);

  return (
    <details className="ui-panel p-3">
      <summary className="ui-strong">{t('sites.editor.blocks.advanced.title')}</summary>
      <div className="grid gap-2 pt-3">
        <p className="ui-caption">{t('sites.editor.blocks.advanced.hint')}</p>
        <Textarea
          value={text}
          rows={10}
          invalid={invalid}
          className="ui-mono"
          aria-label={t('sites.editor.blocks.advanced.title')}
          onChange={(e) => {
            setText(e.target.value);
            try {
              const parsed: unknown = JSON.parse(e.target.value);
              setInvalid(false);
              emitted.current = JSON.stringify(parsed);
              onChange(parsed);
            } catch {
              setInvalid(true);
            }
          }}
        />
        {invalid && <small role="alert">{t('sites.editor.blocks.advanced.invalid')}</small>}
      </div>
    </details>
  );
}

