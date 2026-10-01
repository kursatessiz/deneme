'use client';

import { useState } from 'react';
import { ERROR_FEEDBACK_MAX_LENGTH } from '@platform/shared';
import type { Translate } from '@platform/shared';
import { sendErrorFeedback } from '@/lib/errors/reporter';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';

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
      <p role="status" className="ui-text-muted" data-testid="error-feedback-sent">
        {t('errors.feedback.sent')}
      </p>
    );
  }

  const submit = async () => {
    setState('sending');
    setState((await sendErrorFeedback(eventId, text)) ? 'sent' : 'failed');
  };

  return (
    <div className="grid gap-2">
      <label htmlFor="error-feedback" className="ui-strong">
        {t('errors.feedback.label')}
      </label>
      <Textarea
        id="error-feedback"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={ERROR_FEEDBACK_MAX_LENGTH}
        rows={3}
        placeholder={t('errors.feedback.placeholder')}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="ui-caption">{t('errors.feedback.counter', { count: text.length, max: ERROR_FEEDBACK_MAX_LENGTH })}</span>
        <Button variant="outline" tone="surface" disabled={state === 'sending' || text.trim().length === 0} onClick={submit}>
          {t('errors.feedback.submit')}
        </Button>
      </div>
      {state === 'failed' && (
        <p role="alert" className="ui-caption ui-text-error">
          {t('errors.feedback.failed')}
        </p>
      )}
    </div>
  );
}
