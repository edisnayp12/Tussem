
import React, { useState } from 'react';
import { Sale, Product, PaymentMethod } from '../types';

interface DashboardViewProps {
  sales: Sale[];
  products: Product[];
  setActiveTab: (tab: string) => void;
}

const DashboardView: React.FC<DashboardViewProps> = ({ sales, products, setActiveTab }) => {
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  
  const today = new Date().toLocaleDateString('en-CA');
  
  const todaySales = sales.filter(s => {
    const sDate = new Date(s.created_at).toLocaleDateString('en-CA');
    return sDate === today;
  });

  const totalToday = todaySales
    .filter(s => s.status === 'pago')
    .reduce((acc, s) => acc + (Number(s.valor_total) || 0), 0);
  
  const pendingFiadoValue = sales
    .filter(s => s.status === 'pendente')
    .reduce((acc, s) => acc + (Number(s.valor_total) || 0), 0);

  const lowStockItems = products.filter(p => (p.estoque || 0) <= 5);

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Widget: Faturamento Recebido */}
        <div className="bg-gradient-to-br from-green-600 to-emerald-800 p-6 rounded-[32px] text-white shadow-lg relative overflow-hidden group">
          <i className="fa-solid fa-money-bill-trend-up absolute -right-4 -bottom-4 text-7xl opacity-10"></i>
          <span className="text-[10px] font-black uppercase tracking-widest opacity-80">Caixa Recebido Hoje</span>
          <h3 className="text-3xl font-black mt-1">R$ {totalToday.toFixed(2)}</h3>
          <p className="text-[10px] font-bold mt-4 bg-white/20 inline-block px-2 py-1 rounded-lg uppercase">{todaySales.filter(s => s.status === 'pago').length} Vendas Pagas</p>
        </div>

        {/* Widget: Fiados em Aberto */}
        <div className="bg-gradient-to-br from-red-600 to-rose-700 p-6 rounded-[32px] text-white shadow-lg relative overflow-hidden group cursor-pointer active:scale-95 transition-all" onClick={() => setActiveTab('fiado')}>
          <i className="fa-solid fa-user-clock absolute -right-4 -bottom-4 text-7xl opacity-10"></i>
          <span className="text-[10px] font-black uppercase tracking-widest opacity-80">Fiados Pendentes</span>
          <h3 className="text-3xl font-black mt-1">R$ {pendingFiadoValue.toFixed(2)}</h3>
          <p className="text-[10px] font-bold mt-4 bg-white/20 inline-block px-2 py-1 rounded-lg uppercase">Clique para ver todos</p>
        </div>

        {/* Widget: Estoque Baixo */}
        <div className="bg-gradient-to-br from-amber-500 to-orange-600 p-6 rounded-[32px] text-white shadow-lg relative overflow-hidden group cursor-pointer active:scale-95 transition-all" onClick={() => setActiveTab('estoque')}>
          <i className="fa-solid fa-triangle-exclamation absolute -right-4 -bottom-4 text-7xl opacity-10"></i>
          <span className="text-[10px] font-black uppercase tracking-widest opacity-80">Alerta Estoque</span>
          <h3 className="text-3xl font-black mt-1">{lowStockItems.length} Itens</h3>
          <p className="text-[10px] font-bold mt-4 bg-white/20 inline-block px-2 py-1 rounded-lg uppercase">Reposição Necessária</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100">
          <h4 className="text-sm font-black text-purple-950 uppercase mb-6 flex items-center gap-2">
            <i className="fa-solid fa-clock-rotate-left"></i> Atividade Recente
          </h4>
          <div className="space-y-3">
            {sales.slice(0, 5).map(sale => (
              <div 
                key={sale.id} 
                className="flex justify-between items-center p-3 hover:bg-gray-50 rounded-2xl transition-all border border-transparent hover:border-gray-100 cursor-pointer active:scale-95"
                onClick={() => setSelectedSale(sale)}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${sale.status === 'pago' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                    <i className={`fa-solid ${sale.status === 'pago' ? 'fa-check' : 'fa-hourglass-start'} text-sm`}></i>
                  </div>
                  <div>
                    <p className="text-[11px] font-black text-gray-800 uppercase">{sale.cliente_nome || 'Balcão'}</p>
                    <p className="text-[9px] text-gray-400 font-bold">{new Date(sale.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-black text-gray-900">R$ {(sale.valor_total || 0).toFixed(2)}</p>
                  <p className="text-[8px] font-black text-purple-400 uppercase tracking-widest">{sale.forma_pagamento}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100">
          <h4 className="text-sm font-black text-purple-950 uppercase mb-6 flex items-center gap-2">
            <i className="fa-solid fa-wallet"></i> Total Recebido (Por Forma)
          </h4>
          <div className="space-y-4 h-48 overflow-y-auto pr-1 scrollbar-hide">
             {Object.values(PaymentMethod).filter(m => m !== PaymentMethod.FIADO).map(metodo => {
               const sum = sales
                 .filter(s => s.status === 'pago' && s.forma_pagamento === metodo)
                 .reduce((acc, s) => acc + (Number(s.valor_total) || 0), 0);
               if (sum === 0) return null;
               
               let icon = 'money-bill';
               if (metodo === 'pix') icon = 'qrcode';
               if (metodo === 'debito' || metodo === 'credito') icon = 'credit-card';

               return (
                 <div key={metodo} className="flex justify-between items-center bg-gray-50 p-4 rounded-2xl">
                   <div className="flex items-center gap-3">
                     <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-900 flex items-center justify-center">
                       <i className={`fa-solid fa-${icon} text-sm`}></i>
                     </div>
                     <span className="text-xs font-black text-gray-800 uppercase">{metodo}</span>
                   </div>
                   <span className="text-lg font-black text-purple-950">R$ {sum.toFixed(2)}</span>
                 </div>
               );
             })}
          </div>
        </div>
      </div>

      {selectedSale && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm overflow-y-auto" onClick={() => setSelectedSale(null)}>
          <div className="bg-white rounded-[40px] p-8 w-full max-w-sm shadow-2xl my-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-2xl font-black text-purple-950 uppercase text-center mb-2">Detalhes da Venda</h3>
            <p className="text-center text-xs font-bold text-gray-500 mb-6 uppercase tracking-wider">{selectedSale.cliente_nome || 'Balcão'}</p>
            
            <div className="bg-gray-50 rounded-3xl p-4 mb-6 max-h-60 overflow-y-auto border border-gray-100">
              <p className="text-[10px] font-black uppercase text-gray-400 mb-2 border-b border-gray-200 pb-2 flex justify-between">
                <span>{new Date(selectedSale.created_at).toLocaleDateString()}</span>
                <span>{new Date(selectedSale.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
              </p>
              <div className="space-y-2">
                {selectedSale.itens?.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center text-xs">
                    <span className="font-bold text-gray-700 uppercase">{item.quantidade}x {item.nome}</span>
                    <span className="font-black text-gray-900">R$ {((item.preco_unitario || 0) * item.quantidade).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-purple-50 p-4 rounded-3xl flex justify-between items-center mb-6">
              <div>
                <p className="text-[9px] font-black text-purple-400 uppercase">Status</p>
                <p className={`text-sm font-black uppercase ${selectedSale.status === 'pago' ? 'text-green-600' : 'text-red-500'}`}>{selectedSale.status}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-black text-purple-400 uppercase">Forma</p>
                <p className="text-sm font-black text-purple-900 uppercase">{selectedSale.forma_pagamento}</p>
              </div>
            </div>

            <div className="flex justify-between items-end border-t border-gray-100 pt-4 mb-6">
              <span className="text-[10px] font-black text-gray-400 uppercase">Total Geral</span>
              <span className="text-3xl font-black text-purple-950">R$ {(Number(selectedSale.valor_total) || 0).toFixed(2)}</span>
            </div>

            <button 
              onClick={() => setSelectedSale(null)}
              className="w-full bg-gray-200 text-gray-800 py-4 rounded-2xl font-black text-xs uppercase"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardView;

