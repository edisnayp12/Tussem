import React, { useState } from 'react';
import { usePWAInstall } from './usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-3 text-sm font-black uppercase text-white shadow-lg shadow-purple-500/20 hover:bg-purple-700 transition"
      >
        <i className="fa-solid fa-download"></i>
        Instalar App
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-2 rounded-xl border-2 border-purple-200 bg-purple-50 px-5 py-3 text-sm font-black uppercase text-purple-700 hover:bg-purple-100 transition"
        >
          <i className="fa-brands fa-apple"></i>
          Instalar no iPhone
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={() => setShowIOSGuide(false)}>
            <div className="w-full max-w-sm rounded-[32px] bg-white p-8 shadow-2xl" onClick={e => e.stopPropagation()}>
              <h3 className="text-xl font-black text-purple-950 uppercase mb-4 text-center">Instalar no iPhone</h3>
              <div className="space-y-4 text-sm font-bold text-gray-600">
                <p className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center shrink-0">1</span>
                  <span>Toque no botão de <strong>Compartilhar</strong> <i className="fa-solid fa-arrow-up-from-bracket mx-1 text-blue-500"></i> na barra inferior do Safari.</span>
                </p>
                <p className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center shrink-0">2</span>
                  <span>Role um pouco para baixo e toque em <strong>"Adicionar à Tela de Início"</strong> <i className="fa-regular fa-square-plus mx-1"></i>.</span>
                </p>
              </div>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-8 w-full rounded-2xl bg-gray-100 py-4 text-sm font-black uppercase text-gray-800 hover:bg-gray-200 transition"
              >
                Entendi
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
