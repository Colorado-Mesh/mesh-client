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
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 space-y-4">
          <div className="text-red-400 text-xl font-semibold">Something went wrong</div>
          <div
            className="bg-red-900/30 border border-red-800 rounded-lg p-4 max-w-lg w-full"
            role="alert"
          >
            <p className="text-sm text-red-300 font-mono break-words">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-sm font-medium transition-colors"
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
