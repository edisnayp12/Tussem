import React, { useState } from 'react';
import { Sale, User, UserRole, PaymentMethod } from '../types';

interface KdsViewProps {
  sales: Sale[];
  onUpdateSale: (id: string, data: any) => Promise<void>;
  currentUser?: User | null;
}

const KdsView: React.FC<KdsViewProps> = ({ sales, onUpdateSale, currentUser }) => {
  const isAdmin = currentUser?.perfil === UserRole.ADMIN || currentUser?.id === 'super-admin';
  const [showAll, setShowAll] = useState(false);

  // Filtra as vendas com base nas permissões/configurações
  const kdsSales = sales.filter(s => {
    const isReserva = s.tipo_pedido === 'reserva';
    if (!isAdmin && !showAll) return isReserva;
    if (showAll) return true;
    return isReserva;
  });

  // Separa em pendentes de entrega e já entregues (recentes)
  const pendingDeliveries = kdsSales.filter(s => s.status_entrega !== 'entregue' && s.tipo_pedido === 'reserva');
  
  // Mostrar também balcão no all
  const allOtherSales = kdsSales.filter(s => s.status_entrega === 'entregue' || s.tipo_pedido !== 'reserva');

  const handleConfirmDelivery = async (saleId: string) => {
    try {
      await onUpdateSale(saleId, { status_entrega: 'entregue' });
    } catch (e: any) {
      alert("Erro ao confirmar entrega: " + e.message);
    }
  };

  const handleCobrarPix = async (saleId: string) => {
    try {
      await onUpdateSale(saleId, { status: 'pago' });
    } catch (e: any) {
      alert("Erro ao confirmar pagamento: " + e.message);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="bg-purple-900 text-white p-8 rounded-[40px] shadow-xl flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight">KDS - Cozinha e Entregas</h2>
          <p className="opacity-60 text-[10px] font-bold uppercase mt-1">Gerenciamento de Reservas</p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-3 bg-white/10 p-3 rounded-2xl">
            <span className="text-[10px] font-black uppercase">Mostrar Todos</span>
            <button 
              onClick={() => setShowAll(!showAll)}
              className={`w-12 h-6 rounded-full transition-colors relative ${showAll ? 'bg-green-500' : 'bg-gray-500'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${showAll ? 'left-7' : 'left-1'}`}></div>
            </button>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-black text-purple-900 uppercase ml-2 border-b-2 border-purple-100 pb-2 inline-block">Reservas Pendentes ({pendingDeliveries.length})</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pendingDeliveries.map(sale => (
            <div key={sale.id} className="bg-white p-6 rounded-3xl shadow-sm border border-orange-200 relative overflow-hidden flex flex-col">
              <div className="absolute top-0 right-0 bg-orange-100 text-orange-700 px-4 py-2 rounded-bl-3xl font-black text-[10px] uppercase">
                Aguardando
              </div>
              
              <div className="mb-4 pr-16">
                <h4 className="font-black text-purple-950 uppercase text-lg">{sale.cliente_nome}</h4>
                <p className="text-[10px] font-bold text-gray-500 flex items-center gap-1 mt-1">
                  <i className="fa-brands fa-whatsapp text-green-500"></i> {sale.telefone_comprador || 'Sem telefone'}
                </p>
                <p className="text-[9px] font-bold text-gray-400 mt-1">{new Date(sale.created_at).toLocaleString()}</p>
              </div>

              <div className="bg-gray-50 p-4 rounded-2xl flex-1 mb-4 border border-gray-100">
                <ul className="space-y-2">
                  {sale.itens?.map((item, idx) => (
                    <li key={idx} className="flex justify-between text-xs border-b border-gray-200 last:border-0 pb-2 last:pb-0">
                      <span className="font-bold text-gray-700 uppercase">{item.quantidade}x {item.nome}</span>
                    </li>
                  ))}
                </ul>
              </div>
              
              <div className="flex justify-between items-center mb-4 bg-purple-50 p-3 rounded-2xl border border-purple-100">
                <div className="flex flex-col">
                  <span className="text-[8px] font-black uppercase text-purple-600">Total</span>
                  <span className="text-sm font-black text-purple-950">R$ {sale.valor_total.toFixed(2)}</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[8px] font-black uppercase text-purple-600">Pagamento</span>
                  <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-md mt-1 ${sale.status === 'pago' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {sale.forma_pagamento} - {sale.status}
                  </span>
                </div>
              </div>

              <div className="space-y-2 mt-auto">
                <button 
                  onClick={() => handleConfirmDelivery(sale.id)}
                  className="w-full bg-green-500 hover:bg-green-600 text-white py-4 rounded-2xl font-black text-[10px] uppercase transition-all shadow-lg shadow-green-500/20"
                >
                  Confirmar Entrega
                </button>

                {(isAdmin || currentUser?.perfil === UserRole.KDS) && sale.status === 'pendente' && (
                  <div className="flex gap-2">
                    {isAdmin && sale.forma_pagamento === PaymentMethod.PIX && (
                      <button 
                        onClick={() => handleCobrarPix(sale.id)}
                        className="w-full flex items-center justify-center gap-2 bg-purple-100 hover:bg-purple-200 text-purple-700 py-3 rounded-xl font-black text-[9px] uppercase transition-all"
                      >
                        <i className="fa-solid fa-check"></i> Baixa PIX
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {pendingDeliveries.length === 0 && (
            <div className="col-span-full text-center py-16 bg-white rounded-[32px] border border-gray-100 shadow-sm">
               <i className="fa-solid fa-check-double text-5xl mb-4 text-green-400"></i>
               <p className="text-sm font-black uppercase tracking-widest text-gray-500">Nenhuma reserva pendente</p>
            </div>
          )}
        </div>
      </div>

      {showAll && allOtherSales.length > 0 && (
        <div className="space-y-4 pt-8">
          <h3 className="text-sm font-black text-gray-400 uppercase ml-2 inline-block">Histórico / Outros Pedidos</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 opacity-70">
            {allOtherSales.slice(0, 12).map(sale => (
               <div key={sale.id} className="bg-gray-50 p-4 rounded-3xl border border-gray-100">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-black text-gray-600 uppercase text-xs">{sale.cliente_nome || 'Balcão'}</h4>
                    <span className="text-[8px] font-black bg-gray-200 text-gray-500 px-2 py-1 rounded uppercase">
                      {sale.tipo_pedido}
                    </span>
                  </div>
                  <p className="text-[9px] font-bold text-gray-400 mb-2">{new Date(sale.created_at).toLocaleString()}</p>
                  <p className="text-[10px] font-black text-gray-500">R$ {sale.valor_total.toFixed(2)} - {sale.status}</p>
               </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default KdsView;
