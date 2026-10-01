'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { resolveTheme, themeCssVariables, STUDIO_SLUG_PATTERN } from '@platform/shared';
import { trackingHeaders } from '@/lib/tracking/client';
import { Button, Card, CardContent, Checkbox, FieldGroup, Input, Select } from '@/components/ui';
import { publicApiBaseUrl } from '@/lib/public-api-url';
import { embedFetch, openMemberAppSession } from '@/lib/public-booking';
import type { EmbedBranch as Branch, EmbedConfig, EmbedScheduleItem as ScheduleItem, EmbedServiceType as ServiceType } from '@/lib/public-booking';

/** No signed-in session here: the locale comes from the root layout (cookie or Accept-Language), the same on server and client. */
function formatTime(iso: string, locale: string) {
  return new Date(iso).toLocaleString(locale, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
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
  const t = useT();
  const locale = useLocale();
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
              themeFamily: config.themeFamily,
              themePrimary: config.themePrimary,
              gradientPresetKey: config.gradientPresetKey,
              logoUrl: config.logoUrl,
              allowedThemeFamilies: config.allowedThemeFamilies,
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
        setError(err instanceof Error && err.message ? err.message : t('embed.errors.loadFailed'));
        setStatus('error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const openMemberApp = () => openMemberAppSession(selectedScheduleId);

  const submitLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadConsent || leadName.trim().length < 2 || leadPhone.trim().length < 8) return;
    setLeadStatus('submitting');
    setLeadError(null);
    try {
      const interest = selectedSchedule
        ? t('embed.leadInterest.withSchedule', { service: serviceTypeName(selectedSchedule.serviceTypeId), time: formatTime(selectedSchedule.startTime, locale) }) +
          (selectedSchedule.branchId ? t('embed.leadInterest.withBranch', { branch: branchName(selectedSchedule.branchId) }) : '')
        : t('embed.leadInterest.noSchedule');
      await fetch(`${publicApiBaseUrl()}/public/studios/${encodeURIComponent(slug)}/leads`, {
        method: 'POST',
        // X-PW-VID links this visitor's tracked visits to the new contact (only present after consent).
        headers: { 'Content-Type': 'application/json', ...trackingHeaders() },
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
      setLeadError(t('embed.errors.submitFailed'));
      setLeadStatus('idle');
    }
  };

  const cssVars = themeCssVariables(theme) as React.CSSProperties;

  return (
    <div style={{ ...cssVars, backgroundColor: 'var(--pui-bg-muted)', color: 'var(--pui-text)' }} className="min-h-screen p-4">
      <Card className="mx-auto max-w-md">
        <CardContent className="p-5">
          {config?.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={config.logoUrl} alt={config.name} className="h-8 object-contain" />
          )}
          <h1 className="ui-heading">{config?.name ?? t('embed.defaultTitle')}</h1>

          {status === 'loading' && <p className="ui-text-muted">{t('embed.loading')}</p>}

          {status === 'error' && <p className="ui-text-error">{error ?? t('embed.errors.loadFailedRetry')}</p>}

          {status === 'idle' && (
            <div className="grid gap-4">
              <FieldGroup label={t('embed.chooseSession')} hint={t('embed.selectionHint')}>
                <Select value={selectedScheduleId} onChange={(e) => setSelectedScheduleId(e.target.value)}>
                  <option value="">{t('embed.choosePlaceholder')}</option>
                  {schedules.map((s) => (
                    <option key={s.id} value={s.id}>
                      {formatTime(s.startTime, locale)} - {serviceTypeName(s.serviceTypeId)}
                      {s.branchId ? ` (${branchName(s.branchId)})` : ''}
                    </option>
                  ))}
                </Select>
              </FieldGroup>

              {mode === 'choose' && (
                <div className="grid gap-2">
                  <Button block disabled={!selectedScheduleId} onClick={openMemberApp}>
                    {t('embed.openApp')}
                  </Button>
                  <Button block variant="outline" tone="surface" disabled={!selectedScheduleId} onClick={() => setMode('lead')}>
                    {t('embed.firstTime')}
                  </Button>
                </div>
              )}

              {mode === 'lead' && leadStatus !== 'submitted' && (
                <form onSubmit={submitLead} className="grid gap-3">
                  <FieldGroup label={t('embed.fullName')}>
                    <Input required value={leadName} onChange={(e) => setLeadName(e.target.value)} />
                  </FieldGroup>
                  <FieldGroup label={t('embed.phone')}>
                    <Input required type="tel" placeholder="+90 5xx xxx xx xx" value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} />
                  </FieldGroup>
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
                  <Checkbox checked={leadConsent} onChange={(e) => setLeadConsent(e.target.checked)} required label={<span className="ui-caption">{t('embed.consent')}</span>} className="items-start" />
                  {leadError && <p className="ui-caption ui-text-error">{leadError}</p>}
                  <div className="flex gap-2">
                    <Button variant="outline" tone="surface" className="flex-1" onClick={() => setMode('choose')}>
                      {t('embed.back')}
                    </Button>
                    <Button type="submit" className="flex-1" disabled={leadStatus === 'submitting' || !leadConsent}>
                      {leadStatus === 'submitting' ? t('embed.sending') : t('embed.send')}
                    </Button>
                  </div>
                </form>
              )}

              {mode === 'lead' && leadStatus === 'submitted' && (
                <div className="grid gap-2">
                  <p className="ui-strong">{t('embed.submitted.title')}</p>
                  <p className="ui-caption">{t('embed.submitted.description')}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
