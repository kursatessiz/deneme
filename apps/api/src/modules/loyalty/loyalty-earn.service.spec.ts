import { isBirthday } from './loyalty-earn.service';

describe('isBirthday', () => {
  const birth = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it('matches month and day of the stored calendar date', () => {
    expect(isBirthday(birth('1990-10-05'), { year: 2026, month: 10, day: 5 })).toBe(true);
    expect(isBirthday(birth('1990-10-05'), { year: 2026, month: 10, day: 6 })).toBe(false);
  });

  it('celebrates 29 February on 28 February in common years only', () => {
    expect(isBirthday(birth('1992-02-29'), { year: 2027, month: 2, day: 28 })).toBe(true);
    expect(isBirthday(birth('1992-02-29'), { year: 2028, month: 2, day: 28 })).toBe(false);
    expect(isBirthday(birth('1992-02-29'), { year: 2028, month: 2, day: 29 })).toBe(true);
  });
});
