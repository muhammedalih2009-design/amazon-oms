import React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorId: null
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    const errorId = `ERR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.setState({
      error: error,
      errorId: errorId
    });
    console.error(`[ErrorBoundary ${errorId}]`, error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, errorId: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-red-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-lg border border-red-200 max-w-md w-full p-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-red-100 rounded-lg">
                <AlertCircle className="w-6 h-6 text-red-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Page Failed to Load</h1>
            </div>
            
            <p className="text-slate-600 mb-4">
              {this.props.children ? this.props.fallbackTitle || 'An unexpected error occurred.' : 'Failed to render this page.'}
            </p>

            {this.state.error && (
              <div className="bg-slate-50 rounded-lg p-3 mb-4 border border-slate-200">
                <p className="text-xs text-slate-700 font-mono break-words">
                  {this.state.error.message || 'Unknown error'}
                </p>
              </div>
            )}

            <div className="bg-blue-50 rounded-lg p-3 mb-6 border border-blue-200">
              <p className="text-xs text-blue-700">
                <strong>Error ID:</strong>{' '}
                <span className="font-mono">{this.state.errorId}</span>
              </p>
            </div>

            <Button
              onClick={this.handleReload}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Try Again
            </Button>

            <p className="text-xs text-slate-500 mt-4 text-center">
              If the problem persists, share the Error ID above with support.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;