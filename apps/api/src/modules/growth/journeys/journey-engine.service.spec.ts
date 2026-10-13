import { JourneyEngineService, PROCESS_DUE_BUDGET_MS } from './journey-engine.service';

function build(ids: string[]) {
  const prisma = { journeyEnrollment: { findMany: jest.fn(async () => ids.map((id) => ({ id }))) } };
  const service = new JourneyEngineService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { service, prisma };
}

describe('JourneyEngineService.processDue time budget', () => {
  afterEach(() => jest.restoreAllMocks());

  it('processes every due enrollment within the budget', async () => {
    const { service } = build(['e1', 'e2', 'e3']);
    const spy = jest.spyOn(service, 'processEnrollment').mockResolvedValue({ steps: 2, finished: true });
    expect(await service.processDue(new Date())).toEqual({ advanced: 6, completed: 3 });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('stops taking new enrollments once the budget is spent', async () => {
    const { service } = build(['e1', 'e2', 'e3']);
    let clock = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    const spy = jest.spyOn(service, 'processEnrollment').mockImplementation(async () => {
      clock += PROCESS_DUE_BUDGET_MS;
      return { steps: 1, finished: false };
    });
    expect(await service.processDue(new Date())).toEqual({ advanced: 1, completed: 0 });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
