import React from 'react';

interface ErrorBoundaryState {
  error: Error | null;
}

/* Without this, an uncaught render error anywhere in the tree unmounts
 * EVERYTHING, leaving a totally blank page with no indication of what
 * broke — exactly the "big blank page" reports this was added to diagnose.
 * With it, we at least see the real error instead of guessing blind. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 bg-slate-950 text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-slate-900 border border-red-500/30 rounded-2xl p-6 space-y-3">
            <h1 className="text-lg font-bold text-red-400">Something broke</h1>
            <p className="text-sm text-slate-300 font-mono whitespace-pre-wrap break-words">
              {this.state.error.message}
            </p>
            <pre className="text-[10px] text-slate-500 max-h-60 overflow-auto whitespace-pre-wrap break-words">
              {this.state.error.stack}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-sm"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
