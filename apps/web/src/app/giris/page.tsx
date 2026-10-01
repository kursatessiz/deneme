'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { bffFetch, BffError } from '@/lib/session/client';
import { useT } from '@/components/i18n/I18nProvider';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import type { SessionUserDTO } from '@platform/shared';
import { postLoginPath } from '@/lib/session/post-login';
import Link from 'next/link';
import { KeyRound, LogIn, Smartphone } from 'lucide-react';
import { PRODUCT_NAME } from '@platform/shared';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Input } from '@/components/ui/Input';

type Mode = 'password' | 'otp-request' | 'otp-verify';

/**
 * Staff login: e-posta/telefon + şifre by default, or phone OTP. Tokens
 * never reach this component -- the BFF route handler sets them as
 * httpOnly cookies and returns only the (token-stripped) user payload.
 */
export default function LoginPage() {
  const router = useRouter();
  const t = useT();
  const [mode, setMode] = useState<Mode>('password');
  const [emailOrPhone, setEmailOrPhone] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await bffFetch<{ user: SessionUserDTO }>('auth/login', { method: 'POST', body: { emailOrPhone, password } });
      router.push(postLoginPath(res.user));
      router.refresh();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('auth.login.error.password'));
    } finally {
      setLoading(false);
    }
  }

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await bffFetch('auth/otp/request', { method: 'POST', body: { phone } });
      setMode('otp-verify');
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('auth.login.error.otpRequest'));
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await bffFetch<{ user: SessionUserDTO }>('auth/otp/verify', { method: 'POST', body: { phone, code } });
      router.push(postLoginPath(res.user));
      router.refresh();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('auth.login.error.otpVerify'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm grid gap-6">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2">
            <Avatar name={PRODUCT_NAME} />
            <span className="ui-heading">{PRODUCT_NAME}</span>
          </Link>
          <LanguageSwitcher mode="cookie" className="pui-input ui-btn-sm" />
        </div>

        <div className="pui-card">
          <div className="pui-card-content gap-6 p-6">
            <div className="grid gap-1">
              <h1 className="ui-title">{t('auth.login.title')}</h1>
              <p className="ui-text-muted">{t('auth.login.subtitle')}</p>
            </div>

            {mode === 'password' && (
              <form onSubmit={submitPassword} className="grid gap-4">
                <FieldGroup label={t('auth.login.emailOrPhone')}>
                  <Input value={emailOrPhone} onChange={(e) => setEmailOrPhone(e.target.value)} required autoComplete="username" invalid={!!error} />
                </FieldGroup>
                <FieldGroup label={t('auth.login.password')}>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" invalid={!!error} />
                </FieldGroup>
                {error && <ErrorText text={error} />}
                <Button type="submit" block disabled={loading} icon={<LogIn className="ui-icon" aria-hidden="true" />}>
                  {loading ? t('auth.login.submitting') : t('auth.login.submit')}
                </Button>
                <Button
                  variant="link"
                  tone="muted"
                  size="sm"
                  block
                  onClick={() => {
                    setMode('otp-request');
                    setError(null);
                  }}
                >
                  {t('auth.login.useOtp')}
                </Button>
              </form>
            )}

            {mode === 'otp-request' && (
              <form onSubmit={requestOtp} className="grid gap-4">
                <FieldGroup label={t('auth.login.phone')}>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="0532 111 22 33" autoComplete="tel" invalid={!!error} />
                </FieldGroup>
                {error && <ErrorText text={error} />}
                <Button type="submit" block disabled={loading} icon={<Smartphone className="ui-icon" aria-hidden="true" />}>
                  {loading ? t('auth.login.sendingCode') : t('auth.login.sendCode')}
                </Button>
                <Button variant="link" tone="muted" size="sm" block onClick={() => setMode('password')}>
                  {t('auth.login.usePassword')}
                </Button>
              </form>
            )}

            {mode === 'otp-verify' && (
              <form onSubmit={verifyOtp} className="grid gap-4">
                <FieldGroup label={t('auth.login.code')}>
                  <Input value={code} onChange={(e) => setCode(e.target.value)} required inputMode="numeric" autoComplete="one-time-code" invalid={!!error} />
                </FieldGroup>
                {error && <ErrorText text={error} />}
                <Button type="submit" block disabled={loading} icon={<KeyRound className="ui-icon" aria-hidden="true" />}>
                  {loading ? t('auth.login.verifying') : t('auth.login.verify')}
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorText({ text }: { text: string }) {
  return (
    <p className="ui-caption ui-text-error" role="alert">
      {text}
    </p>
  );
}
