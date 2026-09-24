'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { resolveTheme, themeCssVariables, THEME_FAMILY_KEYS, DEFAULT_THEME_FAMILY } from '@platform/shared';
import type { ThemeFamilyKey } from '@platform/shared';

function toThemeFamilyKey(value: string): ThemeFamilyKey {
  return (THEME_FAMILY_KEYS as readonly string[]).includes(value) ? (value as ThemeFamilyKey) : DEFAULT_THEME_FAMILY;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface EmbedConfig {
  name: string;
  logoUrl: string | null;
  themeFamily: string;
  themePrimary: string;
  gradientPresetKey: string;
}

interface Branch {
  id: string;
  name: string;
}

interface ServiceType {
  id: string;
  name: string;
  durationMin: number;
}

interface ScheduleItem {
  id: string;
  branchId: string | null;
  serviceTypeId: string;
  title: string;
  startTime: string;
  endTime: string;
  capacity: number;
  bookedCount: number;
}

async function embedFetch<T>(slug: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/public/studios/${slug}/embed/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? 'Bir hata oluştu');
  }
  return res.json();
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('tr-TR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Script-free-for-host booking widget, rendered inside an iframe the host
 * page embeds via public/embed.js. Talks only to the unauthenticated,
 * rate-limited `/public/studios/:slug/embed/*` endpoints (see
 * apps/api/src/modules/public-api/embed-public.controller.ts) -- never an
 * API key, which cannot be kept secret in browser-visible code.
 */
export default function EmbedBookingPage() {
  const params = useParams();
  const slug = params.studioSlug as string;

  const [config, setConfig] = useState<EmbedConfig | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'submitting' | 'confirmed' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const theme = useMemo(
    () =>
      resolveTheme({
        tenant: config
          ? {
              themeFamily: toThemeFamilyKey(config.themeFamily),
              themePrimary: config.themePrimary,
              gradientPresetKey: config.gradientPresetKey,
              logoUrl: config.logoUrl,
            }
          : null,
        appearance: null,
        systemMode: 'light',
      }),
    [config],
  );

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const now = new Date();
        const to = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
        const [cfg, branchList, serviceTypeList, scheduleList] = await Promise.all([
          embedFetch<EmbedConfig>(slug, 'config'),
          embedFetch<Branch[]>(slug, 'branches'),
          embedFetch<ServiceType[]>(slug, 'service-types'),
          embedFetch<ScheduleItem[]>(slug, `schedules?from=${now.toISOString()}&to=${to.toISOString()}`),
        ]);
        setConfig(cfg);
        setBranches(branchList);
        setServiceTypes(serviceTypeList);
        setSchedules(scheduleList.filter((s) => s.bookedCount < s.capacity));
        setStatus('idle');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Bilgiler yüklenemedi');
        setStatus('error');
      }
    })();
  }, [slug]);

  // Auto-resize the host page's iframe: tell it our content height whenever it changes.
  useEffect(() => {
    const send = () => {
      window.parent?.postMessage({ type: 'platform-embed-resize', height: document.documentElement.scrollHeight }, '*');
    };
    send();
    const observer = new ResizeObserver(send);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, [status, schedules.length]);

  const serviceTypeName = (id: string) => serviceTypes.find((s) => s.id === id)?.name ?? '';
  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedScheduleId || phone.trim().length < 8) return;
    setStatus('submitting');
    setError(null);
    try {
      await embedFetch(slug, 'bookings', {
        method: 'POST',
        body: JSON.stringify({ scheduleId: selectedScheduleId, memberPhone: phone.trim(), resourceIds: [] }),
      });
      setStatus('confirmed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rezervasyon oluşturulamadı');
      setStatus('idle');
    }
  };

  const cssVars = themeCssVariables(theme) as React.CSSProperties;

  return (
    <div
      style={{ ...cssVars, background: 'var(--color-background)', color: 'var(--color-text-primary)' }}
      className="min-h-screen p-4"
    >
      <div
        className="mx-auto max-w-md rounded-2xl border p-5"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' }}
      >
        {config?.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={config.logoUrl} alt={config.name} className="mb-3 h-8 object-contain" />
        )}
        <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {config?.name ?? 'Online Rezervasyon'}
        </h1>

        {status === 'loading' && <p className="mt-4 text-sm" style={{ color: 'var(--color-text-muted)' }}>Yükleniyor...</p>}

        {status === 'error' && (
          <p className="mt-4 text-sm" style={{ color: '#b42318' }}>
            {error ?? 'Bilgiler yüklenemedi, lütfen daha sonra tekrar deneyin.'}
          </p>
        )}

        {status === 'confirmed' && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
              Rezervasyonunuz alındı.
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Seans saatinizi telefonunuza gönderdiğimiz bilgilendirmeden takip edebilirsiniz.
            </p>
          </div>
        )}

        {(status === 'idle' || status === 'submitting') && (
          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                Seans seçin
              </label>
              <select
                required
                value={selectedScheduleId}
                onChange={(e) => setSelectedScheduleId(e.target.value)}
                className="w-full border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)', background: 'var(--color-surface)', color: 'var(--color-text-primary)' }}
              >
                <option value="">Bir seans seçin</option>
                {schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatTime(s.startTime)} - {serviceTypeName(s.serviceTypeId)}
                    {s.branchId ? ` (${branchName(s.branchId)})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                Telefon numaranız (mevcut üyelik)
              </label>
              <input
                required
                type="tel"
                placeholder="+90 5xx xxx xx xx"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)', background: 'var(--color-surface)', color: 'var(--color-text-primary)' }}
              />
              <p className="mt-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                Bu widget yalnızca kayıtlı üyeler için rezervasyon oluşturur.
              </p>
            </div>

            {error && (
              <p className="text-xs" style={{ color: '#b42318' }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={status === 'submitting'}
              className="w-full py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: 'var(--gradient-brand)', borderRadius: 'var(--radius-button)', color: 'var(--color-on-primary)' }}
            >
              {status === 'submitting' ? 'Gönderiliyor...' : 'Rezervasyon Yap'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
