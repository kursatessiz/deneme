'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { resolveTheme, themeCssVariables, THEME_FAMILY_KEYS, DEFAULT_THEME_FAMILY, STUDIO_SLUG_PATTERN } from '@platform/shared';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import type { ThemeFamilyKey } from '@platform/shared';

function toThemeFamilyKey(value: string): ThemeFamilyKey {
  return (THEME_FAMILY_KEYS as readonly string[]).includes(value) ? (value as ThemeFamilyKey) : DEFAULT_THEME_FAMILY;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
/** Expo scheme, see apps/mobile/app.json "scheme". */
const MOBILE_APP_SCHEME = 'platform';

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
  const res = await fetch(`${API_BASE_URL}/public/studios/${encodeURIComponent(slug)}/embed/${path}`, {
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
 * page embeds via public/embed.js. It never books or cancels anything
 * itself: a third-party page has no way to authenticate as a member, so a
 * write endpoint here would let anyone who knows a phone number book or
 * cancel sessions on that member's behalf (see docs/PUBLIC_API.md "Embed
 * widget neden doğrudan rezervasyon yapmaz"). Reads go through
 * `/public/studios/:slug/embed/*` (unauthenticated, IP rate-limited, never
 * returns member/booking data); the "existing member" path opens the member
 * app via deep link, and the "first-time visitor" path submits the
 * existing public lead form (see apps/api/src/modules/leads).
 */
export default function EmbedBookingPage() {
  const params = useParams();
  const rawSlug = params.studioSlug as string;
  const slug = STUDIO_SLUG_PATTERN.test(rawSlug) ? rawSlug : '';

  const [config, setConfig] = useState<EmbedConfig | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<'choose' | 'lead'>('choose');
  const [leadName, setLeadName] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadConsent, setLeadConsent] = useState(false);
  const [leadWebsite, setLeadWebsite] = useState(''); // honeypot, real visitors never fill this
  const [leadStatus, setLeadStatus] = useState<'idle' | 'submitting' | 'submitted'>('idle');
  const [leadError, setLeadError] = useState<string | null>(null);

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
  }, [status, schedules.length, mode, leadStatus]);

  const serviceTypeName = (id: string) => serviceTypes.find((s) => s.id === id)?.name ?? '';
  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? '';
  const selectedSchedule = schedules.find((s) => s.id === selectedScheduleId) ?? null;

  /**
   * Opens the member app's own session screen (apps/mobile
   * app/(app)/seans/[scheduleId].tsx) via its Expo deep link scheme. Booking
   * itself only ever happens there, where the member is already
   * authenticated. There is no delayed-deep-link / app-store fallback page
   * yet (the `/j/<token>` universal link described in CLAUDE.md is for
   * invites, not this flow) -- on a device without the app installed this
   * link simply does nothing, which is documented in docs/PUBLIC_API.md.
   */
  const openMemberApp = () => {
    // Only a well-formed session id ever goes into the deep link.
    if (!selectedScheduleId || !UUID_PATTERN.test(selectedScheduleId)) return;
    window.location.href = `${MOBILE_APP_SCHEME}://seans/${encodeURIComponent(selectedScheduleId)}`;
  };

  const submitLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadConsent || leadName.trim().length < 2 || leadPhone.trim().length < 8) return;
    setLeadStatus('submitting');
    setLeadError(null);
    try {
      const interest = selectedSchedule
        ? `Web widget üzerinden deneme dersi talebi: ${serviceTypeName(selectedSchedule.serviceTypeId)} - ${formatTime(selectedSchedule.startTime)}${selectedSchedule.branchId ? ` (${branchName(selectedSchedule.branchId)})` : ''}`
        : 'Web widget üzerinden deneme dersi talebi';
      await fetch(`${API_BASE_URL}/public/studios/${encodeURIComponent(slug)}/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: leadName.trim(),
          phone: leadPhone.trim(),
          interest,
          consent: true,
          website: leadWebsite,
        }),
      });
      // The lead endpoint always answers 202, whatever happened, so the
      // widget cannot be used to probe which phone numbers are known.
      setLeadStatus('submitted');
    } catch {
      // Network-level failure only (the endpoint itself never errors).
      setLeadError('Gönderilemedi, lütfen tekrar deneyin.');
      setLeadStatus('idle');
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

        {status === 'idle' && (
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                Seans seçin
              </label>
              <select
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
              <p className="mt-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                Bu, yalnızca bir zaman/hizmet seçimidir; rezervasyon bu sayfada oluşturulmaz.
              </p>
            </div>

            {mode === 'choose' && (
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={!selectedScheduleId}
                  onClick={openMemberApp}
                  className="w-full py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: 'var(--gradient-brand)', borderRadius: 'var(--radius-button)', color: 'var(--color-on-primary)' }}
                >
                  Üyeyim, uygulamada rezervasyon yapacağım
                </button>
                <button
                  type="button"
                  disabled={!selectedScheduleId}
                  onClick={() => setMode('lead')}
                  className="w-full border py-2.5 text-sm font-semibold disabled:opacity-60"
                  style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-button)', color: 'var(--color-text-primary)' }}
                >
                  İlk kez geliyorum, benimle iletişime geçin
                </button>
              </div>
            )}

            {mode === 'lead' && leadStatus !== 'submitted' && (
              <form onSubmit={submitLead} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                    Ad soyad
                  </label>
                  <input
                    required
                    value={leadName}
                    onChange={(e) => setLeadName(e.target.value)}
                    className="w-full border px-3 py-2 text-sm"
                    style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)', background: 'var(--color-surface)', color: 'var(--color-text-primary)' }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                    Telefon numaranız
                  </label>
                  <input
                    required
                    type="tel"
                    placeholder="+90 5xx xxx xx xx"
                    value={leadPhone}
                    onChange={(e) => setLeadPhone(e.target.value)}
                    className="w-full border px-3 py-2 text-sm"
                    style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)', background: 'var(--color-surface)', color: 'var(--color-text-primary)' }}
                  />
                </div>
                {/* Honeypot: hidden from real visitors via CSS, bots often fill every field. */}
                <input
                  type="text"
                  value={leadWebsite}
                  onChange={(e) => setLeadWebsite(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
                />
                <label className="flex items-start gap-2 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                  <input type="checkbox" checked={leadConsent} onChange={(e) => setLeadConsent(e.target.checked)} required className="mt-0.5" />
                  Bu bilgilerin işletme tarafından benimle iletişime geçmek için kullanılmasına izin veriyorum.
                </label>
                {leadError && (
                  <p className="text-xs" style={{ color: '#b42318' }}>
                    {leadError}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMode('choose')}
                    className="flex-1 border py-2.5 text-sm font-semibold"
                    style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-button)', color: 'var(--color-text-primary)' }}
                  >
                    Geri
                  </button>
                  <button
                    type="submit"
                    disabled={leadStatus === 'submitting' || !leadConsent}
                    className="flex-1 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                    style={{ background: 'var(--gradient-brand)', borderRadius: 'var(--radius-button)', color: 'var(--color-on-primary)' }}
                  >
                    {leadStatus === 'submitting' ? 'Gönderiliyor...' : 'Gönder'}
                  </button>
                </div>
              </form>
            )}

            {mode === 'lead' && leadStatus === 'submitted' && (
              <div className="space-y-2">
                <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  Talebiniz alındı.
                </p>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  Ekibimiz en kısa sürede sizinle iletişime geçecek.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
