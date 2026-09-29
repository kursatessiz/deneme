import React from 'react';

import { errorCodeFromId } from '@platform/shared';

jest.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
}));
jest.mock('../i18n/offlineTranslate', () => ({ resolveOfflineTranslate: jest.fn() }));
jest.mock('./runtime', () => ({ reportError: jest.fn() }));

// Imported after the mocks above are registered (jest hoists jest.mock calls).
// eslint-disable-next-line import/first
import { ErrorBoundary } from './ErrorBoundary';
// eslint-disable-next-line import/first
import { ErrorFallback } from './ErrorFallback';

describe('ErrorBoundary', () => {
  it('renders its children while nothing failed', () => {
    const child = React.createElement('View', null, 'ok');
    const boundary = new ErrorBoundary({ children: child });
    expect(boundary.render()).toBe(child);
  });

  it('turns a render error into state and renders the friendly fallback with that error', () => {
    const error = new Error('render failed');
    const state = ErrorBoundary.getDerivedStateFromError(error);
    expect(state).toEqual({ error, failed: true });

    const boundary = new ErrorBoundary({ children: null });
    boundary.state = state;
    const element = boundary.render() as React.ReactElement<{ error: unknown; onRetry: () => void }>;
    expect(element.type).toBe(ErrorFallback);
    expect(element.props.error).toBe(error);
  });

  it('"Try again" clears the error so the children render again', () => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = ErrorBoundary.getDerivedStateFromError(new Error('x'));
    const setState = jest.fn();
    boundary.setState = setState;
    const element = boundary.render() as React.ReactElement<{ onRetry: () => void }>;
    element.props.onRetry();
    expect(setState).toHaveBeenCalledWith({ error: null, failed: false });
  });

  it('still fails safe when a non-Error value was thrown', () => {
    const state = ErrorBoundary.getDerivedStateFromError('a string was thrown');
    expect(state.failed).toBe(true);
  });
});

describe('error code shown on the fallback', () => {
  it('uses the same 8-character derivation as the web (first 8 hex digits of the event id, upper case)', () => {
    expect(errorCodeFromId('7f3a9c21-0000-4000-8000-000000000000')).toBe('7F3A9C21');
  });
});
