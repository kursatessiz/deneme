'use client';

import { useState } from 'react';
import { ERROR_FEEDBACK_MAX_LENGTH } from '@platform/shared';
import type { Translate } from '@platform/shared';
import { sendErrorFeedback } from '@/lib/errors/reporter';

type State = 'idle' | 'sending' | 'sent' | 'failed';

/**
 * The optional "what were you doing" note on the error screen (H3): at most
 * 500 characters, scrubbed before it leaves the browser and again by the API,
 * with no e-mail or contact field. `t` comes from the caller because
 * global-error renders outside I18nProvider.
 */
export function ErrorFeedbackBox({ eventId, t }: { eventId: string; t: Translate }) {
  const [text, setText] = useState('');
  const [state, setState] = useState<State>('idle');

  if (state === 'sent') {
    return (
      <p role="status" className="text-sm" style={{ color: 'var(--color-text-secondary)' }} data-testid="error-feedback-sent">
        {t('errors.feedback.sent')}
      </p>
    );
  }

  const submit = async () => {
    setState('sending');
    setState((await sendErrorFeedback(eventId, text)) ? 'sent' : 'failed');
  };

  return (
    <div className="space-y-2">
      <label htmlFor="error-feedback" className="block text-sm font-medium">
        {t('errors.feedback.label')}
      </label>
      <textarea
        id="error-feedback"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={ERROR_FEEDBACK_MAX_LENGTH}
        rows={3}
        placeholder={t('errors.feedback.placeholder')}
        className="w-full border px-3 py-2 text-sm"
        style={{ borderRadius: 'var(--radius-input)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)' }}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('errors.feedback.counter', { count: text.length, max: ERROR_FEEDBACK_MAX_LENGTH })}
        </span>
        <button
          type="button"
          disabled={state === 'sending' || text.trim().length === 0}
          onClick={submit}
          className="px-4 py-2 text-sm font-medium border"
          style={{ borderRadius: 'var(--radius-button)', borderColor: 'var(--color-border)' }}
        >
          {t('errors.feedback.submit')}
        </button>
      </div>
      {state === 'failed' && (
        <p role="alert" className="text-xs" style={{ color: 'var(--color-danger)' }}>
          {t('errors.feedback.failed')}
        </p>
      )}
    </div>
  );
}
