'use client';

import { useState } from 'react';
import { smsSegmentInfo, type GeneratableDraftKind, type MarketingCheckIssue, type MarketingDraftVariantDTO } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { Badge } from '@/components/common/Badge';
import { DRAFT_FIELD_SPECS, contentToValues, fieldLimit, valuesToContent } from '@/lib/marketing/draft-fields';
import { AreaField, InputField, LinkButton, SelectField } from '../fields';

/** Human text of one deterministic check issue, in the viewer's language. */
export function IssueList({ issues }: { issues: readonly MarketingCheckIssue[] }) {
  const t = useT();
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1" aria-label={t('marketingStudio.issues.title')}>
      {issues.map((issue, index) => (
        <li key={index} className="flex items-start gap-2 ui-small">
          <Badge tone={issue.severity === 'BLOCKING' ? 'danger' : 'warning'}>{t(`marketingStudio.issues.severity.${issue.severity}`)}</Badge>
          <span className="ui-text-muted">
            {t(`marketingStudio.check.${issue.code}`, {
              field: issue.field,
              detail: issue.detail ?? '',
              limit: issue.limit ?? 0,
              actual: issue.actual ?? 0,
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One variant of a generatable draft: editable fields with limit counters, its check issues and a save button. */
export function VariantEditor({
  kind,
  variant,
  locked,
  busy,
  onSave,
}: {
  kind: GeneratableDraftKind;
  variant: MarketingDraftVariantDTO;
  locked: boolean;
  busy: boolean;
  onSave: (content: Record<string, unknown>) => void;
}) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>(() => contentToValues(kind, variant.content));
  const original = JSON.stringify(contentToValues(kind, variant.content));
  const dirty = JSON.stringify(values) !== original;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge tone="info">{t('marketingStudio.variant', { key: variant.key })}</Badge>
        {variant.editedAt && <Badge>{t('marketingStudio.edited')}</Badge>}
      </div>
      {DRAFT_FIELD_SPECS[kind].map((spec) => {
        const label = t(spec.labelKey);
        const value = values[spec.name] ?? '';
        const limit = fieldLimit(kind, spec.name);
        const over =
          limit !== undefined && (spec.type === 'list' ? value.split('\n').some((l) => [...l.trim()].length > limit) : [...value].length > limit);
        const hint =
          limit === undefined ? undefined : spec.type === 'list' ? t('marketingStudio.limitPerLine', { limit }) : `${[...value].length} / ${limit}`;
        const onChange = (v: string) => setValues({ ...values, [spec.name]: v });
        if (spec.type === 'select') {
          return (
            <SelectField
              key={spec.name}
              label={label}
              value={value}
              onChange={onChange}
              options={(spec.options ?? []).map((o) => ({ value: o, label: o }))}
              disabled={locked}
            />
          );
        }
        if (spec.type === 'text') {
          return <InputField key={spec.name} label={label} value={value} onChange={onChange} hint={hint} invalid={over} disabled={locked} />;
        }
        return (
          <AreaField
            key={spec.name}
            label={label}
            value={value}
            onChange={onChange}
            hint={
              spec.type === 'headings' ? t('marketingStudio.headingsHint') : spec.type === 'faq' ? t('marketingStudio.faqHint') : spec.type === 'list' ? hint ?? t('marketingStudio.onePerLine') : hint
            }
            rows={spec.type === 'area' ? 4 : 5}
            invalid={over}
            disabled={locked}
          />
        );
      })}
      {kind === 'SMS' && (
        <p className="ui-caption">
          {(() => {
            const info = smsSegmentInfo(values.text ?? '');
            return t('marketingStudio.smsSegments', { encoding: info.encoding, length: info.length, segments: info.segments });
          })()}
        </p>
      )}
      <IssueList issues={variant.issues} />
      {!locked && (
        <div className="flex items-center gap-3">
          <LinkButton onClick={() => onSave(valuesToContent(kind, values))} disabled={busy || !dirty}>
            {t('marketingStudio.saveVariant', { key: variant.key })}
          </LinkButton>
          {dirty && (
            <LinkButton onClick={() => setValues(contentToValues(kind, variant.content))} disabled={busy}>
              {t('marketingStudio.revert')}
            </LinkButton>
          )}
        </div>
      )}
    </div>
  );
}
