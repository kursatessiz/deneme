import { CreateScheduleSchema, SellPackageSchema } from '@platform/shared';

import { fieldErrorsFromZod } from './formErrors';

describe('fieldErrorsFromZod with the shared schedule schema', () => {
  it('reports a message per invalid field for an incomplete session form', () => {
    const result = CreateScheduleSchema.safeParse({
      studioId: 'not-a-uuid',
      serviceTypeId: 'not-a-uuid',
      title: 'ab',
      startTime: 'not-a-date',
      endTime: 'not-a-date',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const errors = fieldErrorsFromZod(result.error);
    expect(errors.studioId).toBeDefined();
    expect(errors.title).toBeDefined();
    expect(errors.startTime).toBeDefined();
  });

  it('accepts a valid session and reports no errors', () => {
    const result = CreateScheduleSchema.safeParse({
      studioId: '11111111-1111-1111-1111-111111111111',
      serviceTypeId: '22222222-2222-2222-2222-222222222222',
      title: 'Reformer sabah',
      startTime: '2026-04-01T09:00:00.000Z',
      endTime: '2026-04-01T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('flags a session ending before it starts', () => {
    const result = CreateScheduleSchema.safeParse({
      studioId: '11111111-1111-1111-1111-111111111111',
      serviceTypeId: '22222222-2222-2222-2222-222222222222',
      title: 'Reformer sabah',
      startTime: '2026-04-01T10:00:00.000Z',
      endTime: '2026-04-01T09:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrorsFromZod(result.error).endTime).toBeDefined();
  });
});

describe('fieldErrorsFromZod with the shared sell-package schema', () => {
  it('rejects a negative paid amount', () => {
    const result = SellPackageSchema.safeParse({
      studioId: '11111111-1111-1111-1111-111111111111',
      memberId: '22222222-2222-2222-2222-222222222222',
      packageDefinitionId: '33333333-3333-3333-3333-333333333333',
      paymentMethod: 'CASH',
      paidAmount: -10,
      currency: 'TRY',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrorsFromZod(result.error).paidAmount).toBeDefined();
  });
});
