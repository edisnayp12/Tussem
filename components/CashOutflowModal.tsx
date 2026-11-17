import React, { useState } from 'react';
import { parseLocaleNumber } from '../utils/browserUtils';
import { useFeedback } from './FeedbackProvider';

export const OUTFLOW_CATEGORIES = [
  'Compras / Insumos',
  'Fornecedor',
  'Despesas Gerais',
  'Entrega / Frete',
  'Retirada / Outros'
] as const;

interface CashOutflowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: { categoria: string; valor: number; motivo: string }) => Promise<void>;
  hasOpenShift: boolean;
  expectedCashInDrawer?: number;
}

export const CashOutflowModal: React.FC<CashOutflowModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  hasOpenShift,
  expectedCashInDrawer
}) => {
  const { showToast, confirmAction } = useFeedback();
  const [categoria, setCategoria] = useState<string>(OUTFLOW_CATEGORIES[0]);
  const [valorInput, setValorInput] = useState('');
  const [motivo, setMotivo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseLocaleNumber(valorInput);
    if (!valorInput.trim() || isNaN(val) || val <= 0) {
      showToast('Informe um valor maior que zero para a saída.', 'warning');
      return;
    }

    if (!motivo.trim()) {
      showToast('Informe a descrição / motivo da saída de valor.', 'warning');
      return;
    }

    if (hasOpenShift && expectedCashInDrawer !== undefined && val > expectedCashInDrawer) {
      const confirmed = await confirmAction({
        title: 'Saída Acima do Saldo em Dinheiro',
        message: `O valor informado (R$ ${val.toFixed(2)}) é maior que o dinheiro esperado no caixa (R$ ${expectedCashInDrawer.toFixed(2)}). Deseja lançar mesmo assim?`,
        confirmLabel: 'Confirmar Saída',
        destructive: true
      });
      if (!confirmed) return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm({
        categoria,
        valor: val,
        motivo: motivo.trim()
      });
      setValorInput('');
      setMotivo('');
      setCategoria(OUTFLOW_CATEGORIES[0]);
      onClose();
    } catch (err: any) {
      showToast('Erro ao registrar saída: ' + (err?.message || 'tente novamente'), 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 z-[125] flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm animate-in fade-in"
      onClick={() => !isSubmitting && onClose()}
    >
      <div
        className="bg-white dark:bg-[#180e2f] w-full max-w-md rounded-t-[36px] sm:rounded-[36px] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] max-h-[92dvh] overflow-y-auto shadow-2xl border border-purple-200 dark:border-purple-900/50 animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-300 flex items-center justify-center text-lg">
              <i className="fa-solid fa-money-bill-transfer"></i>
            </div>
            <div>
              <h3 className="text-lg font-black uppercase text-purple-950 dark:text-white leading-tight">
                Lançar Saída de Valor
              </h3>
              <p className="text-[11px] font-bold text-gray-500 dark:text-purple-300/70">
                Retirada do caixa para compras, pagamentos ou despesas
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Fechar modal"
            className="w-9 h-9 rounded-xl bg-purple-50 dark:bg-[#20143a] text-purple-900 dark:text-purple-200 flex items-center justify-center"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div
          className={`mb-4 px-3.5 py-2.5 rounded-2xl text-[11px] font-bold flex items-center gap-2 border ${
            hasOpenShift
              ? 'bg-purple-50 dark:bg-[#20143a] border-purple-200 dark:border-purple-800 text-purple-900 dark:text-purple-200'
              : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-200'
          }`}
        >
          <i className={`fa-solid ${hasOpenShift ? 'fa-cash-register text-purple-600' : 'fa-circle-info text-amber-600'}`}></i>
          <span>
            {hasOpenShift
              ? `Turno aberto • Saldo atual em dinheiro: R$ ${(expectedCashInDrawer ?? 0).toFixed(2)}`
              : 'Caixa fechado no momento • A saída será salva no histórico de saídas.'}
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Categorias rápidas */}
          <div>
            <label className="text-[10px] font-black text-gray-500 dark:text-purple-300 uppercase ml-1 mb-1.5 block">
              Categoria da Saída
            </label>
            <div className="flex flex-wrap gap-1.5">
              {OUTFLOW_CATEGORIES.map((cat) => {
                const active = categoria === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoria(cat)}
                    className={`px-3 py-2 rounded-xl text-[11px] font-black uppercase transition-all active:scale-95 ${
                      active
                        ? 'bg-purple-900 text-white shadow-sm'
                        : 'bg-purple-50 dark:bg-[#20143a] text-purple-900/80 dark:text-purple-200 border border-purple-100 dark:border-purple-900/40 hover:bg-purple-100'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Valor */}
          <div>
            <label className="text-[10px] font-black text-gray-500 dark:text-purple-300 uppercase ml-1 mb-1 block">
              Valor da Saída (R$)
            </label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={valorInput}
              onChange={(e) => setValorInput(e.target.value)}
              className="w-full bg-purple-50/70 dark:bg-[#22133f] border-2 border-purple-200 dark:border-purple-900/50 focus:border-purple-600 rounded-2xl px-4 py-3.5 font-black text-2xl text-purple-950 dark:text-white outline-none text-center"
            />
            <div className="grid grid-cols-4 gap-2 mt-2">
              {[10, 20, 50, 100].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setValorInput(preset.toFixed(2).replace('.', ','))}
                  className="py-2 rounded-xl bg-purple-100/70 dark:bg-purple-950/60 hover:bg-purple-200 text-purple-950 dark:text-purple-100 font-black text-xs uppercase active:scale-95 transition-all"
                >
                  R$ {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Motivo / Descrição */}
          <div>
            <label className="text-[10px] font-black text-gray-500 dark:text-purple-300 uppercase ml-1 mb-1 block">
              Descrição / Motivo
            </label>
            <input
              type="text"
              maxLength={180}
              placeholder="Ex: Compra de gelo, pagamento fornecedor, pão..."
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="w-full bg-purple-50/70 dark:bg-[#22133f] border-2 border-purple-200 dark:border-purple-900/50 focus:border-purple-600 rounded-2xl px-4 py-3 font-bold text-sm text-purple-950 dark:text-white outline-none"
            />
          </div>

          <div className="space-y-2 pt-1">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-rose-600 hover:bg-rose-700 text-white py-4 rounded-2xl font-black text-sm uppercase shadow-lg active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <i className="fa-solid fa-check"></i>
              <span>{isSubmitting ? 'Registrando...' : 'Confirmar Saída do Caixa'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="w-full text-center text-xs font-bold text-gray-400 uppercase py-2 hover:text-gray-600"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CashOutflowModal;
