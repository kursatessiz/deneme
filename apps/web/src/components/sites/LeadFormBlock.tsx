'use client';

import { useRef, useState } from 'react';
import { trackingHeaders } from '@/lib/tracking/client';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/**
 * The page engine's lead_form block (docs/SAYFA_MOTORU.md). Posts to the
 * existing public lead endpoint so a Contact, a `lead` conversion and
 * visitor identification happen exactly as they do for the tenant's own
 * embedded form (docs/CRM_VE_ATIF.md). Bot protection: a hidden honeypot
 * field plus a minimum time-on-page check (the endpoint's own rate limit
 * covers the rest).
 */
export function LeadFormBlock({
  studioSlug,
  fields,
  title,
  submitLabel,
  consentText,
}: {
  studioSlug: string;
  fields: readonly ('fullName' | 'phone' | 'email' | 'interest')[];
  title?: string;
  submitLabel?: string;
  consentText?: string;
}) {
  const mountedAt = useRef(Date.now());
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [values, setValues] = useState({ fullName: '', phone: '', email: '', interest: '', website: '', consent: false });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!values.consent) return;
    if (Date.now() - mountedAt.current < 1500) return; // too fast to be a real visitor; drop silently, like the honeypot
    setStatus('sending');
    try {
      const res = await fetch(`${API_BASE_URL}/public/studios/${encodeURIComponent(studioSlug)}/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...trackingHeaders() },
        body: JSON.stringify({
          fullName: values.fullName,
          phone: values.phone,
          email: values.email || undefined,
          interest: values.interest || undefined,
          consent: values.consent,
          website: values.website,
        }),
      });
      setStatus(res.ok ? 'sent' : 'error');
    } catch {
      setStatus('error');
    }
  };

  if (status === 'sent') {
    return (
      <p role="status" style={{ color: 'var(--color-text-primary)' }}>
        Teşekkürler, en kısa sürede sizinle iletişime geçeceğiz.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}>
      {title && (
        <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{title}</h3>
      )}
      {/* Honeypot: hidden from real visitors via off-screen positioning, never display:none (some scrapers skip those). */}
      <input
        type="text"
        name="website"
        autoComplete="off"
        tabIndex={-1}
        value={values.website}
        onChange={(e) => setValues({ ...values, website: e.target.value })}
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
        aria-hidden="true"
      />
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
        Ad soyad
        <input
          required
          value={values.fullName}
          onChange={(e) => setValues({ ...values, fullName: e.target.value })}
          style={{ padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
        Telefon
        <input
          required
          value={values.phone}
          onChange={(e) => setValues({ ...values, phone: e.target.value })}
          placeholder="+90 5xx xxx xx xx"
          style={{ padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
        />
      </label>
      {fields.includes('email') && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
          E-posta
          <input
            type="email"
            value={values.email}
            onChange={(e) => setValues({ ...values, email: e.target.value })}
            style={{ padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
          />
        </label>
      )}
      {fields.includes('interest') && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
          Mesajınız
          <textarea
            value={values.interest}
            onChange={(e) => setValues({ ...values, interest: e.target.value })}
            rows={3}
            style={{ padding: '10px 12px', borderRadius: 'var(--radius-input)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
          />
        </label>
      )}
      <label style={{ display: 'flex', gap: 8, fontSize: 13, alignItems: 'flex-start', color: 'var(--color-text-secondary)' }}>
        <input type="checkbox" required checked={values.consent} onChange={(e) => setValues({ ...values, consent: e.target.checked })} style={{ marginTop: 3 }} />
        <span>{consentText || 'İletişim bilgilerimin bu işletme tarafından aranmak için kullanılmasına izin veriyorum.'}</span>
      </label>
      {status === 'error' && (
        <p role="alert" style={{ color: 'var(--color-danger, #b42318)', fontSize: 13 }}>
          Gönderilemedi, lütfen tekrar deneyin.
        </p>
      )}
      <button
        type="submit"
        disabled={status === 'sending'}
        style={{
          padding: '12px 20px',
          borderRadius: 'var(--radius-button)',
          fontWeight: 700,
          color: '#fff',
          border: 'none',
          backgroundImage: 'var(--gradient-brand)',
          cursor: 'pointer',
        }}
      >
        {submitLabel || 'Gönder'}
      </button>
    </form>
  );
}
