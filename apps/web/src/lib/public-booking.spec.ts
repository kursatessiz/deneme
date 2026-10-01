import { scheduleTimeZone } from './public-booking';

const branches = [
  { id: 'b1', name: 'One', timezone: 'Asia/Tokyo' },
  { id: 'b2', name: 'Two', timezone: null },
];

describe('scheduleTimeZone', () => {
  it('uses the branch zone, then the studio zone', () => {
    expect(scheduleTimeZone({ branchId: 'b1' }, branches, { timezone: 'Europe/Istanbul' })).toBe('Asia/Tokyo');
    expect(scheduleTimeZone({ branchId: 'b2' }, branches, { timezone: 'Europe/Istanbul' })).toBe('Europe/Istanbul');
    expect(scheduleTimeZone({ branchId: null }, branches, { timezone: 'Europe/Istanbul' })).toBe('Europe/Istanbul');
  });

  it('leaves the zone to the viewer when nothing usable is known', () => {
    expect(scheduleTimeZone({ branchId: 'b2' }, branches, null)).toBeUndefined();
    expect(scheduleTimeZone({ branchId: 'b2' }, branches, { timezone: 'Not/AZone' })).toBeUndefined();
  });
});
