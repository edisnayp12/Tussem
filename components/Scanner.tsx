import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Product } from '../types';

interface ScannerProps {
  onScan: (code: string) => void;
  onClose: () => void;
  products?: Product[];
  onSelectProduct?: (product: Product) => void;
}

const Scanner: React.FC<ScannerProps> = ({ onScan, onClose, products = [], onSelectProduct }) => {
  const [manualCode, setManualCode] = useState('');
  const [cameraStatus, setCameraStatus] = useState<'initializing' | 'active' | 'unsupported' | 'denied'>('initializing');
  const [supportsBarcodeDetector, setSupportsBarcodeDetector] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);

  const stopCamera = () => {
    stoppedRef.current = true;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      streamRef.current = null;
    }
  };

  useEffect(() => {
    stoppedRef.current = false;
    const hasBarcodeAPI = typeof window !== 'undefined' && 'BarcodeDetector' in window;
    setSupportsBarcodeDetector(hasBarcodeAPI);

    const startCamera = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraStatus('unsupported');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });

        if (stoppedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch {}
        }
        setCameraStatus('active');

        if (hasBarcodeAPI) {
          try {
            const Detector = (window as any).BarcodeDetector;
            const detector = new Detector({
              formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code']
            });

            let lastScanAt = 0;
            const scanLoop = async () => {
              if (stoppedRef.current || !videoRef.current) return;
              const now = Date.now();
              if (videoRef.current.readyState >= 2 && now - lastScanAt > 350) {
                lastScanAt = now;
                try {
                  const barcodes = await detector.detect(videoRef.current);
                  if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                    const code = String(barcodes[0].rawValue).trim();
                    if (code) {
                      stopCamera();
                      onScan(code);
                      return;
                    }
                  }
                } catch {}
              }
              rafRef.current = requestAnimationFrame(scanLoop);
            };
            rafRef.current = requestAnimationFrame(scanLoop);
          } catch {
            // Se o construtor do BarcodeDetector falhar neste browser, mantém a câmera e busca manual
            setSupportsBarcodeDetector(false);
          }
        }
      } catch {
        setCameraStatus('denied');
      }
    };

    startCamera();

    return () => {
      stopCamera();
    };
  }, [onScan]);

  const handleClose = () => {
    stopCamera();
    onClose();
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCode.trim()) {
      onScan(manualCode.trim());
      setManualCode('');
    }
  };

  const matchedProducts = useMemo(() => {
    const term = manualCode.trim().toLowerCase();
    if (!term || products.length === 0) return [];
    return products
      .filter((p) => {
        if (p.ativo === false) return false;
        const nameMatch = (p.nome || '').toLowerCase().includes(term);
        const codeMatch = (p.codigo || '').toLowerCase().includes(term) || (p.codigo_barras || '').toLowerCase().includes(term);
        return nameMatch || codeMatch;
      })
      .slice(0, 5);
  }, [manualCode, products]);

  return (
    <div
      className="fixed inset-0 bg-black/85 z-[140] flex flex-col items-center justify-center p-4 text-white backdrop-blur-sm animate-in fade-in"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-sm bg-gray-900 rounded-[32px] p-6 border border-purple-800/50 shadow-2xl animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-700/40 text-purple-300 flex items-center justify-center">
              <i className="fa-solid fa-barcode"></i>
            </div>
            <div>
              <h2 className="text-base font-black uppercase tracking-tight">Leitor / Código</h2>
              <p className="text-[10px] text-gray-400 font-bold uppercase">Câmera ou Busca Manual</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-9 h-9 bg-gray-800 hover:bg-gray-700 rounded-full flex items-center justify-center transition-colors"
            aria-label="Fechar leitor"
          >
            <i className="fa-solid fa-xmark text-base"></i>
          </button>
        </div>

        <div className="aspect-[4/3] bg-gray-950 rounded-2xl border-2 border-purple-500/60 flex items-center justify-center relative overflow-hidden mb-4">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`w-full h-full object-cover ${cameraStatus === 'active' ? 'opacity-100' : 'opacity-0 absolute'}`}
          />

          {cameraStatus === 'active' && (
            <>
              <div className="absolute inset-6 border-2 border-amber-400/70 rounded-xl pointer-events-none"></div>
              <div className="absolute top-1/2 left-6 right-6 h-0.5 bg-emerald-400/80 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-pulse pointer-events-none"></div>
              <span className="absolute bottom-2 left-2 right-2 text-center text-[9px] font-black uppercase bg-black/60 py-1 px-2 rounded-lg text-purple-200">
                {supportsBarcodeDetector
                  ? 'Aponte a câmera para o código de barras'
                  : 'Câmera ativa • Digite o código ou nome abaixo'}
              </span>
            </>
          )}

          {cameraStatus === 'initializing' && (
            <div className="text-center p-4">
              <i className="fa-solid fa-spinner animate-spin text-3xl text-purple-400 mb-2"></i>
              <p className="text-xs text-gray-400 font-bold">Iniciando câmera...</p>
            </div>
          )}

          {(cameraStatus === 'denied' || cameraStatus === 'unsupported') && (
            <div className="text-center p-5 space-y-2">
              <i className="fa-solid fa-camera-slash text-4xl text-purple-400/70"></i>
              <p className="text-xs font-bold text-gray-300">
                {cameraStatus === 'denied'
                  ? 'Permissão de câmera não concedida neste navegador.'
                  : 'Câmera indisponível neste dispositivo.'}
              </p>
              <p className="text-[10px] text-gray-400">
                Use o campo abaixo com leitor USB, código digitado ou nome do produto.
              </p>
            </div>
          )}
        </div>

        <form onSubmit={handleManualSubmit} className="space-y-3">
          <label className="block text-[10px] font-black uppercase tracking-wider text-purple-300">
            Código de barras ou nome do item:
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 focus:border-purple-500 rounded-xl px-4 py-3 text-sm font-bold text-white outline-none"
              placeholder="Ex: 789... ou Coxinha"
              autoFocus
            />
            <button
              type="submit"
              className="bg-purple-600 hover:bg-purple-500 px-5 py-3 rounded-xl font-black text-xs uppercase transition-colors"
            >
              OK
            </button>
          </div>
        </form>

        {matchedProducts.length > 0 && (
          <div className="mt-3 max-h-36 overflow-y-auto space-y-1.5 border-t border-gray-800 pt-3">
            {matchedProducts.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  stopCamera();
                  if (onSelectProduct) {
                    onSelectProduct(p);
                  } else {
                    onScan(p.codigo || p.codigo_barras || p.nome);
                  }
                }}
                className="w-full flex justify-between items-center bg-gray-800/80 hover:bg-purple-900/60 px-3 py-2 rounded-xl text-left text-xs transition-colors"
              >
                <span className="font-black uppercase truncate pr-2 text-white">{p.nome}</span>
                <span className="font-black text-amber-300 shrink-0">R$ {(Number(p.preco) || 0).toFixed(2)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Scanner;
