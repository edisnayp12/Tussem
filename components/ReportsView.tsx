
import { Sale, PaymentMethod, User, Product } from '../types';
import React, { useState, useMemo } from 'react';

interface ReportsViewProps {
  sales: Sale[];
  users: User[];
  products?: Product[];
}

const ReportsView: React.FC<ReportsViewProps> = ({ sales, users, products = [] }) => {
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [viewMode, setViewMode] = useState<'daily' | 'monthly'>('daily');
  const [filterDate, setFilterDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [filterUser, setFilterUser] = useState<string>('todos');
  const [filterPayment, setFilterPayment] = useState<string>('todos');

  const productCostMap = useMemo(() => {
    const map: Record<string, number> = {};
    products.forEach(p => {
      if (p.preco_custo !== undefined && p.preco_custo > 0) {
        map[p.id] = p.preco_custo;
        map[p.nome.trim().toLowerCase()] = p.preco_custo;
      }
    });
    return map;
  }, [products]);

  const filteredSales = useMemo(() => {
    return sales.filter(s => {
      const saleDateObj = new Date(s.created_at);
      const matchesUser = filterUser === 'todos' || s.usuario_id === filterUser;
      const matchesPayment = filterPayment === 'todos' || s.forma_pagamento === filterPayment;
      
      if (!matchesUser || !matchesPayment) return false;

      if (viewMode === 'daily') {
        return saleDateObj.toLocaleDateString('en-CA') === filterDate;
      }
      return saleDateObj.toISOString().slice(0, 7) === filterMonth;
    });
  }, [sales, filterDate, filterMonth, viewMode, filterUser, filterPayment]);

  const stats = useMemo(() => {
    return filteredSales.reduce((acc, s) => {
      const val = Number(s.valor_total) || 0;
      acc.total += val;
      if (s.status === 'pago') {
        acc.recebido += val;
      } else {
        acc.pendente += val;
      }

      // Cálculo de Custo das Mercadorias Vendidas (CMV)
      if (s.itens && s.itens.length > 0) {
        s.itens.forEach(it => {
          const unitCost = it.preco_custo || productCostMap[it.produto_id] || productCostMap[it.nome?.trim().toLowerCase()] || 0;
          const qty = it.quantidade || 1;
          acc.custoTotal += unitCost * qty;
        });
      }

      return acc;
    }, { total: 0, recebido: 0, pendente: 0, custoTotal: 0 });
  }, [filteredSales, productCostMap]);

  const lucroBruto = Math.max(0, stats.recebido - stats.custoTotal);
  const margemLucro = stats.recebido > 0 ? (lucroBruto / stats.recebido) * 100 : 0;

  const downloadCSV = () => {
    const headers = ['Data', 'Hora', 'Cliente', 'Tipo de Venda', 'Produto', 'Quantidade', 'Preço Unitário (R$)', 'Subtotal (R$)', 'Total da Venda (R$)', 'Forma de Pagamento', 'Status'];
    
    const rows: string[][] = [];
    
    filteredSales.forEach(s => {
      const saleDate = new Date(s.created_at);
      const isFiado = s.forma_pagamento === PaymentMethod.FIADO;
      const tipoVenda = isFiado ? 'Fiado' : 'Venda Normal';
      const cliente = s.cliente_nome || 'Balcão';
      const dataStr = saleDate.toLocaleDateString('pt-BR');
      const horaStr = saleDate.toLocaleTimeString('pt-BR');
      const totalStr = (s.valor_total || 0).toFixed(2).replace('.', ',');
      let formaPagamento = s.forma_pagamento.toUpperCase();
      if (s.forma_pagamento === PaymentMethod.FIADO && s.pago_com) {
        formaPagamento = `FIADO (PAGO EM: ${s.pago_com.toUpperCase()})`;
      }
      const status = s.status.toUpperCase();
      
      if (s.itens && s.itens.length > 0) {
        s.itens.forEach(item => {
          rows.push([
            dataStr,
            horaStr,
            cliente,
            tipoVenda,
            item.nome || 'Produto Desconhecido',
            String(item.quantidade),
            (item.preco_unitario || 0).toFixed(2).replace('.', ','),
            (item.subtotal || 0).toFixed(2).replace('.', ','),
            totalStr,
            formaPagamento,
            status
          ]);
        });
      } else {
         // Caso a venda não tenha itens detalhados (antigas)
         rows.push([
            dataStr,
            horaStr,
            cliente,
            tipoVenda,
            'N/A',
            '1',
            totalStr,
            totalStr,
            totalStr,
            formaPagamento,
            status
         ]);
      }
    });

    const csvContent = headers.join(';') + '\n' + rows.map(r => r.join(';')).join('\n');
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    let filename = `Relatorio_TUSEMM_${viewMode === 'daily' ? filterDate : filterMonth}.csv`;
    link.download = filename;
    link.click();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-black text-purple-950 uppercase tracking-tighter">Relatórios</h2>
          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mt-1">Sincronizado com Banco de Dados</p>
        </div>
        <button onClick={downloadCSV} className="bg-purple-900 text-white px-6 py-3 rounded-2xl font-black text-[10px] uppercase shadow-lg">Exportar CSV</button>
      </div>

      <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase text-gray-400 ml-2">Filtrar por {viewMode === 'daily' ? 'Dia' : 'Mês'}</label>
          {viewMode === 'daily' ? (
            <input type="date" className="w-full bg-gray-50 border-none rounded-2xl px-5 py-4 font-bold" value={filterDate} onChange={e => setFilterDate(e.target.value)} />
          ) : (
            <input type="month" className="w-full bg-gray-50 border-none rounded-2xl px-5 py-4 font-bold" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />
          )}
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase text-gray-400 ml-2">Forma de Pagamento</label>
          <select className="w-full bg-gray-50 border-none rounded-2xl px-5 py-4 font-bold uppercase text-xs" value={filterPayment} onChange={e => setFilterPayment(e.target.value)}>
             <option value="todos">Todos</option>
             {Object.values(PaymentMethod).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase text-gray-400 ml-2">Filtrar por Funcionário</label>
          <select className="w-full bg-gray-50 border-none rounded-2xl px-5 py-4 font-bold uppercase text-xs" value={filterUser} onChange={e => setFilterUser(e.target.value)}>
            <option value="todos">Todos</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </div>
        <div className="flex items-end gap-2 text-xs">
           <button onClick={() => setViewMode('daily')} className={`flex-1 py-4 rounded-2xl font-black text-[10px] uppercase border ${viewMode === 'daily' ? 'bg-purple-100 border-purple-200 text-purple-900' : 'bg-white text-gray-400'}`}>Diário</button>
           <button onClick={() => setViewMode('monthly')} className={`flex-1 py-4 rounded-2xl font-black text-[10px] uppercase border ${viewMode === 'monthly' ? 'bg-purple-100 border-purple-200 text-purple-900' : 'bg-white text-gray-400'}`}>Mensal</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#160e2b] p-5 rounded-[28px] shadow-sm border-l-4 border-purple-900 dark:border-purple-600 border border-gray-100 dark:border-purple-900/30">
          <span className="text-[9px] font-black text-gray-400 dark:text-purple-300/70 uppercase">Total Bruto</span>
          <p className="text-xl md:text-2xl font-black text-purple-950 dark:text-purple-100">R$ {stats.total.toFixed(2)}</p>
        </div>
        <div className="bg-white dark:bg-[#160e2b] p-5 rounded-[28px] shadow-sm border-l-4 border-green-500 border border-gray-100 dark:border-purple-900/30">
          <span className="text-[9px] font-black text-gray-400 dark:text-purple-300/70 uppercase">Recebido (Caixa)</span>
          <p className="text-xl md:text-2xl font-black text-green-600 dark:text-green-400">R$ {stats.recebido.toFixed(2)}</p>
        </div>
        <div className="bg-white dark:bg-[#160e2b] p-5 rounded-[28px] shadow-sm border-l-4 border-amber-500 border border-gray-100 dark:border-purple-900/30">
          <span className="text-[9px] font-black text-gray-400 dark:text-purple-300/70 uppercase">Lucro Estimado</span>
          <p className="text-xl md:text-2xl font-black text-amber-600 dark:text-amber-400">
            R$ {lucroBruto.toFixed(2)}
            <span className="text-[10px] font-bold ml-1 opacity-70">({margemLucro.toFixed(0)}%)</span>
          </p>
        </div>
        <div className="bg-white dark:bg-[#160e2b] p-5 rounded-[28px] shadow-sm border-l-4 border-red-500 border border-gray-100 dark:border-purple-900/30">
          <span className="text-[9px] font-black text-gray-400 dark:text-purple-300/70 uppercase">Fiados Pendentes</span>
          <p className="text-xl md:text-2xl font-black text-red-600 dark:text-red-400">R$ {stats.pendente.toFixed(2)}</p>
        </div>
      </div>

      <div className="bg-white rounded-[32px] shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase">Venda</th>
              <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase">Cliente</th>
              <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase text-right">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredSales.map(s => (
              <tr key={s.id} className="hover:bg-gray-50 cursor-pointer active:scale-95 transition-all" onClick={() => setSelectedSale(s)}>
                <td className="px-6 py-4">
                  <div className="text-[10px] font-black text-purple-900 uppercase">{s.forma_pagamento}</div>
                  <div className="text-[8px] text-gray-400 font-bold">{new Date(s.created_at).toLocaleTimeString()}</div>
                </td>
                <td className="px-6 py-4">
                   <div className="text-[10px] font-black text-gray-700 uppercase">{s.cliente_nome || 'Balcão'}</div>
                   <div className={`text-[7px] font-black uppercase ${s.status === 'pago' ? 'text-green-500' : 'text-red-500'}`}>{s.status}</div>
                </td>
                <td className="px-6 py-4 text-right font-black text-gray-900">R$ {(s.valor_total || 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
                <p className="text-sm font-black text-purple-900 uppercase">
                  {selectedSale.forma_pagamento}
                  {selectedSale.pago_com && <span className="block text-[8px] text-green-600 mt-0.5">Pago via {selectedSale.pago_com}</span>}
                </p>
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

export default ReportsView;
