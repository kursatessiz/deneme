import { FEEDBACK_MAX_LENGTH, createMobileReporter, submitErrorFeedback } from './reporterCore';
import { BreadcrumbBuffer } from './breadcrumbs';
import { FakeStorage } from './testing';

describe('error feedback box (H3)', () => {
  const EVENT_ID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';

  it('scrubs personal data before sending and reports success', async () => {
    const sent: Array<{ id: string; feedback: string; sessionId?: string }> = [];
    const result = await submitErrorFeedback(
      EVENT_ID,
      'I pressed Save. Write to ada@example.com or call +90 532 123 45 67',
      async (id, body) => {
        sent.push({ id, ...body });
        return true;
      },
      'a'.repeat(16),
    );
    expect(result).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0].id).toBe(EVENT_ID);
    expect(sent[0].feedback).toContain('I pressed Save');
    expect(sent[0].feedback).toContain('[email]');
    expect(sent[0].feedback).toContain('[phone]');
    expect(sent[0].feedback).not.toContain('ada@example.com');
    expect(sent[0].sessionId).toBe('a'.repeat(16));
  });

  it('cuts the note to 500 characters', async () => {
    let feedback = '';
    await submitErrorFeedback(EVENT_ID, 'x'.repeat(3000), async (_id, body) => {
      feedback = body.feedback;
      return true;
    });
    expect(FEEDBACK_MAX_LENGTH).toBe(500);
    expect(feedback).toHaveLength(500);
  });

  it('does not call the API for an empty note', async () => {
    let calls = 0;
    const result = await submitErrorFeedback(EVENT_ID, '   \n ', async () => {
      calls++;
      return true;
    });
    expect(result).toBe('empty');
    expect(calls).toBe(0);
  });

  it('reports a failed or throwing send as failed', async () => {
    expect(await submitErrorFeedback(EVENT_ID, 'note', async () => false)).toBe('failed');
    expect(
      await submitErrorFeedback(EVENT_ID, 'note', async () => {
        throw new Error('offline');
      }),
    ).toBe('failed');
  });

  it('hands the screen the event id of the reported error', () => {
    const reporter = createMobileReporter({
      storage: new FakeStorage(),
      send: async () => 'sent',
      breadcrumbs: new BreadcrumbBuffer(() => 1_700_000_000_000),
      getContext: () => ({ release: '1.0.0', environment: 'test', route: null }),
      schedule: () => 0,
    });
    const error = new Error('boom');
    const first = reporter.report(error);
    expect(first.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.code).toBe(first.eventId?.replace(/-/g, '').slice(0, 8).toUpperCase());
    // The same error object keeps its event id (a re-rendering boundary).
    expect(reporter.report(error).eventId).toBe(first.eventId);
  });
});
