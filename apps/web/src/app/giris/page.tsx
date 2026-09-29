'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { bffFetch, BffError } from '@/lib/session/client';
import { useT } from '@/components/i18n/I18nProvider';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import type { SessionUserDTO } from '@platform/shared';
import { postLoginPath } from '@/lib/session/post-login';

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
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 shadow-sm">
        <div className="flex items-start justify-between mb-1">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t('auth.login.title')}</h1>
          <LanguageSwitcher
            mode="cookie"
            className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2 py-1 outline-none text-slate-500 dark:text-slate-400"
          />
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{t('auth.login.subtitle')}</p>

        {mode === 'password' && (
          <form onSubmit={submitPassword} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t('auth.login.emailOrPhone')}</label>
              <input
                value={emailOrPhone}
                onChange={(e) => setEmailOrPhone(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-sky-500/30"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t('auth.login.password')}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-sky-500/30"
              />
            </div>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold transition disabled:opacity-60"
            >
              {loading ? t('auth.login.submitting') : t('auth.login.submit')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('otp-request');
                setError(null);
              }}
              className="w-full text-xs text-slate-500 dark:text-slate-400 hover:underline"
            >
              {t('auth.login.useOtp')}
            </button>
          </form>
        )}

        {mode === 'otp-request' && (
          <form onSubmit={requestOtp} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t('auth.login.phone')}</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                placeholder="0532 111 22 33"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-sky-500/30"
              />
            </div>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold transition disabled:opacity-60"
            >
              {loading ? t('auth.login.sendingCode') : t('auth.login.sendCode')}
            </button>
            <button type="button" onClick={() => setMode('password')} className="w-full text-xs text-slate-500 dark:text-slate-400 hover:underline">
              {t('auth.login.usePassword')}
            </button>
          </form>
        )}

        {mode === 'otp-verify' && (
          <form onSubmit={verifyOtp} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t('auth.login.code')}</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                inputMode="numeric"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-sky-500/30"
              />
            </div>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold transition disabled:opacity-60"
            >
              {loading ? t('auth.login.verifying') : t('auth.login.verify')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
