
import React, { useState } from 'react';

interface ScannerProps {
  onScan: (code: string) => void;
  onClose: () => void;
}

const Scanner: React.FC<ScannerProps> = ({ onScan, onClose }) => {
  const [manualCode, setManualCode] = useState('');

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCode.trim()) {
      onScan(manualCode.trim());
      setManualCode('');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[100] flex flex-col items-center justify-center p-6 text-white">
      <div className="w-full max-w-sm bg-gray-900 rounded-2xl p-6 border border-gray-700 shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">Escanear Produto</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-800 rounded-full">
            <i className="fa-solid fa-xmark text-xl"></i>
          </button>
        </div>

        <div className="aspect-square bg-gray-800 rounded-xl border-2 border-dashed border-purple-500 flex flex-center items-center justify-center relative overflow-hidden mb-6">
          <div className="text-center p-4">
            <i className="fa-solid fa-qrcode text-6xl text-purple-400 mb-4 animate-pulse"></i>
            <p className="text-sm text-gray-400">Posicione o código no centro</p>
          </div>
          {/* Overlay scanning line */}
          <div className="absolute top-0 left-0 w-full h-1 bg-purple-500 opacity-50 animate-bounce" style={{animationDuration: '2s'}}></div>
        </div>

        <form onSubmit={handleManualSubmit} className="space-y-4">
          <label className="block text-sm font-medium text-gray-300">Ou digite o código manualmente:</label>
          <div className="flex space-x-2">
            <input
              type="text"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 outline-none"
              placeholder="Código de barras..."
              autoFocus
            />
            <button
              type="submit"
              className="bg-purple-600 hover:bg-purple-500 px-4 py-2 rounded-lg font-bold"
            >
              OK
            </button>
          </div>
        </form>

        <p className="mt-6 text-xs text-gray-500 text-center">
          Dica: Em dispositivos reais, usaríamos a câmera aqui.
        </p>
      </div>
    </div>
  );
};

export default Scanner;
