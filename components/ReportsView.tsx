import { Sale, PaymentMethod, User, Product, Customer } from '../types';
import React, { useState, useMemo } from 'react';
import { normalizePhone, formatPhone, getWhatsAppLink } from '../utils/phoneUtils';

interface ReportsViewProps {
  sales: Sale[];
  users: User[];
  products?: Product[];
  customers?: Customer[];
}

export interface DebtorClient {
  rank: number;
  key: string;
  nome: string;
  telefone: string;
  totalDivida: number;
  quantidadeCompras: number;
  tempoMedioDias: number;
  maiorAtrasoDias: number;
  menorAtrasoDias: number;
  dataMaisAntiga: string;
  dataMaisRecente: string;
  compras: Sale[];
  faixaRisco: 'recente' | 'moderado' | 'atencao' | 'critico';
}

const ReportsView: React.FC<ReportsViewProps> = ({ 
  sales, 
  users, 
  products = [], 
  customers = [] 
}) => {
  // Aba do Relatório: 'vendas' (Vendas & Faturamento) vs 'inadimplencia' (Top 10 Dívidas & Inadimplência)
  const [activeReportTab, setActiveReportTab] = useState<'vendas' | 'inadimplencia'>('inadimplencia');

  // Estados do Relatório de Vendas Tradicional
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [viewMode, setViewMode] = useState<'daily' | 'monthly'>('daily');
  const [filterDate, setFilterDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [filterUser, setFilterUser] = useState<string>('todos');
  const [filterPayment, setFilterPayment] = useState<string>('todos');

  // Estados do Relatório de Inadimplência & Top 10
  const [delinquencyFilterDays, setDelinquencyFilterDays] = useState<'todos' | '7dias' | '15dias' | '30dias'>('todos');
  const [delinquencySearch, setDelinquencySearch] = useState('');
  const [selectedDebtorDetail, setSelectedDebtorDetail] = useState<DebtorClient | null>(null);

  // Mapeamento de Custo dos Produtos (CMV)
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

  // Vendas filtradas para o relatório de vendas
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

  // ==============================================================
  // CÁLCULO DO RELATÓRIO DE INADIMPLÊNCIA & TOP 10 DEVEDORES
  // ==============================================================
  const { allDebtors, top10Debtors, globalDelinquencyStats } = useMemo(() => {
    const now = Date.now();

    // Filtra todas as vendas que representam dívidas ativas não pagas
    const pendingSales = sales.filter(s => 
      s.status === 'pendente' && 
      (
        s.forma_pagamento === PaymentMethod.FIADO ||
        (s.tipo_pedido === 'reserva' && s.status_entrega === 'entregue') ||
        (s.tipo_pedido !== 'reserva' && s.forma_pagamento === PaymentMethod.FIADO)
      )
    );

    // Mapa de clientes cadastrados para enriquecer contatos
    const customerPhoneMap = new Map<string, string>();
    customers.forEach(c => {
      if (c.nome && c.telefone) {
        customerPhoneMap.set(c.nome.toLowerCase().trim(), c.telefone);
      }
      if (c.telefone_limpo) {
        customerPhoneMap.set(c.telefone_limpo, c.telefone);
      }
    });

    const debtorMap = new Map<string, {
      key: string;
      nome: string;
      telefone: string;
      totalDivida: number;
      compras: Sale[];
      idadesDias: number[];
      datas: string[];
    }>();

    pendingSales.forEach(s => {
      const val = Number(s.valor_total) || 0;
      const saleTime = new Date(s.created_at).getTime();
      const diffMs = now - saleTime;
      const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

      const rawTel = (s.telefone_comprador || '').trim();
      const cleanTel = normalizePhone(rawTel);
      const rawNome = (s.cliente_nome || '').trim();
      const nome = rawNome && rawNome.length > 0 ? rawNome : 'Sem Nome';

      // Chave de agrupamento: prioriza telefone normalizado ou nome
      const groupKey = cleanTel.length >= 8 
        ? `tel_${cleanTel}` 
        : (nome !== 'Sem Nome' ? `nome_${nome.toLowerCase()}` : `venda_${s.id}`);

      let record = debtorMap.get(groupKey);
      if (!record) {
        // Tenta buscar telefone no mapa de clientes caso a venda não possua
        let telFinal = cleanTel ? formatPhone(cleanTel) : rawTel;
        if (!telFinal && customerPhoneMap.has(nome.toLowerCase())) {
          telFinal = formatPhone(customerPhoneMap.get(nome.toLowerCase()) || '');
        }

        record = {
          key: groupKey,
          nome,
          telefone: telFinal,
          totalDivida: 0,
          compras: [],
          idadesDias: [],
          datas: []
        };
        debtorMap.set(groupKey, record);
      } else {
        if (nome !== 'Sem Nome' && (record.nome === 'Sem Nome' || nome.length > record.nome.length)) {
          record.nome = nome;
        }
        if (!record.telefone && (cleanTel || rawTel)) {
          record.telefone = cleanTel ? formatPhone(cleanTel) : rawTel;
        }
      }

      record.totalDivida += val;
      record.compras.push(s);
      record.idadesDias.push(days);
      record.datas.push(s.created_at);
    });

    // Transforma em array de devedores ordenados por volume de dívida
    const debtorsList: DebtorClient[] = Array.from(debtorMap.values()).map(d => {
      const sumDays = d.idadesDias.reduce((acc, curr) => acc + curr, 0);
      const avgDays = d.idadesDias.length > 0 ? Math.round((sumDays / d.idadesDias.length) * 10) / 10 : 0;
      const maxDays = Math.max(...d.idadesDias);
      const minDays = Math.min(...d.idadesDias);

      // Ordena compras da mais recente para a mais antiga
      d.compras.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      let faixa: 'recente' | 'moderado' | 'atencao' | 'critico' = 'recente';
      if (avgDays > 30) faixa = 'critico';
      else if (avgDays > 15) faixa = 'atencao';
      else if (avgDays >= 7) faixa = 'moderado';

      return {
        rank: 0, // preenchido após ordenação
        key: d.key,
        nome: d.nome,
        telefone: d.telefone,
        totalDivida: d.totalDivida,
        quantidadeCompras: d.compras.length,
        tempoMedioDias: avgDays,
        maiorAtrasoDias: maxDays,
        menorAtrasoDias: minDays,
        dataMaisAntiga: d.datas.sort()[0] || '',
        dataMaisRecente: d.datas.sort()[d.datas.length - 1] || '',
        compras: d.compras,
        faixaRisco: faixa
      };
    });

    // Ordenação decrescente pelo volume total de dívida
    debtorsList.sort((a, b) => b.totalDivida - a.totalDivida);
    debtorsList.forEach((d, idx) => {
      d.rank = idx + 1;
    });

    // Top 10 absoluto
    const top10 = debtorsList.slice(0, 10);

    // Métricas Globais da Cantina
    const totalDividaGeral = debtorsList.reduce((acc, d) => acc + d.totalDivida, 0);
    const totalComprasPendentes = debtorsList.reduce((acc, d) => acc + d.quantidadeCompras, 0);
    const sumAllDays = debtorsList.reduce((acc, d) => acc + (d.tempoMedioDias * d.quantidadeCompras), 0);
    const tempoMedioGlobal = totalComprasPendentes > 0 ? Math.round((sumAllDays / totalComprasPendentes) * 10) / 10 : 0;
    const maxAtrasoGlobal = debtorsList.length > 0 ? Math.max(...debtorsList.map(d => d.maiorAtrasoDias)) : 0;
    const top10VolumeTotal = top10.reduce((acc, d) => acc + d.totalDivida, 0);
    const representatividadeTop10 = totalDividaGeral > 0 ? (top10VolumeTotal / totalDividaGeral) * 100 : 0;

    return {
      allDebtors: debtorsList,
      top10Debtors: top10,
      globalDelinquencyStats: {
        totalDividaGeral,
        totalDevedores: debtorsList.length,
        tempoMedioGlobal,
        maxAtrasoGlobal,
        top10VolumeTotal,
        representatividadeTop10
      }
    };
  }, [sales, customers]);

  // Top 10 filtrado caso o usuário aplique busca ou filtro de faixa de tempo
  const filteredTopDebtors = useMemo(() => {
    let list = allDebtors;

    const term = delinquencySearch.trim().toLowerCase();
    const cleanDigits = term.replace(/\D/g, '');
    if (term) {
      list = list.filter(d => {
        const nameMatch = d.nome.toLowerCase().includes(term);
        const phoneMatch = d.telefone.includes(term) || (cleanDigits && d.telefone.replace(/\D/g, '').includes(cleanDigits));
        return nameMatch || phoneMatch;
      });
    }

    if (delinquencyFilterDays !== 'todos') {
      const minDays = delinquencyFilterDays === '7dias' ? 7 : (delinquencyFilterDays === '15dias' ? 15 : 30);
      list = list.filter(d => d.tempoMedioDias >= minDays || d.maiorAtrasoDias >= minDays);
    }

    // Se estiver sem filtros ativos, retorna exatamente o Top 10
    if (!term && delinquencyFilterDays === 'todos') {
      return top10Debtors;
    }

    return list.slice(0, 10);
  }, [allDebtors, top10Debtors, delinquencySearch, delinquencyFilterDays]);

  const maxDebtValue = top10Debtors.length > 0 ? top10Debtors[0].totalDivida : 1;

  // Exportar CSV de Inadimplência & Top 10
  const downloadInadimplenciaCSV = () => {
    const headers = [
      'Posição (Ranking)',
      'Cliente',
      'Telefone / WhatsApp',
      'Volume Total Dívida (R$)',
      'Tempo Médio de Inadimplência (Dias)',
      'Maior Tempo de Atraso (Dias)',
      'Quantidade de Compras Pendentes',
      'Data da Compra Mais Antiga',
      'Classificação de Risco'
    ];

    const rows = allDebtors.map(d => [
      `${d.rank}º`,
      d.nome,
      d.telefone || 'Sem Telefone',
      d.totalDivida.toFixed(2).replace('.', ','),
      `${d.tempoMedioDias} dias`,
      `${d.maiorAtrasoDias} dias`,
      String(d.quantidadeCompras),
      d.dataMaisAntiga ? new Date(d.dataMaisAntiga).toLocaleDateString('pt-BR') : 'N/A',
      d.faixaRisco.toUpperCase()
    ]);

    const csvContent = headers.join(';') + '\n' + rows.map(r => r.join(';')).join('\n');
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Relatorio_Top_Inadimplencia_TUSEMM_${new Date().toLocaleDateString('en-CA')}.csv`;
    link.click();
  };

  // Exportar CSV de Vendas Tradicional
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
    link.download = `Relatorio_Vendas_TUSEMM_${viewMode === 'daily' ? filterDate : filterMonth}.csv`;
    link.click();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      
      {/* ============================================================== */}
      {/* HEADER BANNER COM SELETOR DE RELATÓRIO                         */}
      {/* ============================================================== */}
      <div className="bg-gradient-to-r from-purple-950 via-purple-900 to-indigo-950 text-white p-7 sm:p-8 rounded-[40px] shadow-2xl relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-10 -translate-y-10 w-72 h-72 bg-purple-600/20 rounded-full blur-3xl pointer-events-none"></div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-amber-300 font-black text-xl shadow-lg">
                <i className={activeReportTab === 'inadimplencia' ? 'fa-solid fa-chart-pie' : 'fa-solid fa-chart-line'}></i>
              </div>
              <div>
                <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-tight">
                  {activeReportTab === 'inadimplencia' ? 'Inadimplência & Top 10 Devedores' : 'Relatório de Vendas & Caixa'}
                </h2>
                <p className="opacity-75 text-xs font-bold mt-1">
                  {activeReportTab === 'inadimplencia'
                    ? 'Análise analítica de risco, concentração de dívidas e tempo médio de atraso dos clientes.'
                    : 'Acompanhamento financeiro diário e mensal, faturamento, margem e CMV da Cantina.'}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeReportTab === 'inadimplencia' ? (
              <button
                onClick={downloadInadimplenciaCSV}
                className="bg-purple-600 hover:bg-purple-500 text-white px-5 py-3.5 rounded-2xl font-black text-xs uppercase tracking-wider shadow-lg flex items-center gap-2 transition-all active:scale-95"
              >
                <i className="fa-solid fa-file-csv text-sm"></i>
                Exportar Inadimplência
              </button>
            ) : (
              <button
                onClick={downloadCSV}
                className="bg-purple-600 hover:bg-purple-500 text-white px-5 py-3.5 rounded-2xl font-black text-xs uppercase tracking-wider shadow-lg flex items-center gap-2 transition-all active:scale-95"
              >
                <i className="fa-solid fa-file-csv text-sm"></i>
                Exportar Vendas
              </button>
            )}
          </div>
        </div>

        {/* NAVEGAÇÃO ENTRE RELATÓRIOS */}
        <div className="flex gap-2 mt-6 pt-6 border-t border-white/10">
          <button
            onClick={() => setActiveReportTab('inadimplencia')}
            className={`px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-all ${
              activeReportTab === 'inadimplencia'
                ? 'bg-amber-400 text-purple-950 shadow-lg scale-100'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
          >
            <i className="fa-solid fa-triangle-exclamation"></i>
            Top 10 Dívidas & Tempo Médio
          </button>
          <button
            onClick={() => setActiveReportTab('vendas')}
            className={`px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-all ${
              activeReportTab === 'vendas'
                ? 'bg-purple-600 text-white shadow-lg'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
          >
            <i className="fa-solid fa-receipt"></i>
            Vendas & Faturamento
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* RELATÓRIO 1: INADIMPLÊNCIA & TOP 10 MAIORES DÍVIDAS             */}
      {/* ============================================================== */}
      {activeReportTab === 'inadimplencia' && (
        <div className="space-y-6">
          
          {/* STATS DE INADIMPLÊNCIA GLOBAL */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-[#160e2b] p-5 rounded-[28px] shadow-sm border-l-4 border-red-500 border border-gray-100 dark:border-purple-900/30">
              <span className="text-[10px] font-black text-gray-400 dark:text-purple-300 uppercase tracking-wider">
                Volume Total de Dívidas
              </span>
              <p className="text-xl md:text-2xl font-black text-red-600 dark:text-red-400 mt-1">
                R$ {globalDelinquencyStats.totalDividaGeral.toFixed(2)}
              </p>
              <span className="text-[10px] font-bold text-gray-400 mt-0.5 block">
                {globalDelinquencyStats.totalDevedores} clientes em débito
              </span>
            </div>

            <div className="bg-white dark:bg-[#160e2b] p-5 rounded-[28px] shadow-sm border-l-4 border-amber-500 border border-gray-100 dark:border-purple-900/30">
              <span className="text-[10px] font-black text-gray-400 dark:text-purple-300 uppercase tracking-wider">
                Tempo Médio de Inadimplência
              </span>
              <p className="text-xl md:text-2xl font-black text-amber-600 dark:text-amber-400 mt-1 flex items-baseline gap-1">
                <span>{globalDelinquencyStats.tempoMedioGlobal}</span>
                <span className="text-xs font-bold text-gray-400">dias</span>
              </p>
              <span className="text-[10px] font-bold text-gray-400 mt-0.5 block">
                Média geral de atraso
              </span>
            </div>

            <div className="bg-white dark:bg-[#160e2b] p-5 rounded-[28px] shadow-sm border-l-4 border-rose-600 border border-gray-100 dark:border-purple-900/30">
              <span className="text-[10px] font-black text-gray-400 dark:text-purple-300 uppercase tracking-wider">
                Maior Atraso Registrado
              </span>
              <p className="text-xl md:text-2xl font-black text-purple-950 dark:text-white mt-1 flex items-baseline gap-1">
                <span>{globalDelinquencyStats.maxAtrasoGlobal}</span>
                <span className="text-xs font-bold text-gray-400">dias</span>
              </p>
              <span className="text-[10px] font-bold text-gray-400 mt-0.5 block">
                Dívida mais antiga ativa
              </span>
            </div>

            <div className="bg-white dark:bg-[#160e2b] p-5 rounded-[28px] shadow-sm border-l-4 border-purple-900 border border-gray-100 dark:border-purple-900/30">
              <span className="text-[10px] font-black text-gray-400 dark:text-purple-300 uppercase tracking-wider">
                Concentração no Top 10
              </span>
              <p className="text-xl md:text-2xl font-black text-purple-900 dark:text-purple-300 mt-1">
                {globalDelinquencyStats.representatividadeTop10.toFixed(1)}%
              </p>
              <span className="text-[10px] font-bold text-gray-400 mt-0.5 block">
                R$ {globalDelinquencyStats.top10VolumeTotal.toFixed(2)} nos 10 maiores
              </span>
            </div>
          </div>

          {/* BARRA DE FILTROS DO RELATÓRIO DE INADIMPLÊNCIA */}
          <div className="bg-white dark:bg-[#160e2b] p-4 sm:p-5 rounded-3xl shadow-sm border border-gray-100 dark:border-purple-900/40 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative flex-1">
              <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
              <input
                type="text"
                placeholder="Buscar cliente devedor por nome ou telefone..."
                value={delinquencySearch}
                onChange={e => setDelinquencySearch(e.target.value)}
                className="w-full bg-gray-50 dark:bg-[#20143a] border border-transparent focus:border-purple-600 rounded-2xl pl-10 pr-4 py-3 text-xs font-bold text-gray-900 dark:text-white outline-none"
              />
            </div>

            {/* Filtro por Faixa de Tempo Médio de Atraso */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
              <span className="text-[9px] font-black uppercase text-gray-400 mr-1 hidden md:inline">Faixa:</span>
              {[
                { id: 'todos', label: 'Todos' },
                { id: '7dias', label: '>= 7 dias' },
                { id: '15dias', label: '>= 15 dias' },
                { id: '30dias', label: '⚠️ >= 30 dias (Crítico)' },
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setDelinquencyFilterDays(f.id as any)}
                  className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase whitespace-nowrap transition-all ${
                    delinquencyFilterDays === f.id
                      ? 'bg-purple-900 text-white shadow-xs'
                      : 'bg-gray-100 dark:bg-[#20143a] hover:bg-gray-200 text-gray-700 dark:text-purple-300'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* TABELA E CARDS DO TOP 10 DEVEDORES */}
          <div className="bg-white dark:bg-[#160e2b] rounded-[32px] shadow-sm border border-gray-100 dark:border-purple-900/40 overflow-hidden">
            <div className="p-6 border-b border-gray-100 dark:border-purple-900/30 flex justify-between items-center flex-wrap gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-black text-lg text-purple-950 dark:text-white uppercase tracking-tight">
                    Ranking: Top 10 Clientes com Maior Volume de Dívida
                  </h3>
                  <span className="bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full">
                    Auditoria
                  </span>
                </div>
                <p className="text-[11px] font-bold text-gray-400 mt-0.5">
                  Classificado por valor total devido, detalhando o tempo médio que cada cliente demora para quitar seus débitos.
                </p>
              </div>

              <div className="text-right">
                <span className="text-[9px] font-black uppercase tracking-wider text-gray-400 block">Exibindo</span>
                <span className="text-xs font-black text-purple-900 dark:text-purple-300">
                  {filteredTopDebtors.length} de {allDebtors.length} clientes inadimplentes
                </span>
              </div>
            </div>

            {/* TABELA PRINCIPAL */}
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50/80 dark:bg-[#20143a]/50 text-[10px] font-black text-gray-400 dark:text-purple-300 uppercase tracking-wider border-b border-gray-100 dark:border-purple-900/30">
                  <tr>
                    <th className="px-6 py-4 text-center w-16">Rank</th>
                    <th className="px-6 py-4">Cliente / Contato</th>
                    <th className="px-6 py-4 text-right">Volume da Dívida</th>
                    <th className="px-6 py-4 text-center">Tempo Médio Inadimplência</th>
                    <th className="px-6 py-4 text-center">Dívida Mais Antiga</th>
                    <th className="px-6 py-4 text-center">Compras Pendentes</th>
                    <th className="px-6 py-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-purple-900/20 text-xs">
                  {filteredTopDebtors.map(debtor => {
                    const percentOfMax = maxDebtValue > 0 ? (debtor.totalDivida / maxDebtValue) * 100 : 0;
                    const hasPhone = Boolean(debtor.telefone && debtor.telefone.replace(/\D/g, '').length >= 8);

                    // Badge do Ranking (Ouro, Prata, Bronze ou Numérico)
                    let rankBadge = (
                      <span className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-purple-950 font-black text-xs text-gray-600 dark:text-purple-300 flex items-center justify-center mx-auto">
                        #{debtor.rank}
                      </span>
                    );
                    if (debtor.rank === 1) {
                      rankBadge = (
                        <span className="w-8 h-8 rounded-xl bg-amber-400 text-purple-950 font-black text-xs shadow-md flex items-center justify-center mx-auto" title="1º Maior Devedor">
                          🥇 1º
                        </span>
                      );
                    } else if (debtor.rank === 2) {
                      rankBadge = (
                        <span className="w-8 h-8 rounded-xl bg-gray-300 text-gray-800 font-black text-xs shadow-sm flex items-center justify-center mx-auto" title="2º Maior Devedor">
                          🥈 2º
                        </span>
                      );
                    } else if (debtor.rank === 3) {
                      rankBadge = (
                        <span className="w-8 h-8 rounded-xl bg-amber-700 text-white font-black text-xs shadow-sm flex items-center justify-center mx-auto" title="3º Maior Devedor">
                          🥉 3º
                        </span>
                      );
                    }

                    // Chip de Tempo Médio de Inadimplência
                    let tempoChip = (
                      <span className="bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 px-3 py-1 rounded-xl text-[10px] font-black uppercase inline-flex items-center gap-1 border border-emerald-200 dark:border-emerald-900">
                        <i className="fa-regular fa-clock"></i> {debtor.tempoMedioDias} dias
                      </span>
                    );
                    if (debtor.tempoMedioDias > 30) {
                      tempoChip = (
                        <span className="bg-red-50 dark:bg-red-950/70 text-red-600 dark:text-red-300 px-3 py-1 rounded-xl text-[10px] font-black uppercase inline-flex items-center gap-1 border border-red-200 dark:border-red-900 animate-pulse">
                          <i className="fa-solid fa-triangle-exclamation text-red-500"></i> {debtor.tempoMedioDias} dias (Crítico)
                        </span>
                      );
                    } else if (debtor.tempoMedioDias > 15) {
                      tempoChip = (
                        <span className="bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 px-3 py-1 rounded-xl text-[10px] font-black uppercase inline-flex items-center gap-1 border border-amber-200 dark:border-amber-900">
                          <i className="fa-solid fa-clock-rotate-left"></i> {debtor.tempoMedioDias} dias (Atenção)
                        </span>
                      );
                    } else if (debtor.tempoMedioDias >= 7) {
                      tempoChip = (
                        <span className="bg-yellow-50 dark:bg-yellow-950/60 text-yellow-800 dark:text-yellow-300 px-3 py-1 rounded-xl text-[10px] font-black uppercase inline-flex items-center gap-1 border border-yellow-200 dark:border-yellow-900">
                          <i className="fa-solid fa-clock"></i> {debtor.tempoMedioDias} dias
                        </span>
                      );
                    }

                    return (
                      <tr 
                        key={debtor.key}
                        className="hover:bg-purple-50/40 dark:hover:bg-purple-950/30 transition-colors"
                      >
                        {/* Posição */}
                        <td className="px-6 py-4 text-center">
                          {rankBadge}
                        </td>

                        {/* Cliente e Telefone */}
                        <td className="px-6 py-4">
                          <div className="font-black text-purple-950 dark:text-white uppercase text-sm">
                            {debtor.nome}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {hasPhone ? (
                              <span className="text-[11px] font-bold text-green-700 dark:text-green-400 flex items-center gap-1">
                                <i className="fa-brands fa-whatsapp"></i> {formatPhone(debtor.telefone)}
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                                Sem telefone cadastrado
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Volume da Dívida com Proporção Visual */}
                        <td className="px-6 py-4 text-right">
                          <div className="font-black text-red-600 dark:text-red-400 text-base">
                            R$ {debtor.totalDivida.toFixed(2)}
                          </div>
                          {/* Barra de Proporção Visual */}
                          <div className="w-28 ml-auto bg-gray-100 dark:bg-purple-950 rounded-full h-1.5 mt-1.5 overflow-hidden">
                            <div 
                              className={`h-full rounded-full ${debtor.rank === 1 ? 'bg-red-600' : (debtor.rank <= 3 ? 'bg-amber-500' : 'bg-purple-600')}`}
                              style={{ width: `${Math.min(100, Math.max(8, percentOfMax))}%` }}
                            ></div>
                          </div>
                          <span className="text-[9px] font-bold text-gray-400 mt-0.5 block">
                            {percentOfMax.toFixed(0)}% do maior
                          </span>
                        </td>

                        {/* Tempo Médio de Inadimplência */}
                        <td className="px-6 py-4 text-center">
                          {tempoChip}
                          <span className="block text-[9px] font-bold text-gray-400 mt-1">
                            Variação: {debtor.menorAtrasoDias} a {debtor.maiorAtrasoDias} dias
                          </span>
                        </td>

                        {/* Dívida Mais Antiga */}
                        <td className="px-6 py-4 text-center">
                          <div className="font-bold text-gray-700 dark:text-gray-300 text-xs">
                            {debtor.dataMaisAntiga ? new Date(debtor.dataMaisAntiga).toLocaleDateString('pt-BR') : 'N/A'}
                          </div>
                          <span className="text-[10px] font-black text-red-500 block mt-0.5">
                            Há {debtor.maiorAtrasoDias} dias
                          </span>
                        </td>

                        {/* Quantidade de Compras */}
                        <td className="px-6 py-4 text-center">
                          <span className="bg-gray-100 dark:bg-purple-950 text-gray-800 dark:text-purple-200 px-3 py-1 rounded-xl text-xs font-black">
                            {debtor.quantidadeCompras} {debtor.quantidadeCompras === 1 ? 'compra' : 'compras'}
                          </span>
                        </td>

                        {/* Ações */}
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {hasPhone && (
                              <a
                                href={getWhatsAppLink(debtor.telefone, `Olá ${debtor.nome}! Passando para lembrar da sua conta pendente na Cantina TUSEMM no valor total de R$ ${debtor.totalDivida.toFixed(2)}. Por favor, realize o acerto quando puder. Muito obrigado! 🙏`)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Cobrar no WhatsApp"
                                className="w-8 h-8 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 flex items-center justify-center transition-all shadow-xs"
                              >
                                <i className="fa-brands fa-whatsapp text-sm"></i>
                              </a>
                            )}
                            <button
                              onClick={() => setSelectedDebtorDetail(debtor)}
                              title="Ver Detalhes das Compras em Aberto"
                              className="bg-purple-50 dark:bg-purple-950 hover:bg-purple-100 text-purple-900 dark:text-purple-200 border border-purple-200 dark:border-purple-800 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                            >
                              Ver Compras
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredTopDebtors.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-gray-400">
                        <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-3">
                          <i className="fa-solid fa-circle-check"></i>
                        </div>
                        <h4 className="text-base font-black uppercase text-gray-800 dark:text-white">
                          Nenhum cliente inadimplente encontrado
                        </h4>
                        <p className="text-xs font-bold text-gray-400 mt-1 uppercase tracking-wider">
                          Não há registros correspondentes aos filtros aplicados.
                        </p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* RELATÓRIO 2: VENDAS & FATURAMENTO TRADICIONAL                  */}
      {/* ============================================================== */}
      {activeReportTab === 'vendas' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-[#160e2b] p-6 rounded-[32px] shadow-sm border border-gray-100 dark:border-purple-900/40 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-gray-400 ml-2">Filtrar por {viewMode === 'daily' ? 'Dia' : 'Mês'}</label>
              {viewMode === 'daily' ? (
                <input type="date" className="w-full bg-gray-50 dark:bg-[#20143a] border-none rounded-2xl px-5 py-4 font-bold text-xs text-gray-900 dark:text-white" value={filterDate} onChange={e => setFilterDate(e.target.value)} />
              ) : (
                <input type="month" className="w-full bg-gray-50 dark:bg-[#20143a] border-none rounded-2xl px-5 py-4 font-bold text-xs text-gray-900 dark:text-white" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />
              )}
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-gray-400 ml-2">Forma de Pagamento</label>
              <select className="w-full bg-gray-50 dark:bg-[#20143a] border-none rounded-2xl px-5 py-4 font-bold uppercase text-xs text-gray-900 dark:text-white" value={filterPayment} onChange={e => setFilterPayment(e.target.value)}>
                 <option value="todos">Todos</option>
                 {Object.values(PaymentMethod).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-gray-400 ml-2">Filtrar por Funcionário</label>
              <select className="w-full bg-gray-50 dark:bg-[#20143a] border-none rounded-2xl px-5 py-4 font-bold uppercase text-xs text-gray-900 dark:text-white" value={filterUser} onChange={e => setFilterUser(e.target.value)}>
                <option value="todos">Todos</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
            </div>
            <div className="flex items-end gap-2 text-xs">
               <button onClick={() => setViewMode('daily')} className={`flex-1 py-4 rounded-2xl font-black text-[10px] uppercase border transition-all ${viewMode === 'daily' ? 'bg-purple-100 border-purple-200 text-purple-900 dark:bg-purple-900 dark:text-white' : 'bg-white dark:bg-[#20143a] text-gray-400 border-transparent'}`}>Diário</button>
               <button onClick={() => setViewMode('monthly')} className={`flex-1 py-4 rounded-2xl font-black text-[10px] uppercase border transition-all ${viewMode === 'monthly' ? 'bg-purple-100 border-purple-200 text-purple-900 dark:bg-purple-900 dark:text-white' : 'bg-white dark:bg-[#20143a] text-gray-400 border-transparent'}`}>Mensal</button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-[#160e2b] p-5 rounded-[28px] shadow-sm border-l-4 border-purple-900 dark:border-purple-600 border border-gray-100 dark:border-purple-900/30">
              <span className="text-[9px] font-black text-gray-400 dark:text-purple-300 uppercase">Total Bruto</span>
              <p className="text-xl md:text-2xl font-black text-purple-950 dark:text-purple-100">R$ {stats.total.toFixed(2)}</p>
            </div>
            <div className="bg-white dark:bg-[#160e2b] p-5 rounded-[28px] shadow-sm border-l-4 border-green-500 border border-gray-100 dark:border-purple-900/30">
              <span className="text-[9px] font-black text-gray-400 dark:text-purple-300 uppercase">Recebido (Caixa)</span>
              <p className="text-xl md:text-2xl font-black text-green-600 dark:text-green-400">R$ {stats.recebido.toFixed(2)}</p>
            </div>
            <div className="bg-white dark:bg-[#160e2b] p-5 rounded-[28px] shadow-sm border-l-4 border-amber-500 border border-gray-100 dark:border-purple-900/30">
              <span className="text-[9px] font-black text-gray-400 dark:text-purple-300 uppercase">Lucro Estimado</span>
              <p className="text-xl md:text-2xl font-black text-amber-600 dark:text-amber-400">
                R$ {lucroBruto.toFixed(2)}
                <span className="text-[10px] font-bold ml-1 opacity-70">({margemLucro.toFixed(0)}%)</span>
              </p>
            </div>
            <div className="bg-white dark:bg-[#160e2b] p-5 rounded-[28px] shadow-sm border-l-4 border-red-500 border border-gray-100 dark:border-purple-900/30">
              <span className="text-[9px] font-black text-gray-400 dark:text-purple-300 uppercase">Fiados Pendentes</span>
              <p className="text-xl md:text-2xl font-black text-red-600 dark:text-red-400">R$ {stats.pendente.toFixed(2)}</p>
            </div>
          </div>

          <div className="bg-white dark:bg-[#160e2b] rounded-[32px] shadow-sm border border-gray-100 dark:border-purple-900/40 overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-gray-50 dark:bg-[#20143a]/50">
                <tr>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase">Venda</th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase">Cliente</th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-purple-900/20">
                {filteredSales.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-purple-950/40 cursor-pointer active:scale-95 transition-all" onClick={() => setSelectedSale(s)}>
                    <td className="px-6 py-4">
                      <div className="text-[10px] font-black text-purple-900 dark:text-purple-300 uppercase">{s.forma_pagamento}</div>
                      <div className="text-[8px] text-gray-400 font-bold">{new Date(s.created_at).toLocaleTimeString()}</div>
                    </td>
                    <td className="px-6 py-4">
                       <div className="text-[10px] font-black text-gray-700 dark:text-gray-200 uppercase">{s.cliente_nome || 'Balcão'}</div>
                       <div className={`text-[7px] font-black uppercase ${s.status === 'pago' ? 'text-green-500' : 'text-red-500'}`}>{s.status}</div>
                    </td>
                    <td className="px-6 py-4 text-right font-black text-gray-900 dark:text-white">R$ {(s.valor_total || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 1: DETALHES DE COMPRAS DO DEVEDOR (TOP 10)               */}
      {/* ============================================================== */}
      {selectedDebtorDetail && (
        <div 
          className="fixed inset-0 bg-black/80 z-[120] flex items-center justify-center p-4 backdrop-blur-sm overflow-y-auto animate-in fade-in"
          onClick={() => setSelectedDebtorDetail(null)}
        >
          <div 
            className="bg-white dark:bg-[#160e2b] rounded-[40px] p-6 sm:p-8 w-full max-w-lg shadow-2xl my-auto border border-purple-100 dark:border-purple-900/40 max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-start pb-4 border-b border-gray-100 dark:border-purple-900/30">
              <div>
                <span className="text-[9px] font-black uppercase tracking-widest text-amber-500 block">
                  Ranking #{selectedDebtorDetail.rank}
                </span>
                <h3 className="text-xl font-black text-purple-950 dark:text-white uppercase tracking-tight">
                  {selectedDebtorDetail.nome}
                </h3>
                {selectedDebtorDetail.telefone && (
                  <p className="text-xs font-bold text-green-700 dark:text-green-400 flex items-center gap-1.5 mt-0.5">
                    <i className="fa-brands fa-whatsapp"></i> {formatPhone(selectedDebtorDetail.telefone)}
                  </p>
                )}
              </div>
              <button
                onClick={() => setSelectedDebtorDetail(null)}
                className="w-9 h-9 bg-gray-100 dark:bg-purple-950 hover:bg-gray-200 text-gray-500 rounded-full flex items-center justify-center transition-all"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            {/* Resumo da Inadimplência do Cliente */}
            <div className="grid grid-cols-2 gap-2 my-4">
              <div className="bg-red-50 dark:bg-red-950/60 p-3.5 rounded-2xl border border-red-100 dark:border-red-900/40">
                <span className="text-[9px] font-black uppercase text-red-500 tracking-wider block">Total Devido</span>
                <span className="text-xl font-black text-red-600 dark:text-red-400">
                  R$ {selectedDebtorDetail.totalDivida.toFixed(2)}
                </span>
              </div>
              <div className="bg-amber-50 dark:bg-amber-950/60 p-3.5 rounded-2xl border border-amber-100 dark:border-amber-900/40">
                <span className="text-[9px] font-black uppercase text-amber-700 dark:text-amber-300 tracking-wider block">Tempo Médio</span>
                <span className="text-xl font-black text-amber-800 dark:text-amber-200">
                  {selectedDebtorDetail.tempoMedioDias} dias
                </span>
              </div>
            </div>

            {/* Lista das Compras Pendentes do Cliente */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block">
                Histórico de Compras Pendentes ({selectedDebtorDetail.compras.length}):
              </span>

              {selectedDebtorDetail.compras.map(s => {
                const saleDays = Math.max(0, Math.floor((Date.now() - new Date(s.created_at).getTime()) / (1000 * 60 * 60 * 24)));
                return (
                  <div 
                    key={s.id}
                    className="bg-gray-50 dark:bg-[#20143a] p-3.5 rounded-2xl border border-gray-100 dark:border-purple-900/30 text-xs space-y-2"
                  >
                    <div className="flex justify-between items-center text-[10px] font-black uppercase">
                      <span className="text-purple-900 dark:text-purple-300 flex items-center gap-1.5">
                        <span className="bg-purple-100 dark:bg-purple-950 px-2 py-0.5 rounded-md">
                          {s.tipo_pedido === 'reserva' ? 'Reserva' : 'PDV'}
                        </span>
                        <span>{new Date(s.created_at).toLocaleDateString()} às {new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </span>
                      <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-md">
                        Há {saleDays} dias
                      </span>
                    </div>

                    <div className="space-y-1">
                      {s.itens?.map((it, idx) => (
                        <div key={idx} className="flex justify-between items-center text-gray-700 dark:text-gray-300 text-[11px] font-bold">
                          <span>{it.quantidade}x {it.nome}</span>
                          <span>R$ {((it.preco_unitario || 0) * it.quantidade).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="pt-2 border-t border-gray-200 dark:border-purple-900/40 flex justify-between items-center font-black text-gray-900 dark:text-white">
                      <span>Subtotal da Compra:</span>
                      <span className="text-red-600 dark:text-red-400">R$ {(Number(s.valor_total) || 0).toFixed(2)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-4 border-t border-gray-100 dark:border-purple-900/30 flex gap-2">
              {selectedDebtorDetail.telefone && (
                <a
                  href={getWhatsAppLink(selectedDebtorDetail.telefone, `Olá ${selectedDebtorDetail.nome}! Passando para lembrar da sua conta pendente na Cantina TUSEMM no valor total de R$ ${selectedDebtorDetail.totalDivida.toFixed(2)}. Chave PIX: ${products[0] ? '' : ''}. Muito obrigado! 🙏`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-3.5 rounded-2xl text-xs font-black uppercase text-center shadow-lg flex items-center justify-center gap-2"
                >
                  <i className="fa-brands fa-whatsapp text-sm"></i>
                  Cobrar no WhatsApp
                </a>
              )}
              <button
                onClick={() => setSelectedDebtorDetail(null)}
                className="py-3.5 px-6 rounded-2xl text-xs font-black uppercase bg-gray-100 dark:bg-purple-950 text-gray-700 dark:text-purple-300 hover:bg-gray-200"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 2: DETALHES DE UMA VENDA DO RELATÓRIO TRADICIONAL        */}
      {/* ============================================================== */}
      {selectedSale && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm overflow-y-auto" onClick={() => setSelectedSale(null)}>
          <div className="bg-white dark:bg-[#160e2b] rounded-[40px] p-8 w-full max-w-sm shadow-2xl my-auto border border-purple-100 dark:border-purple-900/40" onClick={e => e.stopPropagation()}>
            <h3 className="text-2xl font-black text-purple-950 dark:text-white uppercase text-center mb-2">Detalhes da Venda</h3>
            <p className="text-center text-xs font-bold text-gray-500 dark:text-purple-300 mb-6 uppercase tracking-wider">{selectedSale.cliente_nome || 'Balcão'}</p>
            
            <div className="bg-gray-50 dark:bg-[#20143a] rounded-3xl p-4 mb-6 max-h-60 overflow-y-auto border border-gray-100 dark:border-purple-900/30">
              <p className="text-[10px] font-black uppercase text-gray-400 mb-2 border-b border-gray-200 dark:border-purple-900/30 pb-2 flex justify-between">
                <span>{new Date(selectedSale.created_at).toLocaleDateString()}</span>
                <span>{new Date(selectedSale.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
              </p>
              <div className="space-y-2">
                {selectedSale.itens?.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center text-xs">
                    <span className="font-bold text-gray-700 dark:text-gray-300 uppercase">{item.quantidade}x {item.nome}</span>
                    <span className="font-black text-gray-900 dark:text-white">R$ {((item.preco_unitario || 0) * item.quantidade).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-purple-50 dark:bg-purple-950/60 p-4 rounded-3xl flex justify-between items-center mb-6">
              <div>
                <p className="text-[9px] font-black text-purple-400 uppercase">Status</p>
                <p className={`text-sm font-black uppercase ${selectedSale.status === 'pago' ? 'text-green-600' : 'text-red-500'}`}>{selectedSale.status}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-black text-purple-400 uppercase">Forma</p>
                <p className="text-sm font-black text-purple-900 dark:text-purple-300 uppercase">
                  {selectedSale.forma_pagamento}
                  {selectedSale.pago_com && <span className="block text-[8px] text-green-600 mt-0.5">Pago via {selectedSale.pago_com}</span>}
                </p>
              </div>
            </div>

            <div className="flex justify-between items-end border-t border-gray-100 dark:border-purple-900/30 pt-4 mb-6">
              <span className="text-[10px] font-black text-gray-400 uppercase">Total Geral</span>
              <span className="text-3xl font-black text-purple-950 dark:text-white">R$ {(Number(selectedSale.valor_total) || 0).toFixed(2)}</span>
            </div>

            <button 
              onClick={() => setSelectedSale(null)}
              className="w-full bg-gray-200 dark:bg-purple-950 text-gray-800 dark:text-purple-200 py-4 rounded-2xl font-black text-xs uppercase"
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
