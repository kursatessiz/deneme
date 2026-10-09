import { JobsService } from './jobs.service';

/** Builds a JobsService whose 25 step services are stubs; every step rejects unless overridden, so the fallbacks are exercised. */
function build(overrides: Record<string, Record<string, jest.Mock>> = {}) {
  const errors = { capture: jest.fn() };
  const stub = (name: string, method: string) => {
    const obj: Record<string, jest.Mock> = { [method]: jest.fn().mockRejectedValue(new Error('stub failure')) };
    return { ...obj, ...(overrides[name] ?? {}) };
  };
  const args = [
    stub('growth', 'run'),
    stub('dunning', 'runDueRenewals'),
    stub('consent', 'syncPendingConsents'),
    stub('churn', 'recomputeStale'),
    stub('ratingPrompts', 'promptRecentAttendees'),
    stub('referrals', 'recomputeOpen'),
    stub('webhookDispatcher', 'dispatchDue'),
    stub('partnerSync', 'runSync'),
    stub('joinReminders', 'sendDueReminders'),
    stub('smsProviderBalance', 'checkIfDue'),
    stub('crm', 'sweepLapsed'),
    stub('conversionDelivery', 'dispatchDue'),
    stub('adSpendSync', 'syncAllDueIfStale'),
    stub('leadAds', 'processDue'),
    stub('aiTranslation', 'processPending'),
    stub('marketingInsights', 'runWeekly'),
    stub('loyalty', 'run'),
    stub('events', 'run'),
    stub('billing', 'run'),
    stub('payouts', 'run'),
    stub('errorReporting', 'run'),
    stub('backups', 'run'),
    stub('socialPublishing', 'processDue'),
    stub('oauthRefresh', 'processDue'),
    stub('emailDomains', 'processDue'),
    stub('members', 'releaseElapsedFreezes'),
    errors,
  ];
  const service = Reflect.construct(JobsService, args) as JobsService;
  return { service, errors, args };
}

describe('JobsService heartbeat', () => {
  const now = new Date('2026-10-09T10:00:00Z');

  it('keeps running the later steps when an earlier one throws, and captures the error', async () => {
    const dunning = { runDueRenewals: jest.fn().mockRejectedValue(new Error('provider down')) };
    const members = { releaseElapsedFreezes: jest.fn().mockResolvedValue({ released: 3 }) };
    const { service, errors } = build({ dunning, members });

    const result = await service.runAll(now);

    expect(result.dunning).toEqual([]);
    expect(result.packageFreezes).toEqual({ released: 3 });
    expect(members.releaseElapsedFreezes).toHaveBeenCalledWith(now);
    expect(errors.capture).toHaveBeenCalledWith(expect.objectContaining({ source: 'job', route: expect.stringContaining('dunning') }));
    expect(service.getLastRunAt()).toEqual(now);
  });

  it('logs the whole line (errors/backups text stays in the message, not the context argument)', async () => {
    const { service } = build();
    const log = jest.spyOn((service as unknown as { logger: { log: (...a: unknown[]) => void } }).logger, 'log').mockImplementation(() => undefined);
    await service.runAll(now);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]).toHaveLength(1);
    expect(String(log.mock.calls[0][0])).toContain('backups');
  });
});
