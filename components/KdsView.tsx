import React, { useState, useEffect, useRef } from 'react';
import { Sale, SaleItem, User, UserRole, PaymentMethod } from '../types';
import { playOrderAlert } from '../utils/soundUtils';
import { formatSafeDateTime } from '../utils/browserUtils';
import { useFeedback } from './FeedbackProvider';

export interface FinalizeKdsPayload {
  itens: SaleItem[];
  restoreStock: boolean;
  valor_total: number;
  valor_original?: number;
  status: 'pago' | 'pendente' | 'cancelado';
  forma_pagamento?: PaymentMethod;
  forma_pagamento_original?: PaymentMethod;
  possui_nao_retirado: boolean;
  motivo_nao_retirado?: string;
  logDetalhes?: string;
}

interface KdsViewProps {
  sales: Sale[];
  onUpdateSale: (id: string, data: any) => Promise<void>;
  onFinalizeWithUnclaimed?: (saleId: string, payload: FinalizeKdsPayload) => Promise<void>;
  currentUser?: User | null;
}

const getOrderProgress = (itens?: SaleItem[]) => {
  const list = itens || [];
  let totalUnits = 0;
  let deliveredUnits = 0;

  list.forEach((item) => {
    const qty = Math.max(1, Number(item.quantidade) || 1);
    const deliv = Math.min(qty, Math.max(0, Number(item.quantidade_entregue) || 0));
    totalUnits += qty;
    deliveredUnits += deliv;
  });

  return {
    totalUnits,
    deliveredUnits,
    remainingUnits: Math.max(0, totalUnits - deliveredUnits),
    percent: totalUnits > 0 ? Math.round((deliveredUnits / totalUnits) * 100) : 0
  };
};

const QUICK_UNCLAIMED_REASONS = [
  'Cliente não compareceu',
  'Desistência no balcão',
  'Produto indisponível'
];

