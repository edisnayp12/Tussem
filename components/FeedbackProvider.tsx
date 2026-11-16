import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface FeedbackContextValue {
  showToast: (message: string, type?: ToastType, durationMs?: number) => void;
  confirmAction: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export const useFeedback = (): FeedbackContextValue => {
  const ctx = useContext(FeedbackContext);
  if (!ctx) {
    // Fallback seguro caso seja renderizado fora do provider
    return {
      showToast: (msg: string) => console.log('[Toast]', msg),
      confirmAction: async () => true,
    };
  }
  return ctx;
};

export const FeedbackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { id: string }) | null>(null);
  const confirmResolveRef = useRef<((value: boolean) => void) | null>(null);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info', durationMs: number = 4000) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts(prev => [...prev.slice(-3), { id, message, type }]);
    if (durationMs > 0) {
      setTimeout(() => {
        dismissToast(id);
      }, durationMs);
    }
  }, [dismissToast]);

  const confirmAction = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      if (confirmResolveRef.current) {
        confirmResolveRef.current(false);
      }
      confirmResolveRef.current = resolve;
      setConfirmState({
        ...options,
        id: `${Date.now()}`
      });
    });
  }, []);

  const handleConfirmChoice = (accepted: boolean) => {
    const resolver = confirmResolveRef.current;
    confirmResolveRef.current = null;
    setConfirmState(null);
    if (resolver) resolver(accepted);
  };

  const getToastStyles = (type: ToastType) => {
    switch (type) {
      case 'success':
        return {
          bg: 'bg-emerald-950/95 border-emerald-500/40 text-emerald-50',
          iconBg: 'bg-emerald-500/20 text-emerald-300',
          icon: 'fa-circle-check'
        };
      case 'error':
        return {
          bg: 'bg-red-950/95 border-red-500/40 text-red-50',
          iconBg: 'bg-red-500/20 text-red-300',
          icon: 'fa-circle-exclamation'
        };
      case 'warning':
        return {
          bg: 'bg-amber-950/95 border-amber-500/40 text-amber-50',
          iconBg: 'bg-amber-500/20 text-amber-300',
          icon: 'fa-triangle-exclamation'
        };
      default:
        return {
          bg: 'bg-purple-950/95 border-purple-500/40 text-purple-50',
          iconBg: 'bg-purple-500/20 text-purple-200',
          icon: 'fa-circle-info'
        };
    }
  };

  return (
    <FeedbackContext.Provider value={{ showToast, confirmAction }}>
      {children}

      {/* Container de Toasts */}
      {toasts.length > 0 && (
        <div
          className="fixed top-4 right-4 left-4 sm:left-auto sm:w-96 z-[300] flex flex-col gap-2 pointer-events-none"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          {toasts.map(toast => {
            const st = getToastStyles(toast.type);
            return (
              <div
                key={toast.id}
                role="status"
                className={`pointer-events-auto border backdrop-blur-md px-4 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-top-4 duration-300 ${st.bg}`}
              >
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${st.iconBg}`}>
                  <i className={`fa-solid ${st.icon} text-sm`}></i>
                </div>
                <p className="text-xs font-bold leading-snug flex-1 break-words">{toast.message}</p>
                <button
                  type="button"
                  onClick={() => dismissToast(toast.id)}
                  className="p-1.5 opacity-60 hover:opacity-100 transition-opacity"
                  aria-label="Fechar aviso"
                >
                  <i className="fa-solid fa-xmark text-xs"></i>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Global de Confirmação (Substitui window.confirm bloqueado em iframes/PWAs) */}
      {confirmState && (
        <div
          className="fixed inset-0 z-[310] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => handleConfirmChoice(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="bg-white dark:bg-[#170f2b] border border-gray-200 dark:border-purple-900/50 rounded-[32px] p-6 sm:p-8 w-full max-w-sm shadow-2xl animate-in zoom-in-95"
            onClick={e => e.stopPropagation()}
          >
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4 ${
              confirmState.destructive
                ? 'bg-red-100 dark:bg-red-950/70 text-red-600 dark:text-red-400'
                : 'bg-purple-100 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300'
            }`}>
              <i className={`fa-solid ${confirmState.destructive ? 'fa-triangle-exclamation' : 'fa-circle-question'}`}></i>
            </div>

            <h3 className="text-lg font-black uppercase text-center text-purple-950 dark:text-white tracking-tight">
              {confirmState.title}
            </h3>
            <p className="text-xs font-semibold text-gray-600 dark:text-purple-200/80 text-center mt-2 leading-relaxed">
              {confirmState.message}
            </p>

            <div className="mt-6 flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={() => handleConfirmChoice(false)}
                className="flex-1 py-3.5 px-4 rounded-2xl font-black text-xs uppercase bg-gray-100 dark:bg-[#241644] text-gray-700 dark:text-purple-200 hover:bg-gray-200 transition-all"
              >
                {confirmState.cancelLabel || 'Cancelar'}
              </button>
              <button
                type="button"
                onClick={() => handleConfirmChoice(true)}
                className={`flex-1 py-3.5 px-4 rounded-2xl font-black text-xs uppercase text-white shadow-lg active:scale-95 transition-all ${
                  confirmState.destructive
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-purple-900 hover:bg-purple-800'
                }`}
              >
                {confirmState.confirmLabel || 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
};
