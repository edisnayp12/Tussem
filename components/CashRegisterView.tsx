import React, { useState, useMemo } from 'react';
import { CashShift, CashOutflow, Sale, User, PaymentMethod } from '../types';
import {
  parseLocaleNumber,
  formatSafeDate,
  formatSafeTime,
  formatSafeDateTime,
  getLocalDateString,
  downloadBlobFile,
  escapeCsvCell
} from '../utils/browserUtils';
import { useFeedback } from './FeedbackProvider';
import CashOutflowModal from './CashOutflowModal';

interface CashRegisterViewProps {
  shifts: CashShift[];
  currentShift: CashShift | null;
  outflows: CashOutflow[];
  sales: Sale[];
  currentUser: User | null;
  onOpenShift: (valorAbertura: number) => Promise<void>;
  onAddMovement: (tipo: 'sangria' | 'suprimento', valor: number, motivo: string) => Promise<void>;
  onRemoveMovement?: (shiftId: string, movementId: string) => Promise<void>;
  onAddOutflow: (data: { categoria: string; valor: number; motivo: string }) => Promise<void>;
  onDeleteOutflow: (outflow: CashOutflow) => Promise<void>;
  onCloseShift: (
    valorInformado: number,
    valorCalculado: number,
    totaisVendas: {
      dinheiro: number;
      pix: number;
      debito: number;
      credito: number;
      fiado: number;
      saidas: number;
    },
    obs: string
  ) => Promise<void>;
}

