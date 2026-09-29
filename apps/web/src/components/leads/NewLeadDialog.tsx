'use client';

import { useState } from 'react';
import { LeadSource } from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { useT } from '@/components/i18n/I18nProvider';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Modal } from '@/components/common/Modal';

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

export function NewLeadDialog({ studioId, onClose, onDone }: { studioId: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [source, setSource] = useState<LeadSource>(LeadSource.OTHER);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (fullName.trim().length < 2 || phone.trim().length < 6) {
      setError(t('leads.newDialog.validation'));
      return;
    }
    setSubmitting(true);
    try {
      await bffFetch('leads', {
        method: 'POST',
        studioId,
        body: { studioId, fullName: fullName.trim(), phone: phone.trim(), email: email.trim() || undefined, source },
      });
      onDone();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('leads.newDialog.errors.createFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('leads.newDialog.title')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          placeholder={t('leads.newDialog.fullNamePlaceholder')}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="w-full text-sm px-3 py-1.5"
          style={inputStyle}
        />
        <input
          placeholder={t('leads.newDialog.phonePlaceholder')}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full text-sm px-3 py-1.5"
          style={inputStyle}
        />
        <input
          placeholder={t('leads.newDialog.emailPlaceholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full text-sm px-3 py-1.5"
          style={inputStyle}
        />
        <select value={source} onChange={(e) => setSource(e.target.value as LeadSource)} className="w-full text-sm px-3 py-1.5" style={inputStyle}>
          {Object.values(LeadSource).map((s) => (
            <option key={s} value={s}>
              {t(`leads.source.${s}`)}
            </option>
          ))}
        </select>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <PermissionButton type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </PermissionButton>
          <PermissionButton required={['leads.manage']} type="submit" variant="primary" disabled={submitting}>
            {submitting ? t('leads.newDialog.creating') : t('common.create')}
          </PermissionButton>
        </div>
      </form>
    </Modal>
  );
}
