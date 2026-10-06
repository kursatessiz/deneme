'use client';

import { useRef, useState } from 'react';
import { trackingHeaders } from '@/lib/tracking/client';
import { publicApiBaseUrl } from '@/lib/public-api-url';
import { Button, Checkbox, FieldGroup, Input, Textarea } from '@/components/ui';

/**
 * The page engine's lead_form block (docs/SAYFA_MOTORU.md). Posts to the
 * existing public lead endpoint so a Contact, a `lead` conversion and
 * visitor identification happen exactly as they do for the tenant's own
 * embedded form (docs/CRM_VE_ATIF.md). Bot protection: a hidden honeypot
 * field plus a minimum time-on-page check (the endpoint's own rate limit
 * covers the rest).
 */
interface LeadFormI18n {
  fullName: string;
  phone: string;
  phonePlaceholder: string;
  email: string;
  message: string;
  defaultConsent: string;
  submit: string;
  sent: string;
  error: string;
}

export function LeadFormBlock({
  studioSlug,
  fields,
  title,
  submitLabel,
  consentText,
  marketingConsent,
  locale,
  i18n,
}: {
  studioSlug: string;
  fields: readonly ('fullName' | 'phone' | 'email' | 'interest')[];
  title?: string;
  submitLabel?: string;
  consentText?: string;
  /**
   * M3e: an optional, never pre-ticked marketing consent box with its
   * wording and version. In a double opt-in region the API e-mails a
   * confirmation link before the consent counts.
   */
  marketingConsent?: { text: string; formVersion: string };
  /** Page language, for the confirmation e-mail. */
  locale?: string;
  /** Chrome text in the page's own locale (packages/shared/src/i18n/messages/{tr,en}/sites.ts), passed down from the server component since this form is client-side. */
  i18n: LeadFormI18n;
}) {
  const mountedAt = useRef(Date.now());
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [values, setValues] = useState({ fullName: '', phone: '', email: '', interest: '', website: '', consent: false, marketing: false });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!values.consent) return;
    if (Date.now() - mountedAt.current < 1500) return; // too fast to be a real visitor; drop silently, like the honeypot
    setStatus('sending');
    try {
      const res = await fetch(`${publicApiBaseUrl()}/public/studios/${encodeURIComponent(studioSlug)}/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...trackingHeaders() },
        body: JSON.stringify({
          fullName: values.fullName,
          phone: values.phone,
          email: values.email || undefined,
          interest: values.interest || undefined,
          consent: values.consent,
          website: values.website,
          ...(marketingConsent ? { marketingConsent: values.marketing, formVersion: marketingConsent.formVersion } : {}),
          ...(locale ? { locale } : {}),
        }),
      });
      setStatus(res.ok ? 'sent' : 'error');
    } catch {
      setStatus('error');
    }
  };

  if (status === 'sent') {
    return <p role="status" className="ui-strong">{i18n.sent}</p>;
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 max-w-md">
      {title && <h3 className="ui-title">{title}</h3>}
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
      <FieldGroup label={i18n.fullName}>
        <Input required value={values.fullName} onChange={(e) => setValues({ ...values, fullName: e.target.value })} />
      </FieldGroup>
      <FieldGroup label={i18n.phone}>
        <Input required type="tel" value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} placeholder={i18n.phonePlaceholder} />
      </FieldGroup>
      {fields.includes('email') && (
        <FieldGroup label={i18n.email}>
          <Input type="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} />
        </FieldGroup>
      )}
      {fields.includes('interest') && (
        <FieldGroup label={i18n.message}>
          <Textarea value={values.interest} onChange={(e) => setValues({ ...values, interest: e.target.value })} rows={3} />
        </FieldGroup>
      )}
      <Checkbox required checked={values.consent} onChange={(e) => setValues({ ...values, consent: e.target.checked })} className="items-start" label={<span className="ui-caption">{consentText || i18n.defaultConsent}</span>} />
      {marketingConsent && (
        <Checkbox checked={values.marketing} onChange={(e) => setValues({ ...values, marketing: e.target.checked })} className="items-start" label={<span className="ui-caption">{marketingConsent.text}</span>} />
      )}
      {status === 'error' && (
        <p role="alert" className="ui-caption ui-text-error">
          {i18n.error}
        </p>
      )}
      <Button type="submit" disabled={status === 'sending'} className="justify-self-start">
        {submitLabel || i18n.submit}
      </Button>
    </form>
  );
}