export const CashRegisterView: React.FC<CashRegisterViewProps> = ({
  shifts,
  currentShift,
  outflows,
  sales,
  currentUser,
  onOpenShift,
  onAddMovement,
  onRemoveMovement,
  onAddOutflow,
  onDeleteOutflow,
  onCloseShift
}) => {
  const { showToast, confirmAction } = useFeedback();
  const [openingBalance, setOpeningBalance] = useState('100,00');
  const [movementModal, setMovementModal] = useState<'sangria' | 'suprimento' | null>(null);
  const [movementValue, setMovementValue] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [isOutflowModalOpen, setIsOutflowModalOpen] = useState(false);
  const [outflowPeriod, setOutflowPeriod] = useState<'hoje' | '7dias' | 'todas'>('hoje');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modal de Fechamento de Caixa
  const [isClosingModal, setIsClosingModal] = useState(false);
  const [countedCash, setCountedCash] = useState('');
  const [closingNotes, setClosingNotes] = useState('');
  const [selectedShiftHistory, setSelectedShiftHistory] = useState<CashShift | null>(null);

  // Vendas ocorridas durante o turno atual
  const shiftSales = currentShift
    ? sales.filter((s) => {
        const saleTime = new Date(s.created_at).getTime();
        const shiftOpenTime = new Date(currentShift.aberto_em).getTime();
        return saleTime >= shiftOpenTime;
      })
    : [];

  const salesCash = shiftSales
    .filter((s) => s.status === 'pago' && s.forma_pagamento === PaymentMethod.CASH)
    .reduce((a, b) => a + (Number(b.valor_total) || 0), 0);

  const salesPix = shiftSales
    .filter((s) => s.status === 'pago' && s.forma_pagamento === PaymentMethod.PIX)
    .reduce((a, b) => a + (Number(b.valor_total) || 0), 0);

  const salesDebit = shiftSales
    .filter((s) => s.status === 'pago' && s.forma_pagamento === PaymentMethod.DEBIT)
    .reduce((a, b) => a + (Number(b.valor_total) || 0), 0);

  const salesCredit = shiftSales
    .filter((s) => s.status === 'pago' && s.forma_pagamento === PaymentMethod.CREDIT)
    .reduce((a, b) => a + (Number(b.valor_total) || 0), 0);

  const salesFiado = shiftSales
    .filter((s) => s.forma_pagamento === PaymentMethod.FIADO)
    .reduce((a, b) => a + (Number(b.valor_total) || 0), 0);

  const totalSangrias = currentShift?.total_sangrias || 0;
  const totalSuprimentos = currentShift?.total_suprimentos || 0;
  const totalSaidas = currentShift?.total_saidas || 0;
  const initialFund = currentShift?.valor_abertura || 0;

  // Dinheiro esperado na gaveta (abate sangrias e saídas de valores)
  const expectedCashInDrawer = initialFund + salesCash + totalSuprimentos - totalSangrias - totalSaidas;

  // Filtro de saídas lançadas
  const filteredOutflows = useMemo(() => {
    const todayStr = getLocalDateString();
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    return (outflows || [])
      .filter((o) => {
        if (outflowPeriod === 'hoje') {
          return getLocalDateString(o.data) === todayStr;
        }
        if (outflowPeriod === '7dias') {
          return new Date(o.data).getTime() >= sevenDaysAgo;
        }
        return true;
      })
      .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
  }, [outflows, outflowPeriod]);

  const totalFilteredOutflows = useMemo(
    () => filteredOutflows.reduce((acc, o) => acc + (Number(o.valor) || 0), 0),
    [filteredOutflows]
  );

  const handleOpenShift = async () => {
    if (!currentUser) return;
    const val = parseLocaleNumber(openingBalance);
    if (!openingBalance.trim() || isNaN(val) || val < 0) {
      showToast('Informe um valor de abertura válido.', 'warning');
      return;
    }
    setIsSubmitting(true);
    try {
      await onOpenShift(val);
      showToast(`Caixa aberto com fundo inicial de R$ ${val.toFixed(2)}!`, 'success');
    } catch (e: any) {
      showToast('Erro ao abrir caixa: ' + (e?.message || 'Tente novamente'), 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddMovement = async () => {
    if (!currentShift || !currentUser || !movementModal) return;
    const val = parseLocaleNumber(movementValue);
    if (!movementValue.trim() || isNaN(val) || val <= 0) {
      showToast('Informe um valor maior que zero.', 'warning');
      return;
    }

    if (movementModal === 'sangria' && val > expectedCashInDrawer) {
      const confirmed = await confirmAction({
        title: 'Sangria Acima do Saldo',
        message: `O valor da sangria (R$ ${val.toFixed(2)}) é maior que o saldo em dinheiro disponível no caixa (R$ ${expectedCashInDrawer.toFixed(2)}). Deseja continuar mesmo assim?`,
        confirmLabel: 'Confirmar Sangria',
        destructive: true
      });
      if (!confirmed) return;
    }

    setIsSubmitting(true);
    try {
      await onAddMovement(movementModal, val, movementReason);
      showToast(
        `${movementModal === 'sangria' ? 'Sangria' : 'Suprimento'} de R$ ${val.toFixed(2)} registrado!`,
        'success'
      );
      setMovementModal(null);
      setMovementValue('');
      setMovementReason('');
    } catch (e: any) {
      showToast('Erro ao registrar movimentação: ' + (e?.message || 'Tente novamente'), 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDeleteOutflow = async (outflow: CashOutflow) => {
    const confirmed = await confirmAction({
      title: 'Excluir Saída de Valor',
      message: `Deseja remover a saída "${outflow.motivo}" no valor de R$ ${Number(outflow.valor).toFixed(2)}? Se ela pertencer ao turno aberto, o saldo da gaveta será recalculado.`,
      confirmLabel: 'Excluir Lançamento',
      destructive: true
    });
    if (!confirmed) return;

    try {
      await onDeleteOutflow(outflow);
      showToast('Saída de valor removida com sucesso.', 'success');
    } catch (e: any) {
      showToast('Erro ao remover saída: ' + (e?.message || 'Tente novamente'), 'error');
    }
  };

  const handleConfirmDeleteShiftMovement = async (movId: string, label: string, valor: number) => {
    if (!currentShift || !onRemoveMovement) return;
    const confirmed = await confirmAction({
      title: 'Estornar Movimentação',
      message: `Deseja remover o lançamento "${label}" de R$ ${valor.toFixed(2)} deste turno?`,
      confirmLabel: 'Remover',
      destructive: true
    });
    if (!confirmed) return;

    try {
      await onRemoveMovement(currentShift.id, movId);
      showToast('Movimentação removida do turno.', 'success');
    } catch (e: any) {
      showToast('Erro ao remover movimentação: ' + (e?.message || 'Tente novamente'), 'error');
    }
  };

  const handleExportOutflowsCsv = () => {
    if (filteredOutflows.length === 0) {
      showToast('Nenhuma saída encontrada no período para exportar.', 'warning');
      return;
    }
    const headers = ['Data/Hora', 'Categoria', 'Motivo', 'Valor (R$)', 'Operador'];
    const rows = filteredOutflows.map((o) => [
      escapeCsvCell(formatSafeDateTime(o.data)),
      escapeCsvCell(o.categoria),
      escapeCsvCell(o.motivo),
      escapeCsvCell(Number(o.valor).toFixed(2).replace('.', ',')),
      escapeCsvCell(o.operador_nome)
    ]);
    const csv = '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    downloadBlobFile(csv, `saidas_caixa_${getLocalDateString()}.csv`);
    showToast('Planilha de saídas exportada!', 'success');
  };

  const handleConfirmCloseShift = async () => {
    if (!currentShift || !currentUser) return;
    const counted = parseLocaleNumber(countedCash);
    if (!countedCash.trim() || isNaN(counted) || counted < 0) {
      showToast('Informe o valor físico contado no caixa.', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      await onCloseShift(
        counted,
        expectedCashInDrawer,
        {
          dinheiro: salesCash,
          pix: salesPix,
          debito: salesDebit,
          credito: salesCredit,
          fiado: salesFiado,
          saidas: totalSaidas
        },
        closingNotes
      );
      showToast('Turno de caixa encerrado com sucesso!', 'success');
      setIsClosingModal(false);
      setCountedCash('');
      setClosingNotes('');
    } catch (e: any) {
      showToast('Erro ao fechar caixa: ' + (e?.message || 'Tente novamente'), 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 pb-24 animate-in fade-in duration-500">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-purple-950 dark:text-purple-100 uppercase tracking-tighter flex items-center gap-2">
            <i className="fa-solid fa-cash-register text-purple-600"></i> Gestão de Caixa & Saídas
          </h2>
          <p className="text-[10px] text-gray-500 font-bold uppercase mt-1">
            Abertura, lançamento de saídas de valores, sangria, suprimento e fechamento
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setIsOutflowModalOpen(true)}
            className="flex-1 sm:flex-none px-4 py-2.5 rounded-2xl text-xs font-black uppercase bg-rose-600 hover:bg-rose-700 text-white shadow-md active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <i className="fa-solid fa-money-bill-transfer"></i>
            <span>Lançar Saída</span>
          </button>

          {currentShift ? (
            <span className="px-3 py-2 rounded-full text-xs font-black uppercase bg-green-100 text-green-800 dark:bg-green-950/80 dark:text-green-300 border border-green-300 dark:border-green-800 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> Caixa Aberto
            </span>
          ) : (
            <span className="px-3 py-2 rounded-full text-xs font-black uppercase bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border border-gray-300 dark:border-gray-700 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500"></span> Caixa Fechado
            </span>
          )}
        </div>
      </div>

      {/* SE O CAIXA ESTIVER FECHADO: Tela de Abertura */}
      {!currentShift && (
        <div className="bg-white dark:bg-[#160e2b] p-6 sm:p-8 rounded-[32px] shadow-sm border border-gray-100 dark:border-purple-900/40 max-w-lg mx-auto text-center">
          <div className="w-16 h-16 rounded-3xl bg-purple-100 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 flex items-center justify-center text-2xl mx-auto mb-4 shadow-inner">
            <i className="fa-solid fa-lock"></i>
          </div>
          <h3 className="text-lg font-black uppercase text-purple-950 dark:text-purple-100">O Caixa Está Fechado</h3>
          <p className="text-xs text-gray-500 font-medium mt-1 mb-6">
            Inicie um turno para controlar o saldo em gaveta ou use o botão acima para lançar uma saída avulsa.
          </p>

          <div className="space-y-4 text-left">
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase ml-2 mb-1 block">
                Fundo de Troco Inicial (R$)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                placeholder="0,00"
                className="w-full bg-gray-50 dark:bg-[#20143a] border border-gray-200 dark:border-purple-900/50 rounded-2xl px-5 py-4 font-black text-xl text-purple-950 dark:text-white outline-none focus:border-purple-600"
              />
            </div>

            <div className="flex gap-2">
              {['50,00', '100,00', '150,00', '200,00'].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setOpeningBalance(val)}
                  className="flex-1 py-2 text-[10px] font-black uppercase rounded-xl border border-gray-200 dark:border-purple-900/50 hover:bg-purple-50 dark:hover:bg-purple-900/30 text-purple-900 dark:text-purple-200"
                >
                  R$ {val}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleOpenShift}
              disabled={isSubmitting}
              className="w-full bg-purple-900 hover:bg-black text-white py-4 rounded-2xl font-black text-xs uppercase shadow-lg transition-all active:scale-95 disabled:opacity-50 mt-4 flex items-center justify-center gap-2"
            >
              <i className="fa-solid fa-key"></i> Abrir Turno de Caixa
            </button>
          </div>
        </div>
      )}

      {/* SE O CAIXA ESTIVER ABERTO: Painel Operacional */}
      {currentShift && (
        <>
          {/* Card Principal: Saldo em Dinheiro na Gaveta */}
          <div className="bg-gradient-to-br from-purple-950 via-purple-900 to-indigo-950 p-6 sm:p-8 rounded-[32px] text-white shadow-xl relative overflow-hidden">
            <i className="fa-solid fa-coins absolute -right-6 -bottom-6 text-9xl opacity-10"></i>
            <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-4 relative z-10">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest opacity-80">
                  Dinheiro Físico Esperado no Caixa
                </span>
                <h3 className="text-4xl font-black mt-1">R$ {expectedCashInDrawer.toFixed(2)}</h3>
                <p className="text-[11px] font-semibold mt-2 opacity-90">
                  Aberto por <span className="font-bold underline">{currentShift.aberto_por_nome}</span> às{' '}
                  {formatSafeTime(currentShift.aberto_em)}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setIsOutflowModalOpen(true)}
                  className="px-4 py-3 bg-rose-500 hover:bg-rose-600 text-white rounded-2xl font-black text-xs uppercase tracking-wider transition-all active:scale-95 flex items-center gap-2 shadow-md"
                >
                  <i className="fa-solid fa-money-bill-transfer"></i> Saída de Valor
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMovementModal('sangria');
                    setMovementValue('');
                    setMovementReason('');
                  }}
                  className="px-4 py-3 bg-red-500/20 hover:bg-red-500 border border-red-400/30 text-white rounded-2xl font-black text-xs uppercase tracking-wider transition-all active:scale-95 flex items-center gap-2 shadow-sm"
                >
                  <i className="fa-solid fa-arrow-down"></i> Sangria
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMovementModal('suprimento');
                    setMovementValue('');
                    setMovementReason('');
                  }}
                  className="px-4 py-3 bg-green-500/20 hover:bg-green-500 border border-green-400/30 text-white rounded-2xl font-black text-xs uppercase tracking-wider transition-all active:scale-95 flex items-center gap-2 shadow-sm"
                >
                  <i className="fa-solid fa-arrow-up"></i> Suprimento
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsClosingModal(true);
                    setCountedCash('');
                    setClosingNotes('');
                  }}
                  className="px-5 py-3 bg-amber-400 hover:bg-amber-500 text-purple-950 rounded-2xl font-black text-xs uppercase tracking-wider transition-all active:scale-95 flex items-center gap-2 shadow-lg"
                >
                  <i className="fa-solid fa-lock"></i> Fechar Caixa
                </button>
              </div>
            </div>

            {/* Resumo de Abertura / Saídas / Sangrias / Suprimentos */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-white/10 text-center">
              <div>
                <span className="text-[9px] uppercase font-bold opacity-60">Fundo Inicial</span>
                <p className="text-sm font-black">R$ {initialFund.toFixed(2)}</p>
              </div>
              <div>
                <span className="text-[9px] uppercase font-bold text-rose-300">Saídas de Valores</span>
                <p className="text-sm font-black text-rose-300">- R$ {totalSaidas.toFixed(2)}</p>
              </div>
              <div>
                <span className="text-[9px] uppercase font-bold text-red-300">Sangrias</span>
                <p className="text-sm font-black text-red-300">- R$ {totalSangrias.toFixed(2)}</p>
              </div>
              <div>
                <span className="text-[9px] uppercase font-bold text-green-300">Suprimentos</span>
                <p className="text-sm font-black text-green-300">+ R$ {totalSuprimentos.toFixed(2)}</p>
              </div>
            </div>
          </div>

          {/* Faturamento do Turno por Forma de Pagamento */}
          <div className="bg-white dark:bg-[#160e2b] p-6 sm:p-8 rounded-[32px] shadow-sm border border-gray-100 dark:border-purple-900/40">
            <h3 className="text-sm font-black text-purple-950 dark:text-purple-100 uppercase mb-4 flex items-center gap-2">
              <i className="fa-solid fa-chart-pie text-purple-600"></i> Faturamento Deste Turno ({shiftSales.length} vendas)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="bg-emerald-50 dark:bg-emerald-950/40 p-4 rounded-2xl border border-emerald-100 dark:border-emerald-900/40">
                <span className="text-[9px] font-black uppercase text-emerald-800 dark:text-emerald-300 block">
                  Dinheiro
                </span>
                <p className="text-base sm:text-lg font-black text-emerald-900 dark:text-emerald-200 mt-1">
                  R$ {salesCash.toFixed(2)}
                </p>
              </div>
              <div className="bg-purple-50 dark:bg-purple-950/40 p-4 rounded-2xl border border-purple-100 dark:border-purple-900/40">
                <span className="text-[9px] font-black uppercase text-purple-800 dark:text-purple-300 block">PIX</span>
                <p className="text-base sm:text-lg font-black text-purple-900 dark:text-purple-200 mt-1">
                  R$ {salesPix.toFixed(2)}
                </p>
              </div>
              <div className="bg-blue-50 dark:bg-blue-950/40 p-4 rounded-2xl border border-blue-100 dark:border-blue-900/40">
                <span className="text-[9px] font-black uppercase text-blue-800 dark:text-blue-300 block">Débito</span>
                <p className="text-base sm:text-lg font-black text-blue-900 dark:text-blue-200 mt-1">
                  R$ {salesDebit.toFixed(2)}
                </p>
              </div>
              <div className="bg-indigo-50 dark:bg-indigo-950/40 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-900/40">
                <span className="text-[9px] font-black uppercase text-indigo-800 dark:text-indigo-300 block">
                  Crédito
                </span>
                <p className="text-base sm:text-lg font-black text-indigo-900 dark:text-indigo-200 mt-1">
                  R$ {salesCredit.toFixed(2)}
                </p>
              </div>
              <div className="bg-rose-50 dark:bg-rose-950/40 p-4 rounded-2xl border border-rose-100 dark:border-rose-900/40">
                <span className="text-[9px] font-black uppercase text-rose-800 dark:text-rose-300 block">
                  Fiados Registrados
                </span>
                <p className="text-base sm:text-lg font-black text-rose-900 dark:text-rose-200 mt-1">
                  R$ {salesFiado.toFixed(2)}
                </p>
              </div>
            </div>
          </div>

          {/* Histórico de Movimentações do Turno Atual */}
          {(currentShift.movimentacoes || []).length > 0 && (
            <div className="bg-white dark:bg-[#160e2b] p-6 rounded-[32px] shadow-sm border border-gray-100 dark:border-purple-900/40">
              <h4 className="text-xs font-black uppercase tracking-wider text-purple-950 dark:text-purple-200 mb-3">
                Movimentações do Turno Atual
              </h4>
              <div className="space-y-2">
                {currentShift.movimentacoes?.map((mov) => {
                  const isOut = mov.tipo === 'sangria' || mov.tipo === 'saida';
                  return (
                    <div
                      key={mov.id}
                      className="flex justify-between items-center p-3 rounded-2xl bg-gray-50 dark:bg-[#1f133d] border border-gray-100 dark:border-purple-900/30 text-xs gap-2"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={`w-8 h-8 rounded-xl flex items-center justify-center font-black shrink-0 ${
                            mov.tipo === 'saida'
                              ? 'bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-300'
                              : mov.tipo === 'sangria'
                              ? 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-300'
                              : 'bg-green-100 text-green-600 dark:bg-green-950 dark:text-green-300'
                          }`}
                        >
                          <i
                            className={`fa-solid ${
                              mov.tipo === 'saida'
                                ? 'fa-money-bill-transfer'
                                : mov.tipo === 'sangria'
                                ? 'fa-arrow-down'
                                : 'fa-arrow-up'
                            }`}
                          ></i>
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md ${
                                mov.tipo === 'saida'
                                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                                  : mov.tipo === 'sangria'
                                  ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                                  : 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
                              }`}
                            >
                              {mov.tipo === 'saida' ? mov.categoria || 'Saída' : mov.tipo}
                            </span>
                            <span className="font-black uppercase text-gray-900 dark:text-white truncate">
                              {mov.motivo}
                            </span>
                          </div>
                          <span className="text-[9px] text-gray-500 dark:text-gray-400">
                            {formatSafeTime(mov.data)} • {mov.operador_nome}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`font-black text-sm ${isOut ? 'text-rose-600 dark:text-rose-400' : 'text-green-600'}`}>
                          {isOut ? '-' : '+'} R$ {Number(mov.valor).toFixed(2)}
                        </span>
                        {mov.tipo !== 'saida' && onRemoveMovement && (
                          <button
                            type="button"
                            onClick={() => handleConfirmDeleteShiftMovement(mov.id, mov.motivo, Number(mov.valor))}
                            aria-label="Remover movimentação"
                            className="w-8 h-8 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 flex items-center justify-center"
                          >
                            <i className="fa-solid fa-trash text-[11px]"></i>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* SEÇÃO DEDICADA: SAÍDAS DE VALORES DO CAIXA */}
      <div className="bg-white dark:bg-[#160e2b] p-6 sm:p-8 rounded-[32px] shadow-sm border border-gray-100 dark:border-purple-900/40">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5">
          <div>
            <h3 className="text-sm font-black text-purple-950 dark:text-purple-100 uppercase flex items-center gap-2">
              <i className="fa-solid fa-money-bill-transfer text-rose-600"></i> Saídas de Valores Lançadas
            </h3>
            <p className="text-[10px] text-gray-500 font-bold uppercase mt-0.5">
              Registro de compras, pagamentos de fornecedores e despesas retiradas do caixa
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div className="flex bg-purple-50 dark:bg-[#20143a] p-1 rounded-xl border border-purple-100 dark:border-purple-900/40">
              {[
                { id: 'hoje', label: 'Hoje' },
                { id: '7dias', label: '7 Dias' },
                { id: 'todas', label: 'Todas' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setOutflowPeriod(tab.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${
                    outflowPeriod === tab.id
                      ? 'bg-purple-900 text-white shadow-sm'
                      : 'text-purple-800 dark:text-purple-200 hover:bg-purple-100/70'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleExportOutflowsCsv}
              className="px-3 py-2 rounded-xl bg-purple-50 dark:bg-[#20143a] hover:bg-purple-100 text-purple-900 dark:text-purple-200 border border-purple-200 dark:border-purple-800 text-[10px] font-black uppercase flex items-center gap-1.5 active:scale-95"
              title="Exportar CSV das saídas filtradas"
            >
              <i className="fa-solid fa-file-csv"></i> CSV
            </button>
          </div>
        </div>

        {/* Totalizador do período */}
        <div className="bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-900/50 rounded-2xl p-4 mb-4 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-black uppercase text-rose-700 dark:text-rose-300 block">
              Total de Saídas ({outflowPeriod === 'hoje' ? 'Hoje' : outflowPeriod === '7dias' ? 'Últimos 7 dias' : 'Todo o histórico'})
            </span>
            <span className="text-xs font-bold text-rose-600/80 dark:text-rose-300/80">
              {filteredOutflows.length} {filteredOutflows.length === 1 ? 'lançamento' : 'lançamentos'}
            </span>
          </div>
          <span className="text-2xl font-black text-rose-700 dark:text-rose-300">
            - R$ {totalFilteredOutflows.toFixed(2)}
          </span>
        </div>

        {filteredOutflows.length === 0 ? (
          <div className="text-center py-8 bg-gray-50/70 dark:bg-[#1f133d]/50 rounded-2xl border border-dashed border-purple-200 dark:border-purple-900/40">
            <i className="fa-solid fa-receipt text-3xl text-purple-300 mb-2 block"></i>
            <p className="text-xs font-black uppercase text-gray-500 dark:text-purple-300/70">
              Nenhuma saída de valor registrada neste período
            </p>
            <button
              type="button"
              onClick={() => setIsOutflowModalOpen(true)}
              className="mt-3 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-black uppercase active:scale-95"
            >
              + Lançar Primeira Saída
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredOutflows.map((outflow) => {
              const isCurrentShift = Boolean(currentShift && outflow.shift_id === currentShift.id);
              return (
                <div
                  key={outflow.id}
                  className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-gray-50 dark:bg-[#1f133d] border border-gray-100 dark:border-purple-900/30"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-300 flex items-center justify-center shrink-0">
                      <i className="fa-solid fa-arrow-up-from-bracket text-sm"></i>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-2 py-0.5 rounded-lg bg-purple-100 dark:bg-purple-900/60 text-purple-900 dark:text-purple-200 text-[9px] font-black uppercase">
                          {outflow.categoria}
                        </span>
                        {isCurrentShift && (
                          <span className="px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[9px] font-black uppercase">
                            Turno Atual
                          </span>
                        )}
                      </div>
                      <p className="text-xs sm:text-sm font-black text-purple-950 dark:text-white mt-1 truncate">
                        {outflow.motivo}
                      </p>
                      <p className="text-[10px] font-semibold text-gray-500 dark:text-purple-300/60 mt-0.5">
                        {formatSafeDateTime(outflow.data)} • {outflow.operador_nome}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm sm:text-base font-black text-rose-600 dark:text-rose-400">
                      - R$ {Number(outflow.valor).toFixed(2)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleConfirmDeleteOutflow(outflow)}
                      aria-label={`Excluir saída ${outflow.motivo}`}
                      className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-950/50 text-red-600 hover:bg-red-100 flex items-center justify-center active:scale-90"
                    >
                      <i className="fa-solid fa-trash text-xs"></i>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Histórico de Turnos Fechados Anteriores */}
      <div className="bg-white dark:bg-[#160e2b] p-6 sm:p-8 rounded-[32px] shadow-sm border border-gray-100 dark:border-purple-900/40">
        <h3 className="text-sm font-black text-purple-950 dark:text-purple-100 uppercase mb-4 flex items-center gap-2">
          <i className="fa-solid fa-clock-rotate-left text-purple-600"></i> Histórico de Fechamentos Anteriores
        </h3>

        {shifts.filter((s) => s.status === 'fechado').length === 0 ? (
          <p className="text-xs text-gray-400 font-bold text-center py-6">Nenhum turno anterior encerrado ainda.</p>
        ) : (
          <div className="space-y-3">
            {shifts
              .filter((s) => s.status === 'fechado')
              .slice(0, 10)
              .map((shift) => {
                const diff = shift.diferenca || 0;
                return (
                  <div
                    key={shift.id}
                    onClick={() => setSelectedShiftHistory(shift)}
                    className="flex flex-col sm:flex-row justify-between sm:items-center p-4 rounded-2xl bg-gray-50 dark:bg-[#1f133d] hover:bg-purple-50/50 dark:hover:bg-purple-900/30 transition-all border border-gray-100 dark:border-purple-900/30 cursor-pointer gap-2"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-black text-xs uppercase text-purple-950 dark:text-white">
                          {formatSafeDate(shift.aberto_em)} ({formatSafeTime(shift.aberto_em)} às{' '}
                          {shift.fechado_em ? formatSafeTime(shift.fechado_em) : '?'})
                        </span>
                        <span
                          className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full ${
                            diff === 0
                              ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
                              : diff > 0
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                              : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                          }`}
                        >
                          {diff === 0
                            ? 'Exato'
                            : diff > 0
                            ? `Sobra R$ ${diff.toFixed(2)}`
                            : `Falta R$ ${Math.abs(diff).toFixed(2)}`}
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                        Operador: {shift.fechado_por_nome || shift.aberto_por_nome}
                        {(shift.total_saidas || 0) > 0 && ` • Saídas: R$ ${Number(shift.total_saidas).toFixed(2)}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-[9px] uppercase font-bold text-gray-400 block">Total em Dinheiro Contado</span>
                      <span className="font-black text-sm text-purple-950 dark:text-white">
                        R$ {(Number(shift.valor_fechamento_informado) || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* MODAL: Lançar Saída de Valores */}
      <CashOutflowModal
        isOpen={isOutflowModalOpen}
        onClose={() => setIsOutflowModalOpen(false)}
        onConfirm={onAddOutflow}
        hasOpenShift={Boolean(currentShift)}
        expectedCashInDrawer={expectedCashInDrawer}
      />

      {/* MODAL: Sangria ou Suprimento */}
      {movementModal && (
        <div className="fixed inset-0 bg-black/80 z-[110] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#180e2f] rounded-[36px] p-6 sm:p-8 w-full max-w-sm shadow-2xl border border-purple-200 dark:border-purple-900/50">
            <h3 className="text-lg font-black uppercase text-purple-950 dark:text-purple-100 mb-2">
              {movementModal === 'sangria' ? '🔻 Registrar Sangria' : '🔺 Registrar Suprimento'}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-6 font-medium">
              {movementModal === 'sangria'
                ? 'Retirada de dinheiro da gaveta para cofre ou depósito.'
                : 'Entrada avulsa de dinheiro para reforço de troco.'}
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase ml-2 mb-1 block">Valor (R$)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={movementValue}
                  onChange={(e) => setMovementValue(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-[#22133f] border border-gray-200 dark:border-purple-900/50 rounded-2xl px-5 py-4 font-black text-xl text-purple-950 dark:text-white outline-none focus:border-purple-600"
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase ml-2 mb-1 block">Motivo / Descrição</label>
                <input
                  type="text"
                  placeholder={movementModal === 'sangria' ? 'Ex: Retirada para o cofre' : 'Ex: Reforço de moedas de troco'}
                  value={movementReason}
                  onChange={(e) => setMovementReason(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-[#22133f] border border-gray-200 dark:border-purple-900/50 rounded-2xl px-5 py-3 font-bold text-xs text-purple-950 dark:text-white outline-none focus:border-purple-600"
                />
              </div>

              <button
                type="button"
                onClick={handleAddMovement}
                disabled={isSubmitting}
                className="w-full bg-purple-900 hover:bg-black text-white py-4 rounded-2xl font-black text-xs uppercase shadow-lg transition-all active:scale-95 disabled:opacity-50 mt-2"
              >
                Confirmar Lançamento
              </button>
              <button
                type="button"
                onClick={() => setMovementModal(null)}
                className="w-full text-center text-xs font-bold text-gray-400 uppercase py-2 hover:text-gray-600"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Fechamento de Caixa com Conferência Cega */}
      {isClosingModal && (
        <div className="fixed inset-0 bg-black/80 z-[110] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#180e2f] rounded-[36px] p-6 sm:p-8 w-full max-w-md shadow-2xl border border-purple-200 dark:border-purple-900/50">
            <h3 className="text-xl font-black uppercase text-purple-950 dark:text-purple-100 mb-2">
              🔒 Fechamento de Turno
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-6 font-medium">
              Conte o dinheiro físico presente na gaveta e digite abaixo para auditoria.
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase ml-2 mb-1 block">
                  Total em Dinheiro Físico Contado (R$)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={countedCash}
                  onChange={(e) => setCountedCash(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-[#22133f] border border-gray-200 dark:border-purple-900/50 rounded-2xl px-5 py-4 font-black text-2xl text-purple-950 dark:text-white outline-none focus:border-purple-600"
                />
              </div>

              {countedCash.trim() &&
                (() => {
                  const parsedCounted = parseLocaleNumber(countedCash);
                  const diff = parsedCounted - expectedCashInDrawer;
                  return (
                    <div
                      className={`p-4 rounded-2xl border text-xs font-bold ${
                        diff === 0
                          ? 'bg-green-50 border-green-200 text-green-800 dark:bg-green-950/60 dark:border-green-800 dark:text-green-300'
                          : diff > 0
                          ? 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/60 dark:border-blue-800 dark:text-blue-300'
                          : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/60 dark:border-red-800 dark:text-red-300'
                      }`}
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span>Esperado pelo Sistema:</span>
                        <span>R$ {expectedCashInDrawer.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center mb-1">
                        <span>Informado por Você:</span>
                        <span>R$ {parsedCounted.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t font-black uppercase text-sm">
                        <span>Resultado da Conferência:</span>
                        <span>
                          {diff === 0
                            ? '✅ Perfeito (Zero diferença)'
                            : diff > 0
                            ? `🟢 Sobra de R$ ${diff.toFixed(2)}`
                            : `🔴 Falta de R$ ${Math.abs(diff).toFixed(2)}`}
                        </span>
                      </div>
                    </div>
                  );
                })()}

              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase ml-2 mb-1 block">
                  Observações do Fechamento
                </label>
                <textarea
                  rows={2}
                  placeholder="Ex: Tudo correto, troco deixado na gaveta para amanhã."
                  value={closingNotes}
                  onChange={(e) => setClosingNotes(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-[#22133f] border border-gray-200 dark:border-purple-900/50 rounded-2xl px-4 py-3 text-xs font-semibold text-purple-950 dark:text-white outline-none focus:border-purple-600"
                />
              </div>

              <button
                type="button"
                onClick={handleConfirmCloseShift}
                disabled={isSubmitting || !countedCash}
                className="w-full bg-purple-900 hover:bg-black text-white py-4 rounded-2xl font-black text-xs uppercase shadow-lg transition-all active:scale-95 disabled:opacity-50 mt-2"
              >
                Confirmar Fechamento de Caixa
              </button>
              <button
                type="button"
                onClick={() => setIsClosingModal(false)}
                className="w-full text-center text-xs font-bold text-gray-400 uppercase py-2 hover:text-gray-600"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Detalhes de Turno Anterior */}
      {selectedShiftHistory && (
        <div className="fixed inset-0 bg-black/80 z-[110] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#180e2f] rounded-[36px] p-6 sm:p-8 w-full max-w-md shadow-2xl border border-purple-200 dark:border-purple-900/50 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-black uppercase text-purple-950 dark:text-purple-100">
                Resumo do Turno Encerrado
              </h3>
              <button
                type="button"
                onClick={() => setSelectedShiftHistory(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-gray-50 dark:bg-[#22133f] rounded-2xl">
                <p className="font-bold">Abertura: {formatSafeDateTime(selectedShiftHistory.aberto_em)}</p>
                <p className="font-bold">
                  Fechamento: {selectedShiftHistory.fechado_em ? formatSafeDateTime(selectedShiftHistory.fechado_em) : '-'}
                </p>
                <p className="text-gray-500">
                  Operador: {selectedShiftHistory.fechado_por_nome || selectedShiftHistory.aberto_por_nome}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-3 bg-gray-50 dark:bg-[#22133f] rounded-2xl">
                  <span className="text-[9px] uppercase font-bold text-gray-500">Fundo Inicial</span>
                  <p className="font-black text-sm">R$ {(Number(selectedShiftHistory.valor_abertura) || 0).toFixed(2)}</p>
                </div>
                <div className="p-3 bg-gray-50 dark:bg-[#22133f] rounded-2xl">
                  <span className="text-[9px] uppercase font-bold text-gray-500">Dinheiro Contado</span>
                  <p className="font-black text-sm">
                    R$ {(Number(selectedShiftHistory.valor_fechamento_informado) || 0).toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border border-purple-100 dark:border-purple-900/40 space-y-1">
                <div className="flex justify-between">
                  <span>Vendas Dinheiro:</span>
                  <span className="font-bold">R$ {(Number(selectedShiftHistory.total_vendas_dinheiro) || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Vendas PIX:</span>
                  <span className="font-bold">R$ {(Number(selectedShiftHistory.total_vendas_pix) || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Vendas Débito:</span>
                  <span className="font-bold">R$ {(Number(selectedShiftHistory.total_vendas_debito) || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Vendas Crédito:</span>
                  <span className="font-bold">R$ {(Number(selectedShiftHistory.total_vendas_credito) || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Vendas Fiado:</span>
                  <span className="font-bold">R$ {(Number(selectedShiftHistory.total_vendas_fiado) || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between pt-2 mt-1 border-t border-purple-200 dark:border-purple-800 text-rose-600 dark:text-rose-300">
                  <span>Saídas de Valores:</span>
                  <span className="font-bold">- R$ {(Number(selectedShiftHistory.total_saidas) || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-red-600 dark:text-red-300">
                  <span>Sangrias:</span>
                  <span className="font-bold">- R$ {(Number(selectedShiftHistory.total_sangrias) || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-emerald-600 dark:text-emerald-300">
                  <span>Suprimentos:</span>
                  <span className="font-bold">+ R$ {(Number(selectedShiftHistory.total_suprimentos) || 0).toFixed(2)}</span>
                </div>
              </div>

              {selectedShiftHistory.observacoes_fechamento && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-2xl text-[11px] text-amber-900 dark:text-amber-200">
                  <span className="font-black uppercase block text-[9px]">Observações:</span>
                  {selectedShiftHistory.observacoes_fechamento}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CashRegisterView;
