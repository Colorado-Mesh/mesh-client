import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center space-y-4 p-8">
          <div className="text-xl font-semibold text-red-400">Something went wrong</div>
          <div
            className="w-full max-w-lg rounded-lg border border-red-800 bg-red-900/30 p-4"
            role="alert"
          >
            <p className="font-mono text-sm break-words text-red-300">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
          </div>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
            }}
            className="rounded-lg bg-gray-700 px-6 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600"
          >
            Try Again
          </button>
          <p className="text-xs text-gray-500">
            If the problem persists, try switching to a different tab or restarting the application.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
