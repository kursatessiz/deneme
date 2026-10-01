'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { PRODUCT_NAME, STUDIO_SLUG_PATTERN } from '@platform/shared';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import { ThemeRoot } from '@/components/theme/ThemeRoot';
import { PoweredByBadge } from '@/components/branding/PoweredByBadge';
import { Button, Card, CardContent, ChipButton, Checkbox, FieldGroup, Input, Radio, Select, Skeleton } from '@/components/ui';
import { publicApiBaseUrl } from '@/lib/public-api-url';
import { embedFetch, openMemberAppSession, scheduleTimeZone } from '@/lib/public-booking';
import type { EmbedBranch, EmbedConfig, EmbedScheduleItem, EmbedServiceType } from '@/lib/public-booking';
import { trackingHeaders } from '@/lib/tracking/client';
import { createZonedFormatters } from '@/lib/zoned-time';
import type { ZonedFormatters } from '@/lib/zoned-time';

/** How many days ahead the page lists sessions; same window as the embeddable widget. */
const WINDOW_DAYS = 14;

/**
 * Public booking page of a studio. It reads the same unauthenticated embed
 * endpoints as the embeddable widget (config, branches, service types,
 * schedules) and, like the widget, never creates a booking itself: a
 * visitor has no way to authenticate here, so a write endpoint would let
 * anyone book on a member's behalf (docs/PUBLIC_API.md). A member continues
 * in the member app through a deep link; a first-time visitor leaves their
 * contact through the public lead form.
 */
