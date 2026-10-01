'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { SessionUserDTO } from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { postLoginPath } from '@/lib/session/post-login';
import { useT } from '@/components/i18n/I18nProvider';
import { AdminTheme } from '@/components/admin/AdminTheme';
import { ErrorState, LoadingState } from '@/components/common/DataState';
import { Checkbox } from '@/components/ui';
import { InlineMessage, PrimaryButton, SecondaryButton, Section, SettingsHeader, TextField } from '@/components/settings/ui';

interface InvitePreview {
  studio: { name: string; logoUrl: string | null };
  fullName: string;
  phoneMasked: string;
  roleName: string;
  isPlatformInvite?: boolean;
  expiresAt: string;
  documents: { id: string; type: string; title: string; version: number; body: string }[];
}

/**
 * Web landing of the universal invite link `/j/<token>` (CLAUDE.md
 * onboarding: phone OTP -> PIN -> consent -> ACTIVE). Built for platform
 * invites (M1: the marketing admin onboards on the web and continues to
 * two-step verification), and works for any invite. The BFF turns the
 * accept response's tokens into cookies.
 */
export default function JoinInvitePage() {
  const t = useT();
  const router = useRouter();
  const { token } = useParams<{ token: string }>();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [codeSent, setCodeSent] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    bffFetch<InvitePreview>(`invites/${encodeURIComponent(token)}`)
      .then(setInvite)
      .catch(() => setInvalid(true));
  }, [token]);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('joinInvite.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-root">
      <AdminTheme />
      <main className="max-w-lg mx-auto px-4 py-12 space-y-6">
        {invalid && <ErrorState message={t('joinInvite.invalid')} />}
        {!invalid && !invite && <LoadingState />}
        {invite && (
          <>
            <SettingsHeader title={t('joinInvite.invitedTo', { name: invite.studio.name })} description={t('joinInvite.role', { role: invite.roleName })} />
            <p>{t('joinInvite.greeting', { fullName: invite.fullName })}</p>
            {!codeSent ? (
              <PrimaryButton
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const res = await bffFetch<{ phoneMasked: string }>(`invites/${encodeURIComponent(token)}/otp`, { method: 'POST' });
                    setCodeSent(res.phoneMasked);
                  })
                }
              >
                {t('joinInvite.sendCode')}
              </PrimaryButton>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    const res = await bffFetch<{ user: SessionUserDTO }>(`invites/${encodeURIComponent(token)}/accept`, {
                      method: 'POST',
                      body: {
                        code,
                        ...(pin ? { pin } : {}),
                        acceptedDocumentVersionIds: invite.documents.map((d) => d.id),
                        device: 'web',
                      },
                    });
                    router.push(postLoginPath(res.user));
                    router.refresh();
                  });
                }}
              >
                <p>{t('joinInvite.codeSentTo', { phone: codeSent })}</p>
                <TextField label={t('joinInvite.code')} value={code} onChange={setCode} />
                <div className="grid gap-1">
                  <TextField label={t('joinInvite.pin')} value={pin} onChange={setPin} type="password" />
                  <p className="ui-caption">{t('joinInvite.pinHint')}</p>
                </div>
                <Section title={t('joinInvite.documents')}>
                  {invite.documents.map((d) => (
                    <details key={d.id}>
                      <summary className="ui-strong">{d.title}</summary>
                      <p className="mt-2 whitespace-pre-wrap ui-caption">{d.body}</p>
                    </details>
                  ))}
                  <Checkbox checked={accepted} onChange={(e) => setAccepted(e.target.checked)} label={t('joinInvite.accept')} />
                </Section>
                {error && <InlineMessage text={error} tone="error" />}
                <div className="flex gap-3">
                  <PrimaryButton type="submit" disabled={busy || !accepted || !/^\d{6}$/.test(code) || (pin !== '' && !/^\d{6}$/.test(pin))}>
                    {busy ? t('joinInvite.submitting') : t('joinInvite.submit')}
                  </PrimaryButton>
                  <SecondaryButton onClick={() => setCodeSent(null)}>{t('joinInvite.sendCode')}</SecondaryButton>
                </div>
              </form>
            )}
            {error && !codeSent && <InlineMessage text={error} tone="error" />}
          </>
        )}
      </main>
    </div>
  );
}
