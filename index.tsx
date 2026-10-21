import React, { Component, ErrorInfo, ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Ocorreu uma instabilidade inesperada na aplicação.'
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary capturou um erro:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, errorMessage: '' });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-purple-950 flex flex-col items-center justify-center p-6 text-center text-white font-sans">
          <div className="w-16 h-16 bg-white/10 rounded-3xl flex items-center justify-center text-2xl mb-6 shadow-xl">
            ⚠️
          </div>
          <h2 className="text-2xl font-black uppercase tracking-wider mb-2">
            Cantina TUSEMM
          </h2>
          <p className="text-sm opacity-80 max-w-sm mb-6">
            O sistema encontrou uma oscilação temporária. Clique abaixo para restabelecer a conexão.
          </p>
          <button
            onClick={this.handleReload}
            className="bg-white text-purple-950 font-black px-8 py-4 rounded-2xl uppercase tracking-wider text-xs shadow-2xl active:scale-95 transition-all"
          >
            Recarregar Aplicativo
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