export default function PublicBookingPage() {
  const t = useT();
  const locale = useLocale();
  const params = useParams();
  const rawSlug = params.studioSlug as string;
  const slug = STUDIO_SLUG_PATTERN.test(rawSlug) ? rawSlug : '';

  const [config, setConfig] = useState<EmbedConfig | null>(null);
  const [branches, setBranches] = useState<EmbedBranch[]>([]);
  const [serviceTypes, setServiceTypes] = useState<EmbedServiceType[]>([]);
  const [schedules, setSchedules] = useState<EmbedScheduleItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const [serviceFilter, setServiceFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [selectedDay, setSelectedDay] = useState('');
  const [selectedScheduleId, setSelectedScheduleId] = useState('');

  const [mode, setMode] = useState<'choose' | 'lead'>('choose');
  const [leadName, setLeadName] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadConsent, setLeadConsent] = useState(false);
  const [leadWebsite, setLeadWebsite] = useState(''); // honeypot, real visitors never fill this
  const [leadStatus, setLeadStatus] = useState<'idle' | 'submitting' | 'submitted'>('idle');
  const [leadError, setLeadError] = useState(false);

  useEffect(() => {
    if (!slug) {
      setStatus('error');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const now = new Date();
        const to = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
        const [cfg, branchList, serviceTypeList, scheduleList] = await Promise.all([
          embedFetch<EmbedConfig>(slug, 'config'),
          embedFetch<EmbedBranch[]>(slug, 'branches'),
          embedFetch<EmbedServiceType[]>(slug, 'service-types'),
          embedFetch<EmbedScheduleItem[]>(slug, `schedules?from=${encodeURIComponent(now.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
        ]);
        if (cancelled) return;
        setConfig(cfg);
        setBranches(branchList);
        setServiceTypes(serviceTypeList);
        setSchedules(scheduleList.filter((s) => s.bookedCount < s.capacity));
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const serviceName = (id: string) => serviceTypes.find((s) => s.id === id)?.name ?? '';
  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? '';

  // Every date and time is shown on the clock of the session's branch (its zone, else the studio's), never the visitor's.
  const fmt = useMemo(() => {
    const cache = new Map<string, ZonedFormatters>();
    return (s: EmbedScheduleItem): ZonedFormatters => {
      const zone = scheduleTimeZone(s, branches, config);
      const key = zone ?? '';
      let formatters = cache.get(key);
      if (!formatters) {
        formatters = createZonedFormatters(locale, zone);
        cache.set(key, formatters);
      }
      return formatters;
    };
  }, [locale, branches, config]);
  const durationFormat = useMemo(() => new Intl.NumberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: 'short' }), [locale]);

  const filtered = useMemo(
    () => schedules.filter((s) => (!serviceFilter || s.serviceTypeId === serviceFilter) && (!branchFilter || s.branchId === branchFilter)),
    [schedules, serviceFilter, branchFilter],
  );
  const days = useMemo(() => Array.from(new Set(filtered.map((s) => fmt(s).dayKey(s.startTime)))), [filtered, fmt]);
  const activeDay = days.includes(selectedDay) ? selectedDay : (days[0] ?? '');
  const slots = filtered.filter((s) => fmt(s).dayKey(s.startTime) === activeDay);
  // The zone name is shown once per day group; only a day mixing branches in different zones names it per slot.
  const zoneNames = Array.from(new Set(slots.map((s) => fmt(s).zoneName(s.startTime)).filter(Boolean)));
  const dateTimeLabel = (s: EmbedScheduleItem) => {
    const f = fmt(s);
    return `${f.dateTime(s.startTime)} ${f.zoneName(s.startTime)}`.trim();
  };
  const selected = schedules.find((s) => s.id === selectedScheduleId && slots.some((x) => x.id === s.id)) ?? null;

  const submitLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadConsent || leadName.trim().length < 2 || leadPhone.trim().length < 8) return;
    setLeadStatus('submitting');
    setLeadError(false);
    try {
      const interest = selected
        ? t('booking.lead.interestWithSchedule', { service: serviceName(selected.serviceTypeId), time: dateTimeLabel(selected) }) +
          (selected.branchId ? t('booking.lead.interestWithBranch', { branch: branchName(selected.branchId) }) : '')
        : t('booking.lead.interestNoSchedule');
      await fetch(`${publicApiBaseUrl()}/public/studios/${encodeURIComponent(slug)}/leads`, {
        method: 'POST',
        // X-PW-VID links this visitor's tracked visits to the new contact (only present after consent).
        headers: { 'Content-Type': 'application/json', ...trackingHeaders() },
        body: JSON.stringify({ fullName: leadName.trim(), phone: leadPhone.trim(), interest, consent: true, website: leadWebsite }),
      });
      // The lead endpoint always answers 202, whatever happened, so the page cannot be used to probe which phone numbers are known.
      setLeadStatus('submitted');
    } catch {
      setLeadError(true);
      setLeadStatus('idle');
    }
  };

  return (
    <ThemeRoot
      tenantTheme={config ? { themeFamily: config.themeFamily, themePrimary: config.themePrimary, gradientPresetKey: config.gradientPresetKey, logoUrl: config.logoUrl, allowedThemeFamilies: config.allowedThemeFamilies } : null}
      appearance={{ colorScheme: 'SYSTEM' }}
    >
      <main className="px-4 py-8 sm:py-12">
        <Card className="mx-auto w-full max-w-xl">
          <CardContent className="gap-5 p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {config?.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={config.logoUrl} alt="" height={32} decoding="async" className="h-8 object-contain" />
                )}
                <h1 className="ui-title">{config?.name ?? t('booking.defaultTitle')}</h1>
              </div>
              <LanguageSwitcher mode="cookie" className="pui-input ui-btn-sm w-auto" />
            </div>
            <p className="ui-text-muted">{t('booking.intro')}</p>

            {status === 'loading' && (
              <div className="grid gap-3" role="status" aria-label={t('booking.loading')}>
                <Skeleton width="40%" height="1rem" />
                <Skeleton height="2.5rem" />
                <Skeleton height="2.5rem" />
              </div>
            )}

            {status === 'error' && <p className="ui-alert">{t('booking.errors.loadFailed')}</p>}

            {status === 'ready' && (
              <div className="grid gap-5">
                <div className="grid gap-2">
                  <span className="ui-caption ui-strong">{t('booking.serviceType')}</span>
                  <div className="flex flex-wrap gap-2">
                    <ChipButton selected={serviceFilter === ''} onClick={() => setServiceFilter('')}>
                      {t('booking.allServices')}
                    </ChipButton>
                    {serviceTypes.map((s) => (
                      <ChipButton key={s.id} selected={serviceFilter === s.id} onClick={() => setServiceFilter(s.id)}>
                        {s.name}
                        <span className="ui-caption">{durationFormat.format(s.durationMin)}</span>
                      </ChipButton>
                    ))}
                  </div>
                </div>

                {branches.length > 1 && (
                  <FieldGroup label={t('booking.branch')}>
                    <Select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
                      <option value="">{t('booking.allBranches')}</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  </FieldGroup>
                )}

                {days.length === 0 ? (
                  <p className="ui-panel p-4 ui-text-muted">{t('booking.noSlots')}</p>
                ) : (
                  <>
                    <div className="grid gap-2">
                      <span className="ui-caption ui-strong">{t('booking.dateSelection')}</span>
                      <div className="flex flex-wrap gap-2">
                        {days.map((d) => {
                          const first = filtered.find((s) => fmt(s).dayKey(s.startTime) === d);
                          return (
                            <ChipButton key={d} selected={d === activeDay} className="ui-capitalize" onClick={() => setSelectedDay(d)}>
                              {first ? fmt(first).day(first.startTime) : d}
                            </ChipButton>
                          );
                        })}
                      </div>
                    </div>

                    <fieldset className="grid gap-2">
                      <legend className="ui-caption ui-strong mb-2">{t('booking.availableSlots')}</legend>
                      {zoneNames.length === 1 && <p className="ui-caption ui-text-muted">{t('booking.timeZone', { zone: zoneNames[0] })}</p>}
                      {slots.map((s) => (
                        <label key={s.id} className="ui-choice flex items-center justify-between gap-3">
                          <span className="flex items-center gap-3">
                            <Radio name="timeSlot" checked={selectedScheduleId === s.id} onChange={() => setSelectedScheduleId(s.id)} />
                            <span className="grid">
                              <span className="ui-strong">
                                {fmt(s).time(s.startTime)} - {fmt(s).time(s.endTime)}
                                {zoneNames.length > 1 ? ` ${fmt(s).zoneName(s.startTime)}` : ''}
                              </span>
                              <span className="ui-caption">
                                {serviceName(s.serviceTypeId) || s.title}
                                {branches.length > 1 && s.branchId ? ` (${branchName(s.branchId)})` : ''}
                              </span>
                            </span>
                          </span>
                          <span className="ui-caption">{t('booking.spotsLeft', { count: s.capacity - s.bookedCount })}</span>
                        </label>
                      ))}
                    </fieldset>
                  </>
                )}

                {selected && mode === 'choose' && (
                  <div className="grid gap-3 ui-rule pt-4">
                    <p className="ui-strong">{t('booking.selected', { service: serviceName(selected.serviceTypeId) || selected.title, time: dateTimeLabel(selected) })}</p>
                    <p className="ui-caption">{t('booking.selectionHint')}</p>
                    <Button block onClick={() => openMemberAppSession(selected.id)}>
                      {t('booking.openApp')}
                    </Button>
                    <Button block variant="outline" tone="surface" onClick={() => setMode('lead')}>
                      {t('booking.firstTime')}
                    </Button>
                  </div>
                )}

                {mode === 'lead' && leadStatus !== 'submitted' && (
                  <form onSubmit={submitLead} className="grid gap-3 ui-rule pt-4">
                    <FieldGroup label={t('booking.lead.fullName')}>
                      <Input required value={leadName} onChange={(e) => setLeadName(e.target.value)} />
                    </FieldGroup>
                    <FieldGroup label={t('booking.lead.phone')}>
                      <Input required type="tel" placeholder="+90 5xx xxx xx xx" value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} />
                    </FieldGroup>
                    {/* Honeypot: hidden from real visitors off-screen, bots often fill every field. */}
                    <input
                      type="text"
                      value={leadWebsite}
                      onChange={(e) => setLeadWebsite(e.target.value)}
                      tabIndex={-1}
                      autoComplete="off"
                      aria-hidden="true"
                      style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
                    />
                    <Checkbox checked={leadConsent} onChange={(e) => setLeadConsent(e.target.checked)} required className="items-start" label={<span className="ui-caption">{t('booking.lead.consent')}</span>} />
                    {leadError && <p className="ui-caption ui-text-error">{t('booking.lead.error')}</p>}
                    <div className="flex gap-2">
                      <Button variant="outline" tone="surface" className="flex-1" onClick={() => setMode('choose')}>
                        {t('booking.lead.back')}
                      </Button>
                      <Button type="submit" className="flex-1" disabled={leadStatus === 'submitting' || !leadConsent}>
                        {leadStatus === 'submitting' ? t('booking.lead.sending') : t('booking.lead.send')}
                      </Button>
                    </div>
                  </form>
                )}

                {mode === 'lead' && leadStatus === 'submitted' && (
                  <div className="grid gap-1 ui-rule pt-4" role="status">
                    <p className="ui-strong">{t('booking.lead.submittedTitle')}</p>
                    <p className="ui-caption">{t('booking.lead.submittedDescription')}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        {config?.showPoweredBy && (
          <div className="mx-auto w-full max-w-xl pt-4 text-center">
            <PoweredByBadge href={config.poweredByUrl} label={t('branding.poweredBy', { product: PRODUCT_NAME })} />
          </div>
        )}
      </main>
    </ThemeRoot>
  );
}
