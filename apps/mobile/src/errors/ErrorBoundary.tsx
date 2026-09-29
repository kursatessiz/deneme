import React from 'react';
import type { ReactNode } from 'react';

import { ErrorFallback } from './ErrorFallback';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: unknown;
  failed: boolean;
}

/**
 * Root error boundary (H2): a render error anywhere below shows the friendly
 * error screen (which reports the error and shows its short code) instead of
 * a blank app. "Try again" clears the error and renders the children again.
 * It wraps the providers, so it renders the fallback without any context.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error, failed: true };
  }

  private readonly retry = (): void => {
    this.setState({ error: null, failed: false });
  };

  render(): ReactNode {
    if (this.state.failed) return <ErrorFallback error={this.state.error} onRetry={this.retry} />;
    return this.props.children;
  }
}
