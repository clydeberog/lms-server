import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  operationContext?: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let parsedMessage = error.message || 'An unexpected application error occurred.';
    let operationContext: string | undefined;

    try {
      const parsed = JSON.parse(error.message) as {
        error?: string;
        operationType?: string;
        path?: string;
      };
      if (parsed && parsed.error) {
        parsedMessage = parsed.error;
        if (parsed.operationType && parsed.path) {
          operationContext = `${parsed.operationType.toUpperCase()} on ${parsed.path}`;
        }
      }
    } catch {
      // Plain error message
    }

    return {
      hasError: true,
      errorMessage: parsedMessage,
      operationContext,
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('LMS ErrorBoundary:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMessage: '', operationContext: undefined });
  };

  render() {
    if (this.state.hasError) {
      const isQuota = this.state.errorMessage.toLowerCase().includes('quota exceeded');
      return (
        <div className="min-h-screen bg-[#FBF9F5] text-[#1C1917] flex items-center justify-center p-6">
          <div className="max-w-xl w-full bg-[#F5F1E8] border border-[#E5DFD3] rounded-lg p-8">
            <div className="flex items-start gap-4">
              <AlertTriangle className="w-6 h-6 text-[#78350F] shrink-0 mt-1" />
              <div className="space-y-3 flex-1">
                <h1 className="text-2xl font-serif font-semibold text-[#1C1917]">
                  Application Notice
                </h1>
                {this.state.operationContext && (
                  <p className="text-xs font-mono text-[#57534E]">
                    Operation: {this.state.operationContext}
                  </p>
                )}
                <p className="text-sm text-[#1C1917]/85 leading-relaxed break-words">
                  {this.state.errorMessage}
                </p>
                {isQuota && (
                  <p className="text-xs text-[#57534E] leading-relaxed">
                    Firestore daily free-tier quota was reached and resets tomorrow. You can review
                    Firestore Enterprise Spark plan limits in the Firebase Console.
                  </p>
                )}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={this.handleReset}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Return to Workspace</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
