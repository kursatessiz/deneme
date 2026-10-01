import { eventDetailPath, eventSegment, eventsListPath, parseEventSegment, slugifyTitle } from './paths';

const ID = '3f2a9c1e-5b7d-4e8a-9c3b-1a2b3c4d5e6f';

describe('event url segments', () => {
  it('slugifies titles, folding Turkish letters', () => {
    expect(slugifyTitle('Hafta sonu atölyesi')).toBe('hafta-sonu-atolyesi');
    expect(slugifyTitle('ÇIĞLIK Şölen İstanbul')).toBe('ciglik-solen-istanbul');
    expect(slugifyTitle('  Yoga & Nefes!  ')).toBe('yoga-nefes');
    expect(slugifyTitle('日本語')).toBe('');
    expect(slugifyTitle('a'.repeat(100)).length).toBeLessThanOrEqual(60);
  });

  it('builds a segment with the id at the end, or the bare id when the title has no latin letters', () => {
    expect(eventSegment({ id: ID, title: 'Hafta sonu atölyesi' })).toBe(`hafta-sonu-atolyesi-${ID}`);
    expect(eventSegment({ id: ID, title: '日本語' })).toBe(ID);
  });

  it('reads the id back from a slug-id segment or a bare id', () => {
    expect(parseEventSegment(`hafta-sonu-atolyesi-${ID}`)).toBe(ID);
    expect(parseEventSegment(ID)).toBe(ID);
    expect(parseEventSegment(ID.toUpperCase())).toBe(ID);
  });

  it('rejects segments without a trailing id or with a malformed prefix', () => {
    expect(parseEventSegment('hafta-sonu-atolyesi')).toBeNull();
    expect(parseEventSegment(`..%2f-${ID}`)).toBeNull();
    expect(parseEventSegment(`x${ID}`)).toBeNull();
    expect(parseEventSegment('')).toBeNull();
  });

  it('chooses the path by host kind', () => {
    expect(eventsListPath('zen', true)).toBe('/events');
    expect(eventsListPath('zen', false)).toBe('/events/zen');
    expect(eventDetailPath('zen', true, { id: ID, title: 'Yoga' })).toBe(`/events/yoga-${ID}`);
    expect(eventDetailPath('zen', false, { id: ID, title: 'Yoga' })).toBe(`/events/zen/yoga-${ID}`);
  });
});