const KdsView: React.FC<KdsViewProps> = ({
  sales,
  onUpdateSale,
  onFinalizeWithUnclaimed,
  currentUser
}) => {
  const { showToast, confirmAction } = useFeedback();
  const isAdmin = currentUser?.perfil === UserRole.ADMIN || currentUser?.id === 'super-admin';
  const [showAll, setShowAll] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [updatingIds, setUpdatingIds] = useState<Record<string, boolean>>({});

  // Estados do Modal "Finalizar com Produto Não Retirado"
  const [unclaimedModalSale, setUnclaimedModalSale] = useState<Sale | null>(null);
  const [draftDeliveredMap, setDraftDeliveredMap] = useState<Record<number, number>>({});
  const [restoreStockOnUnclaimed, setRestoreStockOnUnclaimed] = useState(true);
  const [deductValueOnUnclaimed, setDeductValueOnUnclaimed] = useState(true);
  const [unclaimedReason, setUnclaimedReason] = useState('');
  const [isSubmittingUnclaimed, setIsSubmittingUnclaimed] = useState(false);

  // Filtra as vendas com base nas permissões/configurações
  const kdsSales = sales.filter((s) => {
    const isReserva = s.tipo_pedido === 'reserva';
    if (!isAdmin && !showAll) return isReserva;
    if (showAll) return true;
    return isReserva;
  });

  // Pendentes e parciais ficam na fila ativa do KDS
  const pendingDeliveries = kdsSales.filter(
    (s) => s.status_entrega !== 'entregue' && s.tipo_pedido === 'reserva' && s.status !== 'cancelado'
  );
  const partialCount = pendingDeliveries.filter(
    (s) => s.status_entrega === 'parcial' || getOrderProgress(s.itens).deliveredUnits > 0
  ).length;

  const recentDeliveredReservas = kdsSales
    .filter((s) => s.tipo_pedido === 'reserva' && s.status_entrega === 'entregue')
    .slice(0, 8);

  const prevCountRef = useRef(pendingDeliveries.length);

  // Alerta sonoro quando entra nova reserva
  useEffect(() => {
    if (pendingDeliveries.length > prevCountRef.current) {
      if (soundEnabled) {
        playOrderAlert();
      }
    }
    prevCountRef.current = pendingDeliveries.length;
  }, [pendingDeliveries.length, soundEnabled]);

  // Mostrar também balcão no all
  const allOtherSales = kdsSales.filter(
    (s) => s.status_entrega === 'entregue' || s.tipo_pedido !== 'reserva'
  );

  const getWaitBadge = (createdAt: string) => {
    const diffMin = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
    if (diffMin < 10) {
      return { text: `Há ${diffMin}m`, cls: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300' };
    }
    if (diffMin < 20) {
      return { text: `Há ${diffMin}m`, cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' };
    }
    return {
      text: `⚠️ Há ${diffMin}m`,
      cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 animate-pulse font-black'
    };
  };

  const applyItemDeliveredQuantity = async (sale: Sale, itemIndex: number, nextDeliveredQty: number) => {
    if (updatingIds[sale.id]) return;
    const itens = sale.itens || [];
    if (!itens[itemIndex]) return;

    const targetItem = itens[itemIndex];
    const maxQty = Math.max(1, Number(targetItem.quantidade) || 1);
    const clampedQty = Math.min(maxQty, Math.max(0, nextDeliveredQty));

    const updatedItens: SaleItem[] = itens.map((it, idx) =>
      idx === itemIndex
        ? { ...it, quantidade_entregue: clampedQty, quantidade_nao_retirada: 0 }
        : it
    );

    const progress = getOrderProgress(updatedItens);
    const nextStatus: 'pendente' | 'parcial' | 'entregue' =
      progress.totalUnits > 0 && progress.deliveredUnits >= progress.totalUnits
        ? 'entregue'
        : progress.deliveredUnits > 0
        ? 'parcial'
        : 'pendente';

    const logDetalhes =
      nextStatus === 'entregue'
        ? `Pedido de ${sale.cliente_nome || 'Cliente'} (#${sale.id.slice(-6).toUpperCase()}) 100% entregue no KDS (${progress.deliveredUnits}/${progress.totalUnits} itens).`
        : nextStatus === 'parcial'
        ? `Baixa parcial em ${sale.cliente_nome || 'Cliente'} (#${sale.id.slice(-6).toUpperCase()}): ${targetItem.nome} (${clampedQty}/${maxQty}) • Total ${progress.deliveredUnits}/${progress.totalUnits}.`
        : `Item ${targetItem.nome} retornado para pendente em ${sale.cliente_nome || 'Cliente'} (#${sale.id.slice(-6).toUpperCase()}).`;

    setUpdatingIds((prev) => ({ ...prev, [sale.id]: true }));
    try {
      await onUpdateSale(sale.id, {
        itens: updatedItens,
        status_entrega: nextStatus,
        logDetalhes
      });
      if (nextStatus === 'entregue') {
        showToast(`Pedido de ${sale.cliente_nome || 'Cliente'} 100% entregue!`, 'success');
      } else if (nextStatus === 'parcial') {
        showToast(
          `Baixa parcial: ${progress.deliveredUnits}/${progress.totalUnits} itens entregues.`,
          'info'
        );
      } else {
        showToast('Item voltou para pendente.', 'info');
      }
    } catch (e: any) {
      showToast('Erro ao atualizar entrega parcial: ' + (e?.message || 'Tente novamente'), 'error');
    } finally {
      setUpdatingIds((prev) => ({ ...prev, [sale.id]: false }));
    }
  };

  const handleConfirmFullDelivery = async (sale: Sale) => {
    if (updatingIds[sale.id]) return;
    const updatedItens: SaleItem[] = (sale.itens || []).map((it) => ({
      ...it,
      quantidade_entregue: Math.max(1, Number(it.quantidade) || 1),
      quantidade_nao_retirada: 0
    }));

    setUpdatingIds((prev) => ({ ...prev, [sale.id]: true }));
    try {
      await onUpdateSale(sale.id, {
        itens: updatedItens,
        status_entrega: 'entregue',
        possui_nao_retirado: false,
        logDetalhes: `Entrega total confirmada para ${sale.cliente_nome || 'Cliente'} (#${sale.id.slice(-6).toUpperCase()}).`
      });
      showToast('Entrega total confirmada!', 'success');
    } catch (e: any) {
      showToast('Erro ao confirmar entrega: ' + (e?.message || 'Tente novamente'), 'error');
    } finally {
      setUpdatingIds((prev) => ({ ...prev, [sale.id]: false }));
    }
  };

  const openUnclaimedModal = (sale: Sale) => {
    const initialMap: Record<number, number> = {};
    (sale.itens || []).forEach((it, idx) => {
      const qty = Math.max(1, Number(it.quantidade) || 1);
      const deliv = Math.min(qty, Math.max(0, Number(it.quantidade_entregue) || 0));
      initialMap[idx] = deliv;
    });
    setDraftDeliveredMap(initialMap);
    setRestoreStockOnUnclaimed(true);
    setDeductValueOnUnclaimed(sale.status === 'pendente');
    setUnclaimedReason('');
    setUnclaimedModalSale(sale);
  };

  const handleConfirmUnclaimedFinalize = async () => {
    if (!unclaimedModalSale || isSubmittingUnclaimed) return;
    const itens = unclaimedModalSale.itens || [];

    const finalizedItens: SaleItem[] = itens.map((it, idx) => {
      const qty = Math.max(1, Number(it.quantidade) || 1);
      const delivered = Math.min(qty, Math.max(0, Number(draftDeliveredMap[idx] ?? it.quantidade_entregue ?? 0)));
      const naoRetirada = Math.max(0, qty - delivered);
      return {
        ...it,
        quantidade_entregue: delivered,
        quantidade_nao_retirada: naoRetirada
      };
    });

    const totalUnclaimed = finalizedItens.reduce((acc, it) => acc + (Number(it.quantidade_nao_retirada) || 0), 0);
    if (totalUnclaimed === 0) {
      setUnclaimedModalSale(null);
      await handleConfirmFullDelivery(unclaimedModalSale);
      return;
    }

    const originalTotal = Number(unclaimedModalSale.valor_original ?? unclaimedModalSale.valor_total) || 0;
    const deliveredValue = Number(
      finalizedItens
        .reduce((acc, it) => acc + (Number(it.preco_unitario) || 0) * (Number(it.quantidade_entregue) || 0), 0)
        .toFixed(2)
    );
    const isPendingOrder = unclaimedModalSale.status === 'pendente';
    const nextTotal = deductValueOnUnclaimed ? deliveredValue : Number(unclaimedModalSale.valor_total) || 0;
    const nextStatus: 'pago' | 'pendente' | 'cancelado' =
      deductValueOnUnclaimed && nextTotal <= 0 && isPendingOrder
        ? 'cancelado'
        : unclaimedModalSale.status;

    const shouldSendToFiado = isPendingOrder && nextStatus === 'pendente' && nextTotal > 0;
    const nextFormaPagamento = shouldSendToFiado ? PaymentMethod.FIADO : unclaimedModalSale.forma_pagamento;
    const originalFormaPagamento =
      shouldSendToFiado && unclaimedModalSale.forma_pagamento !== PaymentMethod.FIADO
        ? unclaimedModalSale.forma_pagamento_original || unclaimedModalSale.forma_pagamento
        : unclaimedModalSale.forma_pagamento_original;

    const unclaimedSummary = finalizedItens
      .filter((it) => (it.quantidade_nao_retirada || 0) > 0)
      .map((it) => `${it.quantidade_nao_retirada}x ${it.nome}`)
      .join(', ');

    const logDetalhes = `KDS finalizado c/ não retirado para ${unclaimedModalSale.cliente_nome || 'Cliente'} (#${unclaimedModalSale.id
      .slice(-6)
      .toUpperCase()}): Não retirado [${unclaimedSummary}]${
      restoreStockOnUnclaimed ? ' • Estoque devolvido' : ''
    }${deductValueOnUnclaimed ? ` • Cobrado somente retirado: R$ ${nextTotal.toFixed(2)}` : ''}${
      shouldSendToFiado ? ' • Enviado ao Fiado' : ''
    }${unclaimedReason.trim() ? ` • Motivo: ${unclaimedReason.trim()}` : ''}.`;

    const payload: FinalizeKdsPayload = {
      itens: finalizedItens,
      restoreStock: restoreStockOnUnclaimed,
      valor_total: nextTotal,
      valor_original: originalTotal,
      status: nextStatus,
      forma_pagamento: nextFormaPagamento,
      ...(originalFormaPagamento ? { forma_pagamento_original: originalFormaPagamento } : {}),
      possui_nao_retirado: true,
      ...(unclaimedReason.trim() ? { motivo_nao_retirado: unclaimedReason.trim() } : {}),
      logDetalhes
    };

    setIsSubmittingUnclaimed(true);
    setUpdatingIds((prev) => ({ ...prev, [unclaimedModalSale.id]: true }));
    try {
      if (onFinalizeWithUnclaimed) {
        await onFinalizeWithUnclaimed(unclaimedModalSale.id, payload);
      } else {
        await onUpdateSale(unclaimedModalSale.id, {
          itens: payload.itens,
          status_entrega: 'entregue',
          possui_nao_retirado: true,
          valor_total: payload.valor_total,
          valor_original: payload.valor_original,
          status: payload.status,
          forma_pagamento: payload.forma_pagamento,
          ...(payload.forma_pagamento_original ? { forma_pagamento_original: payload.forma_pagamento_original } : {}),
          ...(payload.motivo_nao_retirado ? { motivo_nao_retirado: payload.motivo_nao_retirado } : {}),
          logDetalhes
        });
      }

      showToast(
        shouldSendToFiado
          ? `Finalizado! Enviado ao Fiado cobrando somente R$ ${nextTotal.toFixed(2)} retirado.`
          : nextStatus === 'cancelado'
          ? 'Pedido encerrado como não retirado (R$ 0,00).'
          : `Pedido finalizado com ${totalUnclaimed} ${totalUnclaimed === 1 ? 'item não retirado' : 'itens não retirados'}!`,
        'success'
      );
      setUnclaimedModalSale(null);
    } catch (e: any) {
      showToast('Erro ao finalizar pedido no KDS: ' + (e?.message || 'Tente novamente'), 'error');
    } finally {
      setIsSubmittingUnclaimed(false);
      setUpdatingIds((prev) => ({ ...prev, [unclaimedModalSale.id]: false }));
    }
  };

  const handleReopenOrder = async (sale: Sale) => {
    const hadUnclaimed = Boolean(
      sale.possui_nao_retirado || (sale.itens || []).some((it) => (it.quantidade_nao_retirada || 0) > 0)
    );
    const confirmed = await confirmAction({
      title: 'Reabrir Pedido no KDS',
      message: hadUnclaimed
        ? `Deseja retornar o pedido de ${sale.cliente_nome || 'Cliente'} para a fila do KDS? O valor original será restaurado (lembre-se de conferir o estoque caso tenha sido devolvido).`
        : `Deseja retornar o pedido de ${sale.cliente_nome || 'Cliente'} para a fila de preparo/entrega do KDS?`,
      confirmLabel: 'Reabrir Pedido'
    });
    if (!confirmed) return;

    const resetItens: SaleItem[] = (sale.itens || []).map((it) => ({
      ...it,
      quantidade_entregue: 0,
      quantidade_nao_retirada: 0
    }));

    const restoredTotal =
      sale.valor_original !== undefined && sale.valor_original > sale.valor_total
        ? sale.valor_original
        : sale.valor_total;
    const restoredStatus: 'pago' | 'pendente' | 'cancelado' =
      sale.status === 'cancelado' ? 'pendente' : sale.status;

    setUpdatingIds((prev) => ({ ...prev, [sale.id]: true }));
    try {
      await onUpdateSale(sale.id, {
        itens: resetItens,
        status_entrega: 'pendente',
        possui_nao_retirado: false,
        motivo_nao_retirado: '',
        valor_total: restoredTotal,
        status: restoredStatus,
        ...(sale.forma_pagamento_original ? { forma_pagamento: sale.forma_pagamento_original } : {}),
        logDetalhes: `Pedido de ${sale.cliente_nome || 'Cliente'} (#${sale.id.slice(-6).toUpperCase()}) reaberto no KDS.`
      });
      showToast('Pedido retornado para a fila pendente.', 'info');
    } catch (e: any) {
      showToast('Erro ao reabrir pedido: ' + (e?.message || 'Tente novamente'), 'error');
    } finally {
      setUpdatingIds((prev) => ({ ...prev, [sale.id]: false }));
    }
  };

  const handleCobrarPix = async (saleId: string) => {
    try {
      await onUpdateSale(saleId, { status: 'pago' });
      showToast('Pagamento PIX baixado!', 'success');
    } catch (e: any) {
      showToast('Erro ao confirmar pagamento: ' + (e?.message || 'Tente novamente'), 'error');
    }
  };

  // Totais calculados ao vivo para o modal de não retirado
  const unclaimedSummaryStats = React.useMemo(() => {
    if (!unclaimedModalSale) {
      return { deliveredUnits: 0, unclaimedUnits: 0, deliveredValue: 0, unclaimedValue: 0, totalOriginal: 0 };
    }
    let deliveredUnits = 0;
    let unclaimedUnits = 0;
    let deliveredValue = 0;
    let unclaimedValue = 0;

    (unclaimedModalSale.itens || []).forEach((it, idx) => {
      const qty = Math.max(1, Number(it.quantidade) || 1);
      const delivered = Math.min(qty, Math.max(0, Number(draftDeliveredMap[idx] ?? 0)));
      const unclaimed = Math.max(0, qty - delivered);
      const unitPrice = Number(it.preco_unitario) || 0;

      deliveredUnits += delivered;
      unclaimedUnits += unclaimed;
      deliveredValue += delivered * unitPrice;
      unclaimedValue += unclaimed * unitPrice;
    });

    return {
      deliveredUnits,
      unclaimedUnits,
      deliveredValue: Number(deliveredValue.toFixed(2)),
      unclaimedValue: Number(unclaimedValue.toFixed(2)),
      totalOriginal: Number(unclaimedModalSale.valor_original ?? unclaimedModalSale.valor_total) || 0
    };
  }, [unclaimedModalSale, draftDeliveredMap]);

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">
      <div className="bg-purple-900 text-white p-6 sm:p-8 rounded-[40px] shadow-xl flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight">KDS - Cozinha e Entregas</h2>
          <p className="opacity-75 text-[10px] font-bold uppercase mt-1">
            Dê baixa parcial por item, entregue tudo ou finalize com produto não retirado
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`px-3 py-2 rounded-2xl text-[10px] font-black uppercase transition-all flex items-center gap-2 border ${
              soundEnabled
                ? 'bg-amber-400 text-purple-950 border-amber-300 shadow-md'
                : 'bg-white/10 text-white/70 border-white/20'
            }`}
          >
            <i className={`fa-solid ${soundEnabled ? 'fa-bell' : 'fa-bell-slash'}`}></i>
            <span>{soundEnabled ? 'Alerta Sonoro Ativo' : 'Som Mudo'}</span>
          </button>
          {isAdmin && (
            <div className="flex items-center gap-3 bg-white/10 p-2.5 rounded-2xl">
              <span className="text-[10px] font-black uppercase">Todos</span>
              <button
                type="button"
                onClick={() => setShowAll(!showAll)}
                className={`w-12 h-6 rounded-full transition-colors relative ${showAll ? 'bg-green-500' : 'bg-gray-500'}`}
              >
                <div
                  className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${showAll ? 'left-7' : 'left-1'}`}
                ></div>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 ml-2">
          <h3 className="text-sm font-black text-purple-900 dark:text-purple-200 uppercase border-b-2 border-purple-100 dark:border-purple-900 pb-1.5 inline-block">
            Reservas Pendentes ({pendingDeliveries.length})
          </h3>
          {partialCount > 0 && (
            <span className="px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 text-[10px] font-black uppercase">
              {partialCount} {partialCount === 1 ? 'Entrega Parcial' : 'Entregas Parciais'}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pendingDeliveries.map((sale) => {
            const badge = getWaitBadge(sale.created_at);
            const progress = getOrderProgress(sale.itens);
            const isPartial = sale.status_entrega === 'parcial' || progress.deliveredUnits > 0;
            const isBusy = Boolean(updatingIds[sale.id]);

            return (
              <div
                key={sale.id}
                className={`bg-white dark:bg-[#160e2b] p-5 sm:p-6 rounded-3xl shadow-sm border-2 relative overflow-hidden flex flex-col transition-all ${
                  isPartial
                    ? 'border-amber-400 dark:border-amber-600/80'
                    : 'border-orange-200 dark:border-purple-900/60'
                }`}
              >
                <div className="absolute top-0 right-0 flex items-center">
                  <span className={`px-3 py-1 rounded-bl-2xl font-black text-[9px] uppercase ${badge.cls}`}>
                    {badge.text}
                  </span>
                  <span
                    className={`px-3 py-1 font-black text-[9px] uppercase ${
                      isPartial
                        ? 'bg-amber-400 text-purple-950'
                        : 'bg-orange-100 dark:bg-orange-950/80 text-orange-700 dark:text-orange-300'
                    }`}
                  >
                    {isPartial ? `Parcial (${progress.deliveredUnits}/${progress.totalUnits})` : 'Aguardando'}
                  </span>
                </div>

                <div className="mb-3 pr-24">
                  <h4 className="font-black text-purple-950 dark:text-white uppercase text-lg leading-tight">
                    {sale.cliente_nome || 'Cliente'}
                  </h4>
                  <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-1">
                    <i className="fa-brands fa-whatsapp text-green-500"></i> {sale.telefone_comprador || 'Sem telefone'}
                  </p>
                  <p className="text-[9px] font-bold text-gray-400 mt-0.5">{formatSafeDateTime(sale.created_at)}</p>
                </div>

                {/* Barra de Progresso de Entrega Parcial */}
                <div className="mb-3">
                  <div className="flex justify-between items-center text-[10px] font-black uppercase mb-1">
                    <span className="text-purple-900/70 dark:text-purple-300">Progresso da Baixa</span>
                    <span className={isPartial ? 'text-amber-600 dark:text-amber-300' : 'text-gray-400'}>
                      {progress.deliveredUnits}/{progress.totalUnits} itens ({progress.percent}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-purple-100 dark:bg-purple-950 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        progress.percent > 0 ? 'bg-emerald-500' : 'bg-purple-300'
                      }`}
                      style={{ width: `${progress.percent}%` }}
                    ></div>
                  </div>
                </div>

                {/* Lista Interativa de Itens para Baixa Parcial */}
                <div className="bg-gray-50 dark:bg-[#20143a] p-3 rounded-2xl flex-1 mb-4 border border-gray-100 dark:border-purple-900/40 space-y-2">
                  {(sale.itens || []).map((item, idx) => {
                    const qty = Math.max(1, Number(item.quantidade) || 1);
                    const delivered = Math.min(qty, Math.max(0, Number(item.quantidade_entregue) || 0));
                    const remaining = qty - delivered;
                    const itemDone = remaining === 0;
                    const itemPartial = delivered > 0 && remaining > 0;

                    return (
                      <div
                        key={idx}
                        className={`p-2.5 rounded-xl border transition-all flex items-center justify-between gap-2 ${
                          itemDone
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60'
                            : itemPartial
                            ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60'
                            : 'bg-white dark:bg-[#160e2b] border-gray-200 dark:border-purple-900/40'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-xs font-black uppercase truncate ${
                                itemDone
                                  ? 'line-through text-emerald-800 dark:text-emerald-300 opacity-75'
                                  : 'text-purple-950 dark:text-white'
                              }`}
                            >
                              {qty}x {item.nome}
                            </span>
                          </div>
                          <span
                            className={`text-[10px] font-bold block mt-0.5 ${
                              itemDone
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : itemPartial
                                ? 'text-amber-700 dark:text-amber-300'
                                : 'text-gray-400'
                            }`}
                          >
                            {itemDone
                              ? 'Entregue completo'
                              : itemPartial
                              ? `${delivered}/${qty} entregue • falta ${remaining}`
                              : qty > 1
                              ? `0/${qty} entregues`
                              : 'Aguardando preparo'}
                          </span>
                        </div>

                        {/* Controles de Baixa Parcial */}
                        {qty === 1 ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => applyItemDeliveredQuantity(sale, idx, itemDone ? 0 : 1)}
                            className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all active:scale-95 shrink-0 flex items-center gap-1.5 ${
                              itemDone
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'bg-purple-100 dark:bg-purple-900/70 hover:bg-purple-900 hover:text-white text-purple-900 dark:text-purple-100'
                            }`}
                          >
                            <i className={`fa-solid ${itemDone ? 'fa-check' : 'fa-hand-holding'}`}></i>
                            <span>{itemDone ? 'Entregue' : 'Baixar'}</span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              disabled={isBusy || delivered === 0}
                              onClick={() => applyItemDeliveredQuantity(sale, idx, delivered - 1)}
                              aria-label={`Diminuir entrega de ${item.nome}`}
                              className="w-8 h-8 rounded-lg bg-white dark:bg-[#160e2b] border border-gray-200 dark:border-purple-800 text-purple-950 dark:text-white font-black text-sm disabled:opacity-35 active:scale-90"
                            >
                              -
                            </button>
                            <button
                              type="button"
                              disabled={isBusy || itemDone}
                              onClick={() => applyItemDeliveredQuantity(sale, idx, delivered + 1)}
                              aria-label={`Entregar 1 unidade de ${item.nome}`}
                              className="px-2.5 h-8 rounded-lg bg-purple-900 hover:bg-purple-950 text-white font-black text-[10px] uppercase disabled:opacity-35 active:scale-90"
                            >
                              +1
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => applyItemDeliveredQuantity(sale, idx, itemDone ? 0 : qty)}
                              title={itemDone ? 'Desmarcar item' : `Baixar todos (${qty})`}
                              className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs transition-all active:scale-90 ${
                                itemDone
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-600 hover:text-white'
                              }`}
                            >
                              <i className={`fa-solid ${itemDone ? 'fa-rotate-left' : 'fa-check-double'}`}></i>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="flex justify-between items-center mb-4 bg-purple-50 dark:bg-purple-950/60 p-3 rounded-2xl border border-purple-100 dark:border-purple-900/40">
                  <div className="flex flex-col">
                    <span className="text-[8px] font-black uppercase text-purple-600 dark:text-purple-300">Total</span>
                    <span className="text-sm font-black text-purple-950 dark:text-white">
                      R$ {(Number(sale.valor_total) || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[8px] font-black uppercase text-purple-600 dark:text-purple-300">
                      Pagamento
                    </span>
                    <span
                      className={`text-[10px] font-black uppercase px-2 py-1 rounded-md mt-1 ${
                        sale.status === 'pago'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {sale.forma_pagamento} - {sale.status}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 mt-auto">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleConfirmFullDelivery(sale)}
                    className={`w-full py-4 rounded-2xl font-black text-[10px] uppercase transition-all shadow-lg active:scale-95 disabled:opacity-50 ${
                      isPartial
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20'
                        : 'bg-green-500 hover:bg-green-600 text-white shadow-green-500/20'
                    }`}
                  >
                    {isPartial
                      ? `Entregar Restante (${progress.remainingUnits} ${progress.remainingUnits === 1 ? 'item' : 'itens'})`
                      : 'Confirmar Entrega Total'}
                  </button>

                  {progress.remainingUnits > 0 && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => openUnclaimedModal(sale)}
                      className="w-full py-3 rounded-2xl font-black text-[10px] uppercase bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/70 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <i className="fa-solid fa-box-open"></i>
                      <span>
                        {progress.deliveredUnits > 0
                          ? `Finalizar Só Retirado → Fiado (${progress.remainingUnits} não ret.)`
                          : `Finalizar c/ Não Retirado (${progress.remainingUnits} un.)`}
                      </span>
                    </button>
                  )}

                  {(isAdmin || currentUser?.perfil === UserRole.KDS) && sale.status === 'pendente' && (
                    <div className="flex gap-2">
                      {isAdmin && sale.forma_pagamento === PaymentMethod.PIX && (
                        <button
                          type="button"
                          onClick={() => handleCobrarPix(sale.id)}
                          className="w-full flex items-center justify-center gap-2 bg-purple-100 dark:bg-purple-900 hover:bg-purple-200 text-purple-700 dark:text-purple-100 py-3 rounded-xl font-black text-[9px] uppercase transition-all"
                        >
                          <i className="fa-solid fa-check"></i> Baixa PIX
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {pendingDeliveries.length === 0 && (
            <div className="col-span-full text-center py-16 bg-white dark:bg-[#160e2b] rounded-[32px] border border-gray-100 dark:border-purple-900/40 shadow-sm">
              <i className="fa-solid fa-check-double text-5xl mb-4 text-green-400"></i>
              <p className="text-sm font-black uppercase tracking-widest text-gray-500 dark:text-purple-300">
                Nenhuma reserva pendente
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Entregues Recentemente (permite desfazer / reabrir caso necessário) */}
      {recentDeliveredReservas.length > 0 && (
        <div className="space-y-3 pt-4">
          <h3 className="text-xs font-black text-gray-500 dark:text-purple-300 uppercase ml-2">
            Finalizados Recentemente ({recentDeliveredReservas.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {recentDeliveredReservas.map((sale) => {
              const hasUnclaimed = Boolean(
                sale.possui_nao_retirado || (sale.itens || []).some((it) => (it.quantidade_nao_retirada || 0) > 0)
              );
              return (
                <div
                  key={sale.id}
                  className={`bg-white dark:bg-[#160e2b] p-4 rounded-2xl border flex flex-col justify-between gap-2 ${
                    hasUnclaimed
                      ? 'border-rose-200 dark:border-rose-900/50'
                      : 'border-gray-100 dark:border-purple-900/40'
                  }`}
                >
                  <div>
                    <div className="flex justify-between items-start gap-2">
                      <h4 className="font-black text-purple-950 dark:text-white uppercase text-xs truncate">
                        {sale.cliente_nome || 'Cliente'}
                      </h4>
                      <span
                        className={`text-[8px] font-black px-2 py-0.5 rounded uppercase shrink-0 ${
                          hasUnclaimed
                            ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                            : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        {hasUnclaimed ? 'c/ Não Retirado' : 'Entregue'}
                      </span>
                    </div>
                    <p className="text-[9px] font-bold text-gray-400 mt-0.5">{formatSafeDateTime(sale.created_at)}</p>
                    <div className="mt-2 space-y-1">
                      {(sale.itens || []).map((it, idx) => {
                        const qty = Math.max(1, Number(it.quantidade) || 1);
                        const unret = Math.max(0, Number(it.quantidade_nao_retirada) || 0);
                        const deliv = Math.max(0, qty - unret);
                        return (
                          <div key={idx} className="text-[10px] flex justify-between items-center gap-1">
                            <span className="text-gray-700 dark:text-purple-200 font-bold truncate">
                              {qty}x {it.nome}
                            </span>
                            {unret > 0 ? (
                              <span className="text-[9px] font-black text-rose-600 dark:text-rose-400 shrink-0">
                                {deliv > 0 ? `${deliv} ent. / ` : ''}{unret} não ret.
                              </span>
                            ) : (
                              <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
                                OK
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={Boolean(updatingIds[sale.id])}
                    onClick={() => handleReopenOrder(sale)}
                    className="w-full py-2 rounded-xl bg-purple-50 dark:bg-[#20143a] hover:bg-purple-100 text-purple-800 dark:text-purple-200 text-[10px] font-black uppercase transition-all"
                  >
                    <i className="fa-solid fa-rotate-left mr-1"></i> Reabrir no KDS
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showAll && allOtherSales.length > 0 && (
        <div className="space-y-4 pt-4">
          <h3 className="text-sm font-black text-gray-400 uppercase ml-2 inline-block">Histórico / Outros Pedidos</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 opacity-80">
            {allOtherSales.slice(0, 12).map((sale) => (
              <div
                key={sale.id}
                className="bg-gray-50 dark:bg-[#160e2b] p-4 rounded-3xl border border-gray-100 dark:border-purple-900/40"
              >
                <div className="flex justify-between items-start mb-2">
                  <h4 className="font-black text-gray-600 dark:text-purple-200 uppercase text-xs">
                    {sale.cliente_nome || 'Balcão'}
                  </h4>
                  <span className="text-[8px] font-black bg-gray-200 dark:bg-purple-950 text-gray-500 dark:text-purple-300 px-2 py-1 rounded uppercase">
                    {sale.tipo_pedido}
                  </span>
                </div>
                <p className="text-[9px] font-bold text-gray-400 mb-2">{formatSafeDateTime(sale.created_at)}</p>
                <p className="text-[10px] font-black text-gray-500 dark:text-gray-300">
                  R$ {(Number(sale.valor_total) || 0).toFixed(2)} - {sale.status}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: FINALIZAR PEDIDO KDS COM PRODUTO NÃO RETIRADO           */}
      {/* ============================================================== */}
      {unclaimedModalSale && (
        <div
          className="fixed inset-0 bg-black/80 z-[130] flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm overflow-y-auto animate-in fade-in"
          onClick={() => !isSubmittingUnclaimed && setUnclaimedModalSale(null)}
        >
          <div
            className="bg-white dark:bg-[#160e2b] rounded-[36px] p-5 sm:p-7 w-full max-w-lg shadow-2xl my-auto border border-purple-100 dark:border-purple-900/40 max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-gray-100 dark:border-purple-900/30">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-300 flex items-center justify-center text-lg shrink-0">
                  <i className="fa-solid fa-box-open"></i>
                </div>
                <div>
                  <h3 className="text-lg font-black text-purple-950 dark:text-white uppercase leading-tight">
                    Finalizar c/ Não Retirado
                  </h3>
                  <p className="text-[11px] font-bold text-gray-500 dark:text-purple-300 uppercase mt-0.5">
                    {unclaimedModalSale.cliente_nome || 'Cliente'} • {unclaimedModalSale.forma_pagamento}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSubmittingUnclaimed}
                onClick={() => setUnclaimedModalSale(null)}
                className="w-9 h-9 rounded-full bg-gray-100 dark:bg-purple-950 text-gray-500 hover:text-gray-800 dark:text-purple-300 flex items-center justify-center"
              >
                <i className="fa-solid fa-xmark text-sm"></i>
              </button>
            </div>

            <div className="overflow-y-auto py-4 space-y-4 flex-1 pr-1">
              <p className="text-xs font-semibold text-gray-600 dark:text-purple-200 leading-relaxed">
                Confira abaixo o que foi <strong>entregue</strong> e o que ficará marcado como <strong>não retirado</strong> antes de encerrar este pedido no KDS:
              </p>

              {/* Ajuste por item (Entregue vs Não Retirado) */}
              <div className="space-y-2">
                {(unclaimedModalSale.itens || []).map((item, idx) => {
                  const qty = Math.max(1, Number(item.quantidade) || 1);
                  const delivered = Math.min(qty, Math.max(0, Number(draftDeliveredMap[idx] ?? 0)));
                  const unclaimed = Math.max(0, qty - delivered);

                  return (
                    <div
                      key={idx}
                      className={`p-3 rounded-2xl border flex items-center justify-between gap-3 ${
                        unclaimed > 0
                          ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/50'
                          : 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/50'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-black text-xs text-purple-950 dark:text-white uppercase truncate">
                          {qty}x {item.nome}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px] font-bold">
                          <span className="text-emerald-700 dark:text-emerald-400">
                            Entregue: {delivered}
                          </span>
                          <span className="text-gray-300">•</span>
                          <span className={unclaimed > 0 ? 'text-rose-600 dark:text-rose-400 font-black' : 'text-gray-400'}>
                            Não retirado: {unclaimed}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={delivered === 0}
                          onClick={() =>
                            setDraftDeliveredMap((prev) => ({ ...prev, [idx]: Math.max(0, delivered - 1) }))
                          }
                          className="w-8 h-8 rounded-xl bg-white dark:bg-[#160e2b] border border-gray-200 dark:border-purple-800 font-black text-sm text-purple-950 dark:text-white disabled:opacity-35"
                          title="Diminuir entregues"
                        >
                          -
                        </button>
                        <span className="w-6 text-center text-xs font-black text-purple-950 dark:text-white">
                          {delivered}
                        </span>
                        <button
                          type="button"
                          disabled={delivered >= qty}
                          onClick={() =>
                            setDraftDeliveredMap((prev) => ({ ...prev, [idx]: Math.min(qty, delivered + 1) }))
                          }
                          className="w-8 h-8 rounded-xl bg-purple-900 text-white font-black text-sm disabled:opacity-35"
                          title="Aumentar entregues"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Resumo Financeiro */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-emerald-50 dark:bg-emerald-950/50 p-3 rounded-2xl border border-emerald-200 dark:border-emerald-900/40">
                  <span className="text-[9px] font-black uppercase text-emerald-700 dark:text-emerald-300 block">
                    Retirados — Valor Cobrado ({unclaimedSummaryStats.deliveredUnits} un.)
                  </span>
                  <span className="text-base font-black text-emerald-700 dark:text-emerald-300">
                    R$ {unclaimedSummaryStats.deliveredValue.toFixed(2)}
                  </span>
                </div>
                <div className="bg-rose-50 dark:bg-rose-950/50 p-3 rounded-2xl border border-rose-200 dark:border-rose-900/40">
                  <span className="text-[9px] font-black uppercase text-rose-700 dark:text-rose-300 block">
                    Não Retirados — Abatido ({unclaimedSummaryStats.unclaimedUnits} un.)
                  </span>
                  <span className="text-base font-black text-rose-600 dark:text-rose-300">
                    - R$ {unclaimedSummaryStats.unclaimedValue.toFixed(2)}
                  </span>
                </div>
              </div>

              {unclaimedModalSale.status === 'pendente' && deductValueOnUnclaimed && (
                <div className="bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 rounded-2xl p-3 text-[11px] font-bold text-purple-900 dark:text-purple-200 flex items-start gap-2.5">
                  <i className="fa-solid fa-receipt text-purple-600 dark:text-purple-300 mt-0.5"></i>
                  <div>
                    {unclaimedSummaryStats.deliveredValue > 0 ? (
                      <>
                        <span>
                          Será lançado no <strong>Fiado</strong> cobrando somente{' '}
                          <strong>R$ {unclaimedSummaryStats.deliveredValue.toFixed(2)}</strong> (em vez de R${' '}
                          {unclaimedSummaryStats.totalOriginal.toFixed(2)}), com indicação de reserva não retirada por completo.
                        </span>
                      </>
                    ) : (
                      <span>
                        Como nenhum item foi retirado, o pedido será encerrado como <strong>Cancelado (R$ 0,00)</strong> sem gerar cobrança no fiado.
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Opções de Estoque e Valor */}
              <div className="bg-gray-50 dark:bg-[#20143a] p-4 rounded-2xl border border-gray-100 dark:border-purple-900/30 space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restoreStockOnUnclaimed}
                    onChange={(e) => setRestoreStockOnUnclaimed(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-purple-900 rounded"
                  />
                  <div>
                    <span className="text-xs font-black text-purple-950 dark:text-white block">
                      Devolver produtos não retirados ao estoque
                    </span>
                    <span className="text-[10px] font-bold text-gray-500 dark:text-purple-300">
                      Soma novamente {unclaimedSummaryStats.unclaimedUnits} un. ao estoque disponível da cantina.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer pt-2 border-t border-gray-200/70 dark:border-purple-900/40">
                  <input
                    type="checkbox"
                    checked={deductValueOnUnclaimed}
                    onChange={(e) => setDeductValueOnUnclaimed(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-purple-900 rounded"
                  />
                  <div>
                    <span className="text-xs font-black text-purple-950 dark:text-white block">
                      Descontar não retirados do valor do pedido/fiado
                    </span>
                    <span className="text-[10px] font-bold text-gray-500 dark:text-purple-300">
                      {unclaimedModalSale.status === 'pago'
                        ? `Pedido já pago (${unclaimedModalSale.forma_pagamento.toUpperCase()}). Marque apenas se houve devolução do valor.`
                        : unclaimedSummaryStats.deliveredValue <= 0
                        ? 'Nenhum item foi retirado: o pedido será cancelado (R$ 0,00) e não ficará como dívida no fiado.'
                        : `Atualiza o valor cobrado no fiado de R$ ${unclaimedSummaryStats.totalOriginal.toFixed(2)} para R$ ${unclaimedSummaryStats.deliveredValue.toFixed(2)}.`}
                    </span>
                  </div>
                </label>
              </div>

              {/* Motivo Opcional */}
              <div>
                <label className="text-[10px] font-black uppercase text-purple-900 dark:text-purple-300 tracking-wider block mb-1.5">
                  Motivo (opcional)
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {QUICK_UNCLAIMED_REASONS.map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => setUnclaimedReason(reason)}
                      className={`px-2.5 py-1 rounded-xl text-[10px] font-black uppercase transition-all ${
                        unclaimedReason === reason
                          ? 'bg-purple-900 text-white'
                          : 'bg-gray-100 dark:bg-[#20143a] text-gray-600 dark:text-purple-300'
                      }`}
                    >
                      {reason}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={unclaimedReason}
                  onChange={(e) => setUnclaimedReason(e.target.value)}
                  placeholder="Ex: Cliente foi embora antes de retirar..."
                  className="w-full bg-gray-50 dark:bg-[#20143a] border border-gray-200 dark:border-purple-900 rounded-xl px-3.5 py-2.5 text-xs font-bold text-purple-950 dark:text-white outline-none focus:border-purple-600"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-gray-100 dark:border-purple-900/30 flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                disabled={isSubmittingUnclaimed}
                onClick={() => setUnclaimedModalSale(null)}
                className="sm:w-32 py-3.5 rounded-2xl bg-gray-100 dark:bg-purple-950 text-gray-700 dark:text-purple-200 font-black text-xs uppercase"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={isSubmittingUnclaimed}
                onClick={handleConfirmUnclaimedFinalize}
                className="flex-1 py-3.5 px-5 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs uppercase shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50"
              >
                <i className="fa-solid fa-check-double"></i>
                {isSubmittingUnclaimed
                  ? 'Finalizando...'
                  : unclaimedSummaryStats.unclaimedUnits === 0
                  ? 'Concluir Entrega Total'
                  : 'Finalizar KDS c/ Não Retirado'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KdsView;
