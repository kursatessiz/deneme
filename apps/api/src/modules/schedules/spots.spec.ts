import { deriveSpotStatus } from './spots';

describe('deriveSpotStatus', () => {
  it('returns MAINTENANCE regardless of occupants', () => {
    const result = deriveSpotStatus({
      isMaintenance: true,
      capacity: 1,
      occupants: [{ memberId: 'm1', memberName: 'Ayse Yilmaz' }],
      callerMemberId: 'm1',
    });
    expect(result.status).toBe('MAINTENANCE');
  });

  it('returns AVAILABLE for an empty single-capacity spot', () => {
    const result = deriveSpotStatus({
      isMaintenance: false,
      capacity: 1,
      occupants: [],
      callerMemberId: 'm1',
    });
    expect(result).toEqual({ status: 'AVAILABLE' });
  });

  it('returns MINE when the caller holds the spot', () => {
    const result = deriveSpotStatus({
      isMaintenance: false,
      capacity: 1,
      occupants: [{ memberId: 'm1', memberName: 'Ayse Yilmaz' }],
      callerMemberId: 'm1',
    });
    expect(result.status).toBe('MINE');
    expect(result.takenBy?.memberId).toBe('m1');
  });

  it('returns TAKEN with the occupant when someone else holds it', () => {
    const result = deriveSpotStatus({
      isMaintenance: false,
      capacity: 1,
      occupants: [{ memberId: 'm2', memberName: 'Deniz Kaya' }],
      callerMemberId: 'm1',
    });
    expect(result.status).toBe('TAKEN');
    expect(result.takenBy?.memberName).toBe('Deniz Kaya');
  });

  it('returns MINE for the caller even if the spot is over its capacity', () => {
    const result = deriveSpotStatus({
      isMaintenance: false,
      capacity: 1,
      occupants: [
        { memberId: 'm2', memberName: 'Deniz Kaya' },
        { memberId: 'm1', memberName: 'Ayse Yilmaz' },
      ],
      callerMemberId: 'm1',
    });
    expect(result.status).toBe('MINE');
  });

  it('treats staff without a member profile as never MINE', () => {
    const result = deriveSpotStatus({
      isMaintenance: false,
      capacity: 1,
      occupants: [],
      callerMemberId: null,
    });
    expect(result.status).toBe('AVAILABLE');
  });

  it('is AVAILABLE below a multi-capacity resource, TAKEN once full', () => {
    const below = deriveSpotStatus({
      isMaintenance: false,
      capacity: 2,
      occupants: [{ memberId: 'm2', memberName: 'Deniz Kaya' }],
      callerMemberId: 'm1',
    });
    expect(below.status).toBe('AVAILABLE');

    const full = deriveSpotStatus({
      isMaintenance: false,
      capacity: 2,
      occupants: [
        { memberId: 'm2', memberName: 'Deniz Kaya' },
        { memberId: 'm3', memberName: 'Can Ozturk' },
      ],
      callerMemberId: 'm1',
    });
    expect(full.status).toBe('TAKEN');
  });
});
