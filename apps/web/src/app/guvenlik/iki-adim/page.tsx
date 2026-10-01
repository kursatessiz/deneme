'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { MfaEnrollmentDTO, SessionUserDTO } from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { homePathFor, safeReturnPath } from '@/lib/session/post-login';
import { useT } from '@/components/i18n/I18nProvider';
import { ErrorState, LoadingState } from '@/components/common/DataState';
import { InlineMessage, PrimaryButton, SecondaryButton, Section, SettingsHeader, TextField } from '@/components/settings/ui';

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const t = useT();
  return (
    <Section title={t('twoFactor.recovery.title')} description={t('twoFactor.recovery.note')}>
      <ul className="grid grid-cols-2 gap-1 ui-mono text-sm" aria-label={t('twoFactor.recovery.title')}>
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <PrimaryButton onClick={onDone}>{t('twoFactor.recovery.done')}</PrimaryButton>
    </Section>
  );
}

/**
 * Two-step verification for platform accounts (docs/PAZARLAMA_MODULU.md 6.3):
 * enrolment (secret + otpauth link, no QR library), the sign-in step (app
 * code or a recovery code), and new recovery codes. The BFF turns the
 * upgraded token pair into cookies; this page never sees a token.
 */
function TwoFactor() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [me, setMe] = useState<SessionUserDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<MfaEnrollmentDTO | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    bffFetch<SessionUserDTO>('auth/me')
      .then(setMe)
      .catch((err) => setLoadError(err instanceof BffError ? err.message : t('twoFactor.error.generic')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loadError) return <ErrorState message={loadError} />;
  if (!me) return <LoadingState />;

  const next = safeReturnPath(params.get('sonra'), homePathFor(me));
  const goNext = () => {
    router.push(next);
    router.refresh();
  };

  async function submit(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('twoFactor.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCodes) return <RecoveryCodes codes={recoveryCodes} onDone={goNext} />;

  const mfa = me.mfa ?? { enabled: false, verified: false, enrollmentRequired: false };

  // Sign-in step: enrolled, but this session has not passed TOTP yet.
  if (mfa.enabled && !mfa.verified) {
    return (
      <div className="space-y-6">
        <SettingsHeader title={t('twoFactor.verify.title')} description={t('twoFactor.verify.description')} />
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(async () => {
              await bffFetch('auth/mfa/verify', { method: 'POST', body: useRecovery ? { recoveryCode: code } : { code } });
              goNext();
            });
          }}
        >
          <TextField label={useRecovery ? t('twoFactor.verify.recoveryCode') : t('twoFactor.verify.code')} value={code} onChange={setCode} />
          {error && <InlineMessage text={error} tone="error" />}
          <div className="flex gap-3">
            <PrimaryButton type="submit" disabled={busy || !code.trim()}>
              {busy ? t('twoFactor.verify.submitting') : t('twoFactor.verify.submit')}
            </PrimaryButton>
            <SecondaryButton
              onClick={() => {
                setUseRecovery(!useRecovery);
                setCode('');
              }}
            >
              {useRecovery ? t('twoFactor.verify.useApp') : t('twoFactor.verify.useRecovery')}
            </SecondaryButton>
          </div>
        </form>
      </div>
    );
  }

  // Enrolment.
  if (!mfa.enabled) {
    return (
      <div className="space-y-6">
        <SettingsHeader title={t('twoFactor.setup.title')} description={t('twoFactor.setup.intro')} />
        {mfa.enrollmentRequired && <InlineMessage text={t('twoFactor.setup.required')} />}
        {!enrollment ? (
          <PrimaryButton
            disabled={busy}
            onClick={() => submit(async () => setEnrollment(await bffFetch<MfaEnrollmentDTO>('auth/mfa/enroll', { method: 'POST' })))}
          >
            {t('twoFactor.setup.start')}
          </PrimaryButton>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit(async () => {
                const res = await bffFetch<{ recoveryCodes: string[] }>('auth/mfa/enroll/confirm', { method: 'POST', body: { code } });
                setRecoveryCodes(res.recoveryCodes);
              });
            }}
          >
            <p className="text-sm">{t('twoFactor.setup.step1')}</p>
            <div className="space-y-1">
              <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {t('twoFactor.setup.secretLabel')}
              </p>
              <code className="block p-2 border text-sm break-all" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)' }}>
                {enrollment.secret}
              </code>
              <a href={enrollment.otpauthUrl} className="text-xs underline" style={{ color: 'var(--color-text-secondary)' }}>
                {t('twoFactor.setup.openInApp')}
              </a>
            </div>
            <p className="text-sm">{t('twoFactor.setup.step2')}</p>
            <TextField label={t('twoFactor.verify.code')} value={code} onChange={setCode} />
            {error && <InlineMessage text={error} tone="error" />}
            <PrimaryButton type="submit" disabled={busy || !/^\d{6}$/.test(code)}>
              {t('twoFactor.setup.confirm')}
            </PrimaryButton>
          </form>
        )}
        {error && !enrollment && <InlineMessage text={error} tone="error" />}
      </div>
    );
  }

  // Enrolled and verified: status, new recovery codes, continue.
  return (
    <div className="space-y-6">
      <SettingsHeader title={t('twoFactor.setup.title')} description={t('twoFactor.setup.enabled')} />
      <Section title={t('twoFactor.recovery.regenerate')} description={t('twoFactor.recovery.regenerateHint')}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit(async () => {
              const res = await bffFetch<{ recoveryCodes: string[] }>('auth/mfa/recovery-codes', { method: 'POST', body: { code } });
              setRecoveryCodes(res.recoveryCodes);
            });
          }}
        >
          <TextField label={t('twoFactor.verify.code')} value={code} onChange={setCode} />
          {error && <InlineMessage text={error} tone="error" />}
          <PrimaryButton type="submit" disabled={busy || !/^\d{6}$/.test(code)}>
            {t('twoFactor.recovery.regenerate')}
          </PrimaryButton>
        </form>
      </Section>
      <SecondaryButton onClick={goNext}>{t('twoFactor.recovery.done')}</SecondaryButton>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <TwoFactor />
    </Suspense>
  );
}
