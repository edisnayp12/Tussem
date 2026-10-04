import React, { useState, useMemo } from 'react';
import { AuditLog } from '../types';

interface LogViewProps {
  logs: AuditLog[];
}

const LogView: React.FC<LogViewProps> = ({ logs }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<'todos' | 'vendas' | 'fiado' | 'estoque' | 'acessos' | 'config'>('todos');

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Data não informada';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  const getActionBadge = (acao: string = '') => {
    const acaoLower = acao.toLowerCase();
    if (acaoLower.includes('venda')) {
      return {
        bg: 'bg-green-50 text-green-700 border-green-200',
        icon: 'fa-solid fa-cart-shopping'
      };
    }
    if (acaoLower.includes('fiado')) {
      return {
        bg: 'bg-purple-50 text-purple-700 border-purple-200',
        icon: 'fa-solid fa-handshake'
      };
    }
    if (acaoLower.includes('login') || acaoLower.includes('acesso')) {
      return {
        bg: 'bg-blue-50 text-blue-700 border-blue-200',
        icon: 'fa-solid fa-right-to-bracket'
      };
    }
    if (acaoLower.includes('exclusão') || acaoLower.includes('exclusao') || acaoLower.includes('remov')) {
      return {
        bg: 'bg-red-50 text-red-700 border-red-200',
        icon: 'fa-solid fa-trash-can'
      };
    }
    if (acaoLower.includes('produto') || acaoLower.includes('estoque')) {
      return {
        bg: 'bg-amber-50 text-amber-700 border-amber-200',
        icon: 'fa-solid fa-box'
      };
    }
    return {
      bg: 'bg-gray-100 text-gray-700 border-gray-200',
      icon: 'fa-solid fa-clock-rotate-left'
    };
  };

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const search = searchTerm.toLowerCase().trim();
      const matchesSearch = !search || 
        (log.usuario_nome || '').toLowerCase().includes(search) ||
        (log.acao || '').toLowerCase().includes(search) ||
        (log.detalhes || '').toLowerCase().includes(search) ||
        (log.data || '').toLowerCase().includes(search);

      if (!matchesSearch) return false;

      const acaoLower = (log.acao || '').toLowerCase();
      if (selectedFilter === 'vendas') return acaoLower.includes('venda');
      if (selectedFilter === 'fiado') return acaoLower.includes('fiado');
      if (selectedFilter === 'estoque') return acaoLower.includes('produto') || acaoLower.includes('estoque');
      if (selectedFilter === 'acessos') return acaoLower.includes('login') || acaoLower.includes('acesso');
      if (selectedFilter === 'config') return acaoLower.includes('config') || acaoLower.includes('usuário') || acaoLower.includes('auditoria');

      return true;
    });
  }, [logs, searchTerm, selectedFilter]);

  const stats = useMemo(() => {
    const total = logs.length;
    const vendas = logs.filter(l => (l.acao || '').toLowerCase().includes('venda') || (l.acao || '').toLowerCase().includes('fiado')).length;
    const admin = logs.filter(l => !(l.acao || '').toLowerCase().includes('venda') && !(l.acao || '').toLowerCase().includes('fiado')).length;
    const latest = logs[0] ? formatDate(logs[0].data) : 'Nenhum';
    return { total, vendas, admin, latest };
  }, [logs]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      {/* CABEÇALHO */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-purple-950 uppercase tracking-tighter">Logs do Sistema</h2>
          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mt-1">
            Auditoria em tempo real de vendas, acessos, fiados e estoque
          </p>
        </div>
      </div>

      {/* CARDS RESUMO */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white p-5 rounded-[28px] border border-gray-100 shadow-sm">
          <span className="text-[9px] font-black uppercase tracking-wider text-gray-400">Total Registros</span>
          <p className="text-2xl font-black text-purple-950 mt-1">{stats.total}</p>
          <span className="text-[8px] font-bold text-purple-600 uppercase mt-1 block">Eventos rastreados</span>
        </div>

        <div className="bg-white p-5 rounded-[28px] border border-gray-100 shadow-sm">
          <span className="text-[9px] font-black uppercase tracking-wider text-gray-400">Vendas & Baixas</span>
          <p className="text-2xl font-black text-green-600 mt-1">{stats.vendas}</p>
          <span className="text-[8px] font-bold text-green-600 uppercase mt-1 block">Operações de caixa</span>
        </div>

        <div className="bg-white p-5 rounded-[28px] border border-gray-100 shadow-sm">
          <span className="text-[9px] font-black uppercase tracking-wider text-gray-400">Ações Admin</span>
          <p className="text-2xl font-black text-blue-600 mt-1">{stats.admin}</p>
          <span className="text-[8px] font-bold text-blue-600 uppercase mt-1 block">Estoque & Usuários</span>
        </div>

        <div className="bg-white p-5 rounded-[28px] border border-gray-100 shadow-sm">
          <span className="text-[9px] font-black uppercase tracking-wider text-gray-400">Última Atividade</span>
          <p className="text-xs font-black text-gray-700 mt-2 line-clamp-1">{stats.latest}</p>
          <span className="text-[8px] font-bold text-gray-400 uppercase mt-1 block">Sincronizado via Firebase</span>
        </div>
      </div>

      {/* BARRA DE PESQUISA E FILTROS */}
      <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 space-y-4">
        <div className="relative">
          <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-gray-300"></i>
          <input
            type="text"
            placeholder="Pesquisar por usuário, tipo de ação, cliente ou detalhes..."
            className="w-full bg-gray-50 border-none rounded-2xl pl-12 pr-4 py-4 text-xs font-bold focus:ring-2 focus:ring-purple-500 outline-none transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {[
            { id: 'todos', label: 'Todos os Logs' },
            { id: 'vendas', label: 'Vendas' },
            { id: 'fiado', label: 'Fiados' },
            { id: 'estoque', label: 'Estoque & Produtos' },
            { id: 'acessos', label: 'Acessos & Login' },
            { id: 'config', label: 'Configurações' },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setSelectedFilter(f.id as any)}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                selectedFilter === f.id
                  ? 'bg-purple-900 text-white shadow-md'
                  : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* TABELA DE REGISTROS */}
      <div className="bg-white rounded-[32px] shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50/80 border-b border-gray-100">
              <tr>
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-wider">Data / Horário</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-wider">Responsável</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-wider">Tipo de Ação</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-wider">Detalhes do Evento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredLogs.map(log => {
                const badge = getActionBadge(log.acao);
                return (
                  <tr key={log.id} className="hover:bg-purple-50/30 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-[10px] font-bold text-gray-700">
                        {formatDate(log.data)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-[11px] font-black text-purple-950 uppercase flex items-center gap-1.5">
                        <i className="fa-solid fa-user-circle text-gray-400 text-xs"></i>
                        {log.usuario_nome || 'Operador'}
                      </div>
                      {log.usuario_id && log.usuario_id !== '0' && (
                        <div className="text-[8px] text-gray-400 font-mono">ID: {log.usuario_id.slice(0, 8)}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-wider border ${badge.bg}`}>
                        <i className={`${badge.icon} text-[10px]`}></i>
                        {log.acao}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-xs font-semibold text-gray-800 leading-snug">
                        {log.detalhes}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredLogs.length === 0 && (
          <div className="p-12 text-center space-y-3">
            <div className="w-14 h-14 bg-purple-50 rounded-2xl flex items-center justify-center mx-auto text-purple-900 text-xl">
              <i className="fa-solid fa-clipboard-question"></i>
            </div>
            <p className="text-xs font-black uppercase text-gray-700">Nenhum registro encontrado</p>
            <p className="text-[10px] text-gray-400 font-medium max-w-sm mx-auto">
              {searchTerm 
                ? 'Nenhum log corresponde ao termo pesquisado. Tente limpar os filtros.'
                : 'Os eventos realizados no sistema (vendas no balcão, fiados, acessos e alterações de estoque) serão listados aqui automaticamente em tempo real.'}
            </p>
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')} 
                className="mt-2 text-xs font-bold text-purple-700 underline"
              >
                Limpar Busca
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default LogView;
