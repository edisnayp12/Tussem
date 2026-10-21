import React, { useState, useMemo } from 'react';
import { Customer, Sale, User, PaymentMethod } from '../types';
import { normalizePhone, formatPhone, getWhatsAppLink } from '../utils/phoneUtils';

interface CustomersViewProps {
  customers: Customer[];
  sales: Sale[];
  currentUser: User | null;
  onSaveCustomer: (customerData: { nome: string; telefone: string }) => Promise<void>;
  onDeleteCustomer: (customerId: string, customerName: string) => Promise<void>;
  onSelectCustomerForSale?: (customer: Customer) => void;
}

const CustomersView: React.FC<CustomersViewProps> = ({
  customers,
  sales,
  currentUser,
  onSaveCustomer,
  onDeleteCustomer,
  onSelectCustomerForSale
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'todos' | 'com_fiado' | 'reservas'>('todos');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [inputNome, setInputNome] = useState('');
  const [inputTelefone, setInputTelefone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);

  // Normaliza o termo de busca para comparar tanto por texto quanto por números
  const searchDigits = normalizePhone(searchTerm);
  const searchLower = searchTerm.toLowerCase().trim();

  // Mapeia todas as vendas e fiados agrupados por telefone limpo
  const salesByPhone = useMemo(() => {
    const map = new Map<string, { totalGasto: number; totalFiado: number; sales: Sale[] }>();

    sales.forEach(sale => {
      const clean = normalizePhone(sale.telefone_comprador);
      const key = clean || (sale.cliente_nome ? sale.cliente_nome.trim().toLowerCase() : '');
      if (!key) return;

      const current = map.get(key) || { totalGasto: 0, totalFiado: 0, sales: [] };
      current.sales.push(sale);

      const val = Number(sale.valor_total) || 0;
      if (sale.status === 'pago') {
        current.totalGasto += val;
      } else if (sale.status === 'pendente') {
        current.totalFiado += val;
      }
      map.set(key, current);
    });

    return map;
  }, [sales]);

  // Lista consolidada de clientes, combinando coleção de customers com vendas registradas
  const consolidatedCustomers = useMemo(() => {
    const customerMap = new Map<string, Customer>();

    // 1. Clientes registrados na coleção customers
    customers.forEach(cust => {
      const clean = cust.telefone_limpo || normalizePhone(cust.telefone);
      const key = clean || cust.id;
      customerMap.set(key, {
        ...cust,
        telefone_limpo: clean,
        telefone: cust.telefone || (clean ? formatPhone(clean) : '')
      });
    });

    // 2. Extrai clientes adicionais a partir das vendas (caso tenha sido feita sem salvar na coleção)
    sales.forEach(sale => {
      if (!sale.cliente_nome || sale.cliente_nome === 'Balcão') return;
      const clean = normalizePhone(sale.telefone_comprador);
      const key = clean || sale.cliente_nome.trim().toLowerCase();

      if (!customerMap.has(key)) {
        customerMap.set(key, {
          id: key,
          nome: sale.cliente_nome.trim(),
          telefone: clean ? formatPhone(clean) : (sale.telefone_comprador || ''),
          telefone_limpo: clean,
          total_pedidos: 1,
          total_gasto: sale.status === 'pago' ? Number(sale.valor_total) || 0 : 0,
          created_at: sale.created_at || new Date().toISOString(),
          origem: sale.tipo_pedido === 'reserva' ? 'reserva' : 'pdv'
        });
      }
    });

    // Enriquece com dados consolidados de vendas e fiados em aberto
    const list = Array.from(customerMap.values()).map(cust => {
      const key = cust.telefone_limpo || cust.nome.trim().toLowerCase();
      const stats = salesByPhone.get(key);

      const totalFiado = stats ? stats.totalFiado : 0;
      const totalGasto = stats ? stats.totalGasto : (cust.total_gasto || 0);
      const totalPedidos = stats ? stats.sales.length : (cust.total_pedidos || 0);

      return {
        ...cust,
        total_fiado_aberto: totalFiado,
        total_gasto: totalGasto,
        total_pedidos: totalPedidos
      };
    });

    // Ordena por nome
    return list.sort((a, b) => a.nome.localeCompare(b.nome));
  }, [customers, sales, salesByPhone]);

  // Filtra clientes de acordo com busca e aba
  const filteredCustomers = useMemo(() => {
    return consolidatedCustomers.filter(c => {
      // Filtro de texto / telefone
      const matchesName = searchLower ? c.nome.toLowerCase().includes(searchLower) : true;
      const matchesPhone = searchDigits
        ? (c.telefone_limpo && (c.telefone_limpo.includes(searchDigits) || searchDigits.includes(c.telefone_limpo)))
        : true;
      const matchesTerm = matchesName || matchesPhone;

      if (!matchesTerm) return false;

      // Filtro de aba
      if (filterType === 'com_fiado') {
        return (c.total_fiado_aberto || 0) > 0;
      }
      if (filterType === 'reservas') {
        return c.origem === 'reserva';
      }
      return true;
    });
  }, [consolidatedCustomers, searchLower, searchDigits, filterType]);

  const handleOpenAdd = () => {
    setEditingCustomer(null);
    setInputNome('');
    setInputTelefone('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setInputNome(customer.nome);
    setInputTelefone(customer.telefone || customer.telefone_limpo || '');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputNome.trim()) return;

    setIsSubmitting(true);
    try {
      await onSaveCustomer({
        nome: inputNome.trim(),
        telefone: inputTelefone.trim()
      });
      setIsModalOpen(false);
      setInputNome('');
      setInputTelefone('');
      setEditingCustomer(null);
    } catch (err: any) {
      console.error("Erro ao salvar cliente:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (customer: Customer) => {
    if (confirm(`Deseja remover o cadastro de ${customer.nome}? Todas as vendas continuarão salvas.`)) {
      try {
        await onDeleteCustomer(customer.id, customer.nome);
      } catch (err) {
        console.error("Erro ao excluir cliente:", err);
      }
    }
  };

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-900 text-white rounded-2xl flex items-center justify-center font-black shadow-md">
              <i className="fa-solid fa-users"></i>
            </div>
            <div>
              <h2 className="text-2xl font-black text-purple-950 uppercase tracking-tight leading-none">
                Base de Clientes
              </h2>
              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1">
                Clientes de Reservas, PDV e Fiados Agrupados por Telefone
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleOpenAdd}
            className="bg-purple-900 hover:bg-black text-white px-5 py-3 rounded-2xl font-black text-xs uppercase tracking-wider shadow-lg flex items-center gap-2 active:scale-95 transition-all"
          >
            <i className="fa-solid fa-user-plus"></i>
            <span>Novo Cliente</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Total de Clientes</p>
          <p className="text-2xl font-black text-purple-950 mt-1">{consolidatedCustomers.length}</p>
        </div>
        <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Com Fiado em Aberto</p>
          <p className="text-2xl font-black text-amber-600 mt-1">
            {consolidatedCustomers.filter(c => (c.total_fiado_aberto || 0) > 0).length}
          </p>
        </div>
        <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Origem Reserva</p>
          <p className="text-2xl font-black text-blue-600 mt-1">
            {consolidatedCustomers.filter(c => c.origem === 'reserva').length}
          </p>
        </div>
        <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Total Gasto Consolidado</p>
          <p className="text-2xl font-black text-green-600 mt-1">
            R$ {consolidatedCustomers.reduce((acc, c) => acc + (c.total_gasto || 0), 0).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm space-y-3">
        <div className="relative">
          <i className="fa-solid fa-magnifying-glass absolute left-5 top-1/2 -translate-y-1/2 text-gray-400"></i>
          <input
            type="text"
            placeholder="Buscar por nome ou por número de telefone (com ou sem separação)..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-gray-50 border-none rounded-2xl pl-12 pr-10 py-3.5 text-xs font-bold text-gray-800 placeholder-gray-400 outline-none focus:ring-2 focus:ring-purple-200"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
            >
              <i className="fa-solid fa-times"></i>
            </button>
          )}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <button
            onClick={() => setFilterType('todos')}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
              filterType === 'todos' ? 'bg-purple-900 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            Todos ({consolidatedCustomers.length})
          </button>
          <button
            onClick={() => setFilterType('com_fiado')}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
              filterType === 'com_fiado' ? 'bg-amber-600 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            Com Fiado em Aberto
          </button>
          <button
            onClick={() => setFilterType('reservas')}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
              filterType === 'reservas' ? 'bg-purple-900 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            Cadastrados na Reserva
          </button>
        </div>
      </div>

      {/* Customers List */}
      <div className="space-y-3">
        {filteredCustomers.length === 0 ? (
          <div className="bg-white p-12 rounded-3xl border border-gray-100 text-center text-gray-400 space-y-3">
            <i className="fa-solid fa-user-slash text-4xl opacity-40"></i>
            <p className="text-xs font-black uppercase tracking-wider">
              Nenhum cliente encontrado com os filtros atuais
            </p>
          </div>
        ) : (
          filteredCustomers.map(customer => {
            const hasPhone = Boolean(customer.telefone_limpo || customer.telefone);
            const waNumber = customer.telefone_limpo || normalizePhone(customer.telefone);
            const fiadoAberto = customer.total_fiado_aberto || 0;

            const waMsg = fiadoAberto > 0
              ? `Olá ${customer.nome}! Tudo bem? Passando para lembrar sobre seu saldo em aberto de R$ ${fiadoAberto.toFixed(2)} na Cantina TUSEMM.`
              : `Olá ${customer.nome}! Tudo bem? Cantina TUSEMM à disposição!`;

            const waLink = getWhatsAppLink(waNumber, waMsg);

            return (
              <div
                key={customer.id}
                className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm hover:border-purple-200 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-purple-50 text-purple-900 rounded-2xl flex items-center justify-center font-black text-lg border border-purple-100 flex-shrink-0">
                    {customer.nome[0]?.toUpperCase() || 'C'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-black text-purple-950 text-sm uppercase leading-tight">
                        {customer.nome}
                      </h3>
                      {fiadoAberto > 0 && (
                        <span className="text-[9px] font-black bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full uppercase">
                          Fiado: R$ {fiadoAberto.toFixed(2)}
                        </span>
                      )}
                      {customer.origem === 'reserva' && (
                        <span className="text-[8px] font-black bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full uppercase">
                          Reserva
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500 font-bold flex-wrap">
                      {hasPhone ? (
                        <span className="flex items-center gap-1.5 text-gray-700">
                          <i className="fa-solid fa-phone text-[10px] text-purple-600"></i>
                          <span>{customer.telefone || formatPhone(customer.telefone_limpo)}</span>
                        </span>
                      ) : (
                        <span className="text-gray-400 italic text-[11px]">Sem telefone</span>
                      )}

                      <span className="text-gray-300">•</span>
                      <span>{customer.total_pedidos || 0} pedido(s)</span>

                      {(customer.total_gasto || 0) > 0 && (
                        <>
                          <span className="text-gray-300">•</span>
                          <span className="text-green-600">Total: R$ {(customer.total_gasto || 0).toFixed(2)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {/* WhatsApp button */}
                  {hasPhone && (
                    <a
                      href={waLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-green-500 hover:bg-green-600 text-white px-3.5 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-wider flex items-center gap-1.5 shadow-md shadow-green-500/20 active:scale-95 transition-all"
                      title="Chamar no WhatsApp"
                    >
                      <i className="fa-brands fa-whatsapp text-sm"></i>
                      <span>WhatsApp</span>
                    </a>
                  )}

                  {/* Ver Histórico */}
                  <button
                    onClick={() => setDetailCustomer(customer)}
                    className="bg-purple-50 text-purple-900 hover:bg-purple-100 px-3.5 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-wider flex items-center gap-1.5 transition-all"
                    title="Ver histórico de compras/reservas"
                  >
                    <i className="fa-solid fa-receipt text-[10px]"></i>
                    <span>Extrato</span>
                  </button>

                  {/* Editar */}
                  <button
                    onClick={() => handleOpenEdit(customer)}
                    className="bg-gray-100 hover:bg-gray-200 text-gray-700 p-2.5 rounded-xl text-xs active:scale-95 transition-all"
                    title="Editar Dados"
                  >
                    <i className="fa-solid fa-pen-to-square"></i>
                  </button>

                  {/* Excluir */}
                  <button
                    onClick={() => handleDelete(customer)}
                    className="bg-red-50 hover:bg-red-100 text-red-600 p-2.5 rounded-xl text-xs active:scale-95 transition-all"
                    title="Remover Cadastro"
                  >
                    <i className="fa-solid fa-trash-can"></i>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal Criar / Editar Cliente */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-2xl animate-in zoom-in-95">
            <h3 className="text-xl font-black text-purple-950 uppercase mb-4">
              {editingCustomer ? 'Editar Cliente' : 'Novo Cliente'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase text-purple-950 ml-1 mb-1 block">
                  Nome Completo
                </label>
                <input
                  type="text"
                  placeholder="Nome do Cliente"
                  value={inputNome}
                  onChange={e => setInputNome(e.target.value)}
                  className="w-full bg-gray-50 border-2 border-transparent focus:border-purple-200 rounded-2xl px-5 py-3.5 font-bold text-xs text-purple-950 outline-none"
                  required
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-purple-950 ml-1 mb-1 block">
                  Telefone / WhatsApp
                </label>
                <input
                  type="tel"
                  placeholder="Ex: (11) 98765-4321 ou 11987654321"
                  value={inputTelefone}
                  onChange={e => setInputTelefone(e.target.value)}
                  className="w-full bg-gray-50 border-2 border-transparent focus:border-purple-200 rounded-2xl px-5 py-3.5 font-bold text-xs text-purple-950 outline-none"
                />
                <p className="text-[8px] text-gray-400 mt-1 ml-1 font-bold">
                  O sistema normaliza e agrupa automaticamente independente de separação.
                </p>
              </div>

              <div className="pt-2 space-y-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-purple-900 text-white py-4 rounded-2xl font-black uppercase text-xs tracking-wider shadow-xl hover:bg-black transition-all disabled:opacity-50"
                >
                  {isSubmitting ? 'Salvando...' : 'Salvar Cliente'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="w-full text-xs font-black uppercase text-gray-400 py-2.5 hover:text-gray-600"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Detalhes / Extrato de Compras do Cliente */}
      {detailCustomer && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl animate-in zoom-in-95">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-xl font-black text-purple-950 uppercase leading-tight">
                  {detailCustomer.nome}
                </h3>
                <p className="text-xs text-gray-500 font-bold mt-0.5">
                  {detailCustomer.telefone || formatPhone(detailCustomer.telefone_limpo) || 'Sem telefone'}
                </p>
              </div>
              <button
                onClick={() => setDetailCustomer(null)}
                className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-200"
              >
                <i className="fa-solid fa-times"></i>
              </button>
            </div>

            {/* Resumo */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="bg-purple-50 p-3 rounded-2xl border border-purple-100">
                <p className="text-[8px] font-black uppercase text-purple-700">Total Pago</p>
                <p className="text-lg font-black text-purple-950">
                  R$ {(detailCustomer.total_gasto || 0).toFixed(2)}
                </p>
              </div>
              <div className="bg-amber-50 p-3 rounded-2xl border border-amber-100">
                <p className="text-[8px] font-black uppercase text-amber-800">Fiado em Aberto</p>
                <p className="text-lg font-black text-amber-900">
                  R$ {(detailCustomer.total_fiado_aberto || 0).toFixed(2)}
                </p>
              </div>
            </div>

            {/* Lista de Vendas e Reservas vinculadas a este cliente */}
            <h4 className="text-[10px] font-black uppercase tracking-wider text-gray-400 mb-2">
              Histórico de Vendas e Reservas Vinculadas
            </h4>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[150px]">
              {(() => {
                const key = detailCustomer.telefone_limpo || detailCustomer.nome.trim().toLowerCase();
                const clientSales = sales.filter(s => {
                  const sClean = normalizePhone(s.telefone_comprador);
                  if (detailCustomer.telefone_limpo && sClean) {
                    return sClean === detailCustomer.telefone_limpo;
                  }
                  return (s.cliente_nome || '').trim().toLowerCase() === detailCustomer.nome.trim().toLowerCase();
                });

                if (clientSales.length === 0) {
                  return (
                    <div className="text-center py-8 text-gray-400 text-xs font-bold">
                      Nenhuma venda registrada para este cliente ainda.
                    </div>
                  );
                }

                return clientSales.map(s => (
                  <div key={s.id} className="bg-gray-50 p-3.5 rounded-2xl border border-gray-100 flex justify-between items-center text-xs">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-black text-purple-950 uppercase">
                          {s.tipo_pedido === 'reserva' ? 'Reserva' : 'PDV'} #{s.id.slice(-5).toUpperCase()}
                        </span>
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase ${
                          s.status === 'pago' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {s.status} ({s.forma_pagamento})
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1 font-bold">
                        {new Date(s.created_at).toLocaleString('pt-BR')}
                      </p>
                    </div>
                    <span className="font-black text-purple-950 text-sm">
                      R$ {Number(s.valor_total).toFixed(2)}
                    </span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomersView;
