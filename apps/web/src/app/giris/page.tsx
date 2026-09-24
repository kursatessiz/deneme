'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { bffFetch, BffError } from '@/lib/session/client';

type Mode = 'password' | 'otp-request' | 'otp-verify';

/**
 * Staff login: e-posta/telefon + şifre by default, or phone OTP. Tokens
 * never reach this component -- the BFF route handler sets them as
 * httpOnly cookies and returns only the (token-stripped) user payload.
 */
export default function LoginPage() {
  const router = useRouter();
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
      await bffFetch('auth/login', { method: 'POST', body: { emailOrPhone, password } });
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof BffError ? err.message : 'Giriş yapılamadı');
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
      setError(err instanceof BffError ? err.message : 'Kod gönderilemedi');
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await bffFetch('auth/otp/verify', { method: 'POST', body: { phone, code } });
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof BffError ? err.message : 'Kod doğrulanamadı');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-1">Yönetim Paneline Giriş</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">İşletmenizi yönetmek için giriş yapın</p>

        {mode === 'password' && (
          <form onSubmit={submitPassword} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">E-posta veya telefon</label>
              <input
                value={emailOrPhone}
                onChange={(e) => setEmailOrPhone(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-sky-500/30"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Şifre</label>
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
              {loading ? 'Giriş yapılıyor...' : 'Giriş yap'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('otp-request');
                setError(null);
              }}
              className="w-full text-xs text-slate-500 dark:text-slate-400 hover:underline"
            >
              Telefon ile tek kullanımlık kod isteyin
            </button>
          </form>
        )}

        {mode === 'otp-request' && (
          <form onSubmit={requestOtp} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Telefon numarası</label>
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
              {loading ? 'Gönderiliyor...' : 'Kod gönder'}
            </button>
            <button type="button" onClick={() => setMode('password')} className="w-full text-xs text-slate-500 dark:text-slate-400 hover:underline">
              Şifre ile giriş yapın
            </button>
          </form>
        )}

        {mode === 'otp-verify' && (
          <form onSubmit={verifyOtp} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Doğrulama kodu</label>
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
              {loading ? 'Doğrulanıyor...' : 'Doğrula ve giriş yap'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
