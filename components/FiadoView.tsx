import React, { useState, useMemo, useEffect } from 'react';
import { Sale, PaymentMethod, AppSettings, Product, SaleItem } from '../types';
import { QRCodeSVG } from 'qrcode.react';
import { generateStaticPix } from '../services/pix';

interface FiadoViewProps {
  fiados: Sale[];
  products?: Product[];
  settings: AppSettings;
  onPayDebt: (pedidoId: string, method: PaymentMethod) => Promise<void>;
  onUpdateFiadoCustomer?: (saleIds: string[], nome: string, telefone?: string) => Promise<void>;
  onAddFiadoSale?: (sale: any) => Promise<void>;
  onNavigateToPDV?: () => void;
}

export interface FiadoGroup {
  key: string;
  nome: string;
  total: number;
  sales: Sale[];
  telefone?: string;
}

const normalizePhone = (phone?: string): string => {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    digits = digits.slice(2);
  }
  return digits;
};

const formatPhone = (val: string): string => {
  const digits = val.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

const FiadoView: React.FC<FiadoViewProps> = ({ 
  fiados, 
  products = [], 
  settings, 
  onPayDebt, 
  onUpdateFiadoCustomer,
  onAddFiadoSale,
  onNavigateToPDV
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<FiadoGroup | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pixQrCode, setPixQrCode] = useState<string | null>(null);

  // Estados para Modal de Edição de Nome e Telefone
  const [editingGroup, setEditingGroup] = useState<FiadoGroup | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Estados para Modal de Incluir Nova Compra no Fiado
  const [addingSaleGroup, setAddingSaleGroup] = useState<FiadoGroup | null>(null);
  const [isNewCustomerModal, setIsNewCustomerModal] = useState(false);
  const [newSaleCustomerName, setNewSaleCustomerName] = useState('');
  const [newSaleCustomerPhone, setNewSaleCustomerPhone] = useState('');
  const [quickCart, setQuickCart] = useState<SaleItem[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [isSubmittingSale, setIsSubmittingSale] = useState(false);

  // Agrupamento dos fiados
  const groupedFiados = useMemo(() => {
    let filtered = fiados;
    const term = searchTerm.trim().toLowerCase();
    const cleanSearchTerm = term.replace(/\D/g, '');

    if (term) {
      filtered = fiados.filter(f => {
        const nameMatch = f.cliente_nome?.toLowerCase().includes(term);
        const normPhone = normalizePhone(f.telefone_comprador);
        const phoneMatch = f.telefone_comprador?.includes(term) || (cleanSearchTerm && normPhone.includes(cleanSearchTerm));
        return nameMatch || phoneMatch;
      });
    }
    
    const grouped: Record<string, FiadoGroup> = {};
    
    filtered.forEach(f => {
      const normPhone = normalizePhone(f.telefone_comprador);
      const rawNome = f.cliente_nome?.trim();
      const nome = rawNome && rawNome.length > 0 ? rawNome : 'Sem Nome';
      
      const groupKey = normPhone.length >= 8 
        ? `tel_${normPhone}` 
        : `nome_${nome.toLowerCase()}_${f.id.slice(0, 4)}`;

      if (!grouped[groupKey]) {
        grouped[groupKey] = {
          key: groupKey,
          nome: nome,
          total: 0,
          sales: [],
          telefone: f.telefone_comprador || ''
        };
      } else {
        if (nome && nome !== 'Sem Nome' && (grouped[groupKey].nome === 'Sem Nome' || nome.length > grouped[groupKey].nome.length)) {
          grouped[groupKey].nome = nome;
        }
        if (!grouped[groupKey].telefone && f.telefone_comprador) {
          grouped[groupKey].telefone = f.telefone_comprador;
        }
      }

      grouped[groupKey].sales.push(f);
      grouped[groupKey].total += (Number(f.valor_total) || 0);
    });
    
    return Object.values(grouped).sort((a,b) => a.nome.localeCompare(b.nome));
  }, [fiados, searchTerm]);

  const totalFiltered = useMemo(() => {
    return groupedFiados.reduce((acc, g) => acc + g.total, 0);
  }, [groupedFiados]);

  // Contagem de fiados sem telefone ou sem nome
  const missingContactCount = useMemo(() => {
    return groupedFiados.filter(g => !g.telefone || g.nome === 'Sem Nome').length;
  }, [groupedFiados]);

  // Handle Pix Generation no modal de pagamento
  useEffect(() => {
    if (paymentMethod === PaymentMethod.PIX && selectedGroup) {
      if (settings.pixChave) {
        const code = generateStaticPix(
          settings.pixChave,
          settings.pixTitular || 'Cantina',
          settings.pixCidade || 'Sua Cidade',
          selectedGroup.total,
          `F${Date.now()}`
        );
        setPixQrCode(code);
      } else {
        alert("Configure a chave PIX nas configurações!");
        setPaymentMethod(PaymentMethod.CASH);
      }
    } else {
      setPixQrCode(null);
    }
  }, [paymentMethod, selectedGroup, settings.pixChave, settings.pixTitular, settings.pixCidade]);

  const handlePayment = async () => {
    if (!selectedGroup || isProcessing) return;
    setIsProcessing(true);
    try {
      await Promise.all(
        selectedGroup.sales.map(s => onPayDebt(s.id, paymentMethod))
      );
      setSelectedGroup(null);
    } catch (e) {
      alert("Erro ao processar pagamento.");
    } finally {
      setIsProcessing(false);
    }
  };

  // Abrir modal de edição de cliente
  const openEditModal = (group: FiadoGroup, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingGroup(group);
    setEditName(group.nome === 'Sem Nome' ? '' : group.nome);
    setEditPhone(formatPhone(group.telefone || ''));
    setSaveSuccessMsg(null);
  };

  // Salvar alterações de Nome e Telefone
  const handleSaveCustomer = async () => {
    if (!editingGroup || !onUpdateFiadoCustomer) return;
    setIsSavingCustomer(true);
    try {
      const saleIds = editingGroup.sales.map(s => s.id);
      const cleanPhoneDigits = editPhone.replace(/\D/g, '');
      const formattedPhoneToSave = cleanPhoneDigits ? editPhone : '';
      const finalName = editName.trim() || 'Sem Nome';

      await onUpdateFiadoCustomer(saleIds, finalName, formattedPhoneToSave);
      
      setSaveSuccessMsg("Dados atualizados com sucesso!");
      setTimeout(() => {
        setEditingGroup(null);
        setSaveSuccessMsg(null);
        // Atualiza o grupo selecionado caso esteja aberto
        if (selectedGroup && selectedGroup.key === editingGroup.key) {
          setSelectedGroup(prev => prev ? {
            ...prev,
            nome: finalName,
            telefone: formattedPhoneToSave
          } : null);
        }
      }, 700);
    } catch (err: any) {
      alert("Erro ao atualizar dados: " + (err.message || "Tente novamente"));
    } finally {
      setIsSavingCustomer(false);
    }
  };

  // Abrir modal de incluir nova compra no fiado
  const openAddSaleModal = (group?: FiadoGroup, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (group) {
      setAddingSaleGroup(group);
      setNewSaleCustomerName(group.nome === 'Sem Nome' ? '' : group.nome);
      setNewSaleCustomerPhone(formatPhone(group.telefone || ''));
      setIsNewCustomerModal(false);
    } else {
      setAddingSaleGroup(null);
      setNewSaleCustomerName('');
      setNewSaleCustomerPhone('');
      setIsNewCustomerModal(true);
    }
    setQuickCart([]);
    setProductSearch('');
  };

  // Manipular carrinho rápido para nova compra fiada
  const addToQuickCart = (product: Product) => {
    setQuickCart(prev => {
      const existing = prev.find(item => item.produto_id === product.id);
      if (existing) {
        return prev.map(item => item.produto_id === product.id 
          ? { ...item, quantidade: item.quantidade + 1, subtotal: (item.quantidade + 1) * item.preco_unitario }
          : item
        );
      }
      return [...prev, {
        produto_id: product.id,
        nome: product.nome,
        preco_unitario: Number(product.preco) || 0,
        quantidade: 1,
        subtotal: Number(product.preco) || 0
      }];
    });
  };

  const updateQuickCartQty = (productId: string, delta: number) => {
    setQuickCart(prev => {
      return prev.map(item => {
        if (item.produto_id === productId) {
          const newQty = item.quantidade + delta;
          if (newQty <= 0) return null;
          return { ...item, quantidade: newQty, subtotal: newQty * item.preco_unitario };
        }
        return item;
      }).filter(Boolean) as SaleItem[];
    });
  };

  const quickCartTotal = useMemo(() => {
    return quickCart.reduce((sum, item) => sum + (item.subtotal || 0), 0);
  }, [quickCart]);

  // Confirmar nova compra no fiado
  const handleConfirmFiadoSale = async () => {
    if (quickCart.length === 0) {
      alert("Adicione pelo menos um item à compra.");
      return;
    }
    if (!onAddFiadoSale) {
      alert("Função de venda não disponível.");
      return;
    }

    setIsSubmittingSale(true);
    try {
      const finalName = newSaleCustomerName.trim() || (addingSaleGroup?.nome !== 'Sem Nome' ? addingSaleGroup?.nome : 'Sem Nome') || 'Sem Nome';
      const finalPhone = newSaleCustomerPhone.trim() || addingSaleGroup?.telefone || '';

      await onAddFiadoSale({
        items: quickCart,
        total: quickCartTotal,
        paymentMethod: PaymentMethod.FIADO,
        customerName: finalName,
        telefone_comprador: finalPhone,
        isDebtPaid: false
      });

      setAddingSaleGroup(null);
      setIsNewCustomerModal(false);
      setQuickCart([]);
      alert(`Compra de R$ ${quickCartTotal.toFixed(2)} incluída no fiado com sucesso!`);
    } catch (e: any) {
      alert("Erro ao adicionar venda no fiado: " + (e.message || "Tente novamente"));
    } finally {
      setIsSubmittingSale(false);
    }
  };

  const generateWhatsAppLink = (group: FiadoGroup) => {
    const rawDigits = group.telefone?.replace(/\D/g, '') || '';
    if (!rawDigits) return '#';
    
    // Normaliza para incluir DDD brasileiro e tirar 55 inicial se já houver
    let cleanPhone = rawDigits;
    if (cleanPhone.length >= 12 && cleanPhone.startsWith('55')) {
      cleanPhone = cleanPhone.slice(2);
    }
    
    const total = group.total.toFixed(2).replace('.', ',');
    
    let detalhesText = '';
    group.sales.forEach(sale => {
      const dateObj = new Date(sale.created_at);
      const dataStr = dateObj.toLocaleDateString('pt-BR');
      const horaStr = dateObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const tipoLabel = sale.tipo_pedido === 'reserva' ? ' [Reserva]' : ' [Balcão PDV]';
      
      detalhesText += `\n🗓 *${dataStr} às ${horaStr}*${tipoLabel}\n`;
      sale.itens?.forEach(item => {
        detalhesText += `- ${item.quantidade}x ${item.nome}\n`;
      });
      detalhesText += `_(Subtotal: R$ ${sale.valor_total.toFixed(2).replace('.', ',')})_\n`;
    });

    let pixInfo = '';
    if (settings.pixChave) {
      pixInfo = `\n\n*Nossa Chave PIX:*\n${settings.pixChave}`;
      if (settings.pixTitular) {
        pixInfo += `\nTitular: ${settings.pixTitular}`;
      }
    }

    const message = `Olá ${group.nome}! Aqui é da Cantina ${settings.cantinaName || 'TUSEMM'}.\n\nVocê possui um total de R$ ${total} pendente em fiados.\n\n*Detalhes das compras:*${detalhesText}${pixInfo}\n\nPor favor, realize o pagamento para darmos baixa no sistema. Muito obrigado!`;
    
    return `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(message)}`;
  };

  const filteredProducts = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    if (!term) return products.slice(0, 15);
    return products.filter(p => p.nome.toLowerCase().includes(term) || p.categoria.toLowerCase().includes(term)).slice(0, 20);
  }, [products, productSearch]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      {/* HEADER BANNER */}
      <div className="bg-gradient-to-r from-purple-950 via-purple-900 to-indigo-950 text-white p-8 rounded-[40px] shadow-2xl relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-10 -translate-y-10 w-64 h-64 bg-purple-600/20 rounded-full blur-3xl pointer-events-none"></div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-purple-200">
                <i className="fa-solid fa-user-clock text-xl"></i>
              </div>
              <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tight">Fiados & Cobranças</h2>
            </div>
            <p className="opacity-75 text-xs font-bold mt-2 max-w-xl">
              Gerencie dívidas, adicione novas compras ao fiado, complete nomes e números de WhatsApp para cobrar com 1 clique.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => openAddSaleModal()}
              className="bg-purple-600 hover:bg-purple-500 text-white font-black px-6 py-4 rounded-2xl text-xs uppercase tracking-wider shadow-lg flex items-center gap-2.5 transition-all active:scale-95"
            >
              <i className="fa-solid fa-cart-plus text-sm"></i>
              + Nova Venda no Fiado
            </button>
            {onNavigateToPDV && (
              <button
                onClick={onNavigateToPDV}
                className="bg-white/10 hover:bg-white/20 text-white font-bold px-5 py-4 rounded-2xl text-xs uppercase tracking-wider transition-all"
              >
                Abrir PDV
              </button>
            )}
          </div>
        </div>

        {/* STATS BANNER */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-6 pt-6 border-t border-white/10">
          <div className="bg-white/5 rounded-2xl p-4">
            <span className="text-[10px] font-black uppercase tracking-widest opacity-60 block">Total a Receber</span>
            <span className="text-xl md:text-2xl font-black text-amber-300">R$ {totalFiltered.toFixed(2)}</span>
          </div>
          <div className="bg-white/5 rounded-2xl p-4">
            <span className="text-[10px] font-black uppercase tracking-widest opacity-60 block">Clientes em Aberto</span>
            <span className="text-xl md:text-2xl font-black text-white">{groupedFiados.length}</span>
          </div>
          <div className="col-span-2 md:col-span-1 bg-white/5 rounded-2xl p-4">
            <span className="text-[10px] font-black uppercase tracking-widest opacity-60 block">Pendentes de WhatsApp/Nome</span>
            <span className={`text-xl md:text-2xl font-black ${missingContactCount > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {missingContactCount} {missingContactCount === 1 ? 'cliente' : 'clientes'}
            </span>
          </div>
        </div>
      </div>

      {/* SEARCH AND FILTERS */}
      <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center gap-4 justify-between">
        <div className="relative flex-1">
          <i className="fa-solid fa-search absolute left-5 top-1/2 -translate-y-1/2 text-gray-400"></i>
          <input
            type="text"
            placeholder="Buscar fiado por nome ou telefone..."
            className="w-full bg-gray-50 border-none rounded-2xl pl-12 pr-6 py-4 text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-purple-500 placeholder-gray-400"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        {searchTerm.trim() && (
          <div className="bg-purple-50 text-purple-900 px-6 py-3 rounded-2xl flex items-center justify-between md:justify-end gap-3 whitespace-nowrap">
            <span className="text-[10px] font-black uppercase tracking-widest opacity-70">Resultado busca:</span>
            <span className="text-base font-black">R$ {totalFiltered.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* GRID DE FIADOS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {groupedFiados.map(group => {
          const hasPhone = Boolean(group.telefone && group.telefone.replace(/\D/g, '').length >= 8);
          const isSemNome = group.nome === 'Sem Nome';

          return (
            <div 
              key={group.key}
              className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 hover:border-purple-200 hover:shadow-md transition-all flex flex-col justify-between relative group overflow-hidden"
            >
              {/* Top Card Bar */}
              <div className="flex justify-between items-start mb-3">
                <div className="flex-1 pr-2">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="font-black text-purple-950 uppercase text-lg leading-tight">
                      {group.nome}
                    </h3>
                    {isSemNome && (
                      <span className="bg-amber-100 text-amber-800 text-[8px] font-black uppercase px-2 py-0.5 rounded-full">
                        Sem Nome
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    {group.sales.length} {group.sales.length === 1 ? 'compra pendente' : 'compras pendentes'}
                  </p>
                </div>

                <div className="bg-red-50 text-red-600 px-3.5 py-1.5 rounded-2xl font-black text-sm whitespace-nowrap border border-red-100">
                  R$ {group.total.toFixed(2)}
                </div>
              </div>

              {/* Informação de Contato / WhatsApp */}
              <div className="my-3 py-2 px-3 bg-gray-50 rounded-2xl flex items-center justify-between">
                {hasPhone ? (
                  <div className="flex items-center gap-2 text-xs font-bold text-green-700">
                    <i className="fa-brands fa-whatsapp text-green-600 text-base"></i>
                    <span>{formatPhone(group.telefone || '')}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[10px] font-bold text-amber-700">
                    <i className="fa-solid fa-triangle-exclamation text-amber-500"></i>
                    <span>Sem WhatsApp cadastrado</span>
                  </div>
                )}

                <button
                  onClick={(e) => openEditModal(group, e)}
                  title="Editar ou incluir nome e telefone"
                  className="bg-white hover:bg-purple-50 text-purple-700 border border-purple-200 px-2.5 py-1 rounded-xl text-[9px] font-black uppercase tracking-wider flex items-center gap-1 shadow-xs transition-all active:scale-95"
                >
                  <i className="fa-solid fa-pen-to-square"></i>
                  {hasPhone && !isSemNome ? 'Editar' : 'Completar'}
                </button>
              </div>

              {/* Botões de Ação do Card */}
              <div className="mt-4 pt-3 border-t border-gray-100 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { setSelectedGroup(group); setPaymentMethod(PaymentMethod.CASH); }}
                    className="bg-green-600 hover:bg-green-700 text-white py-3 rounded-2xl text-[10px] font-black uppercase tracking-wider shadow-sm flex items-center justify-center gap-1.5 transition-all active:scale-95"
                  >
                    <i className="fa-solid fa-check"></i>
                    Quitar Tudo
                  </button>

                  <button
                    onClick={(e) => openAddSaleModal(group, e)}
                    className="bg-purple-100 hover:bg-purple-200 text-purple-900 py-3 rounded-2xl text-[10px] font-black uppercase tracking-wider shadow-sm flex items-center justify-center gap-1.5 transition-all active:scale-95"
                  >
                    <i className="fa-solid fa-plus"></i>
                    + Compra
                  </button>
                </div>

                {/* Botão de Cobrança WhatsApp */}
                {hasPhone ? (
                  <a
                    href={generateWhatsAppLink(group)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-xs"
                  >
                    <i className="fa-brands fa-whatsapp text-emerald-600 text-sm"></i>
                    Cobrar no WhatsApp
                  </a>
                ) : (
                  <button
                    onClick={(e) => openEditModal(group, e)}
                    className="w-full bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-xs"
                  >
                    <i className="fa-brands fa-whatsapp text-amber-600 text-sm"></i>
                    Incluir WhatsApp p/ Cobrar
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {groupedFiados.length === 0 && (
          <div className="col-span-full text-center py-16 bg-white rounded-[32px] border border-gray-100 shadow-sm">
            <div className="w-20 h-20 bg-green-50 text-green-600 rounded-full flex items-center justify-center text-4xl mx-auto mb-4">
              <i className="fa-solid fa-circle-check"></i>
            </div>
            <h4 className="text-lg font-black uppercase text-gray-800 mb-1">Nenhum Fiado Pendente</h4>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest max-w-sm mx-auto mb-6">
              Todos os clientes estão com suas contas quitadas e em dia!
            </p>
            <button
              onClick={() => openAddSaleModal()}
              className="bg-purple-900 text-white font-black px-6 py-4 rounded-2xl text-xs uppercase tracking-wider shadow-lg active:scale-95 transition-all inline-flex items-center gap-2"
            >
              <i className="fa-solid fa-plus"></i>
              Registrar Novo Fiado
            </button>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* MODAL 1: EDITAR / INCLUIR NOME E TELEFONE NO FIADO             */}
      {/* ============================================================== */}
      {editingGroup && (
        <div 
          className="fixed inset-0 bg-black/80 z-[120] flex items-center justify-center p-4 backdrop-blur-sm overflow-y-auto animate-in fade-in"
          onClick={() => !isSavingCustomer && setEditingGroup(null)}
        >
          <div 
            className="bg-white rounded-[40px] p-8 w-full max-w-md shadow-2xl my-auto animate-in zoom-in-95 border border-purple-100" 
            onClick={e => e.stopPropagation()}
          >
            <div className="text-center mb-6">
              <div className="w-14 h-14 bg-purple-100 text-purple-700 rounded-3xl flex items-center justify-center text-2xl mx-auto mb-3">
                <i className="fa-solid fa-user-pen"></i>
              </div>
              <h3 className="text-xl font-black text-purple-950 uppercase tracking-tight">
                Editar Dados do Fiado
              </h3>
              <p className="text-xs font-bold text-gray-500 mt-1">
                Atualize o nome e o WhatsApp deste cliente para habilitar a cobrança automática.
              </p>
            </div>

            <div className="bg-purple-50 p-4 rounded-2xl mb-5 border border-purple-100">
              <div className="flex justify-between items-center text-xs font-bold text-purple-900">
                <span>Total de compras vinculadas:</span>
                <span className="font-black">{editingGroup.sales.length} vendas</span>
              </div>
              <div className="flex justify-between items-center text-xs font-bold text-purple-900 mt-1">
                <span>Dívida pendente total:</span>
                <span className="font-black text-red-600">R$ {editingGroup.total.toFixed(2)}</span>
              </div>
            </div>

            {saveSuccessMsg && (
              <div className="mb-4 bg-emerald-50 text-emerald-800 border border-emerald-200 p-3 rounded-2xl text-xs font-black text-center flex items-center justify-center gap-2">
                <i className="fa-solid fa-circle-check"></i>
                {saveSuccessMsg}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase text-purple-900 tracking-wider mb-1 block pl-1">
                  Nome do Cliente
                </label>
                <input
                  type="text"
                  placeholder="Ex: João da Silva..."
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  disabled={isSavingCustomer}
                  className="w-full bg-gray-50 border border-gray-200 focus:border-purple-500 rounded-2xl px-5 py-3.5 font-bold uppercase text-xs text-purple-950 outline-none transition-all"
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-purple-900 tracking-wider mb-1 block pl-1">
                  Número de Telefone / WhatsApp com DDD
                </label>
                <div className="relative">
                  <i className="fa-brands fa-whatsapp absolute left-4 top-1/2 -translate-y-1/2 text-green-600 text-lg"></i>
                  <input
                    type="tel"
                    placeholder="(11) 99999-9999"
                    value={editPhone}
                    onChange={e => setEditPhone(formatPhone(e.target.value))}
                    disabled={isSavingCustomer}
                    className="w-full bg-gray-50 border border-gray-200 focus:border-purple-500 rounded-2xl pl-12 pr-4 py-3.5 font-bold text-xs text-purple-950 outline-none transition-all"
                  />
                </div>
                <p className="text-[9px] font-bold text-gray-400 mt-1 pl-1">
                  Opcional, mas necessário para abrir a cobrança direta no WhatsApp.
                </p>
              </div>
            </div>

            <div className="mt-8 space-y-2">
              <button
                onClick={handleSaveCustomer}
                disabled={isSavingCustomer}
                className="w-full bg-purple-900 hover:bg-purple-800 text-white py-4 rounded-2xl font-black uppercase text-xs tracking-wider shadow-lg active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSavingCustomer ? (
                  <span>Salvando...</span>
                ) : (
                  <>
                    <i className="fa-solid fa-floppy-disk"></i>
                    Salvar Dados no Fiado
                  </>
                )}
              </button>
              <button
                onClick={() => setEditingGroup(null)}
                disabled={isSavingCustomer}
                className="w-full py-3 text-xs font-black uppercase text-gray-400 hover:text-gray-600 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 2: INCLUIR NOVA COMPRA / PRODUTOS AO FIADO               */}
      {/* ============================================================== */}
      {(addingSaleGroup || isNewCustomerModal) && (
        <div 
          className="fixed inset-0 bg-black/80 z-[120] flex items-center justify-center p-4 backdrop-blur-sm overflow-y-auto animate-in fade-in"
          onClick={() => !isSubmittingSale && (setAddingSaleGroup(null), setIsNewCustomerModal(false))}
        >
          <div 
            className="bg-white rounded-[40px] p-6 md:p-8 w-full max-w-lg shadow-2xl my-auto animate-in zoom-in-95 border border-purple-100 max-h-[90vh] flex flex-col" 
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex justify-between items-center pb-4 border-b border-gray-100">
              <div>
                <h3 className="text-xl font-black text-purple-950 uppercase tracking-tight">
                  {addingSaleGroup ? `+ Compra para ${addingSaleGroup.nome}` : 'Nova Venda no Fiado'}
                </h3>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-0.5">
                  Adicione produtos à dívida fiada
                </p>
              </div>
              <button
                onClick={() => { setAddingSaleGroup(null); setIsNewCustomerModal(false); }}
                className="w-9 h-9 bg-gray-100 hover:bg-gray-200 text-gray-500 rounded-full flex items-center justify-center transition-all"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="overflow-y-auto py-4 flex-1 space-y-4">
              {/* Identificação do Cliente */}
              <div className="bg-purple-50 p-4 rounded-2xl border border-purple-100 space-y-3">
                <span className="text-[9px] font-black uppercase tracking-widest text-purple-900 block">
                  Cliente do Fiado
                </span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[8px] font-black uppercase text-purple-800 tracking-wider mb-1 block">
                      Nome do Cliente
                    </label>
                    <input
                      type="text"
                      placeholder="Nome do cliente fiado..."
                      value={newSaleCustomerName}
                      onChange={e => setNewSaleCustomerName(e.target.value)}
                      className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold uppercase text-purple-950 outline-none focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="text-[8px] font-black uppercase text-purple-800 tracking-wider mb-1 block">
                      WhatsApp com DDD
                    </label>
                    <input
                      type="tel"
                      placeholder="(11) 99999-9999"
                      value={newSaleCustomerPhone}
                      onChange={e => setNewSaleCustomerPhone(formatPhone(e.target.value))}
                      className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-purple-950 outline-none focus:border-purple-500"
                    />
                  </div>
                </div>
              </div>

              {/* Seletor de Produtos */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-black uppercase text-gray-700 tracking-wider">
                    Selecionar Produtos da Cantina
                  </span>
                  <span className="text-[9px] font-bold text-gray-400">
                    {quickCart.length} selecionado(s)
                  </span>
                </div>

                <div className="relative mb-3">
                  <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                  <input
                    type="text"
                    placeholder="Filtrar produtos por nome..."
                    value={productSearch}
                    onChange={e => setProductSearch(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-9 pr-3 py-2 text-xs font-bold text-gray-900 outline-none focus:border-purple-500"
                  />
                </div>

                {/* Lista de Produtos Rápida */}
                <div className="max-h-36 overflow-y-auto space-y-1.5 border border-gray-100 rounded-2xl p-2 bg-gray-50/50">
                  {filteredProducts.map(p => {
                    const inCart = quickCart.find(i => i.produto_id === p.id);
                    return (
                      <div
                        key={p.id}
                        className="bg-white p-2.5 rounded-xl border border-gray-100 flex items-center justify-between text-xs hover:border-purple-200 transition-all"
                      >
                        <div className="flex-1 pr-2">
                          <p className="font-black text-gray-800 uppercase leading-tight">{p.nome}</p>
                          <p className="text-[10px] font-bold text-purple-600 mt-0.5">R$ {Number(p.preco).toFixed(2)}</p>
                        </div>
                        {inCart ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => updateQuickCartQty(p.id, -1)}
                              className="w-6 h-6 bg-gray-100 rounded-lg font-black text-xs flex items-center justify-center hover:bg-gray-200"
                            >
                              -
                            </button>
                            <span className="font-black text-xs w-5 text-center">{inCart.quantidade}</span>
                            <button
                              onClick={() => updateQuickCartQty(p.id, 1)}
                              className="w-6 h-6 bg-purple-100 text-purple-900 rounded-lg font-black text-xs flex items-center justify-center hover:bg-purple-200"
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => addToQuickCart(p)}
                            className="bg-purple-900 hover:bg-purple-800 text-white px-3 py-1.5 rounded-xl font-black text-[10px] uppercase transition-all active:scale-95"
                          >
                            + Adicionar
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {filteredProducts.length === 0 && (
                    <p className="text-center py-4 text-xs font-bold text-gray-400 uppercase">Nenhum produto encontrado</p>
                  )}
                </div>
              </div>

              {/* Itens Escolhidos / Resumo */}
              {quickCart.length > 0 && (
                <div className="bg-amber-50/50 border border-amber-200 rounded-2xl p-3 space-y-2">
                  <span className="text-[9px] font-black uppercase text-amber-900 tracking-wider block">
                    Itens da Nova Compra:
                  </span>
                  <div className="space-y-1 max-h-24 overflow-y-auto">
                    {quickCart.map(item => (
                      <div key={item.produto_id} className="flex justify-between items-center text-xs">
                        <span className="font-bold text-gray-700 uppercase">
                          {item.quantidade}x {item.nome}
                        </span>
                        <span className="font-black text-gray-900">
                          R$ {item.subtotal.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="pt-2 border-t border-amber-200/60 flex justify-between items-center text-sm font-black text-amber-950">
                    <span>Subtotal Desta Venda:</span>
                    <span>R$ {quickCartTotal.toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="pt-4 border-t border-gray-100 space-y-2">
              <button
                onClick={handleConfirmFiadoSale}
                disabled={isSubmittingSale || quickCart.length === 0}
                className="w-full bg-purple-900 hover:bg-purple-800 text-white py-4 rounded-2xl font-black uppercase text-xs tracking-wider shadow-xl active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmittingSale ? (
                  <span>Gravando no Fiado...</span>
                ) : (
                  <>
                    <i className="fa-solid fa-check"></i>
                    Lançar R$ {quickCartTotal.toFixed(2)} no Fiado
                  </>
                )}
              </button>
              <button
                onClick={() => { setAddingSaleGroup(null); setIsNewCustomerModal(false); }}
                disabled={isSubmittingSale}
                className="w-full py-2.5 text-xs font-black uppercase text-gray-400 hover:text-gray-600 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 3: RECEBER / QUITAR FIADO PENDENTE                        */}
      {/* ============================================================== */}
      {selectedGroup && (
        <div 
          className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm overflow-y-auto" 
          onClick={() => setSelectedGroup(null)}
        >
          <div 
            className="bg-white rounded-[40px] p-8 w-full max-w-sm shadow-2xl my-auto animate-in zoom-in-95 border border-purple-100" 
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-2xl font-black text-purple-950 uppercase text-center mb-1">
              Receber Fiado
            </h3>
            <p className="text-center text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
              {selectedGroup.nome}
            </p>

            {selectedGroup.telefone ? (
              <p className="text-center text-xs font-bold text-green-700 flex items-center justify-center gap-1.5 mb-3">
                <i className="fa-brands fa-whatsapp text-green-600"></i>
                {formatPhone(selectedGroup.telefone)}
              </p>
            ) : (
              <p className="text-center text-[10px] font-bold text-amber-600 mb-3">
                Sem telefone cadastrado
              </p>
            )}

            {/* Atalhos rápidos para Editar Contato ou Adicionar Compra */}
            <div className="flex justify-center gap-2 mb-4">
              <button
                onClick={(e) => openEditModal(selectedGroup, e)}
                className="bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider flex items-center gap-1 transition-all"
              >
                <i className="fa-solid fa-pen-to-square"></i>
                Editar Contato
              </button>
              <button
                onClick={(e) => {
                  const grp = selectedGroup;
                  setSelectedGroup(null);
                  openAddSaleModal(grp, e);
                }}
                className="bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider flex items-center gap-1 transition-all"
              >
                <i className="fa-solid fa-plus"></i>
                + Compra
              </button>
            </div>
            
            {/* Lista das compras deste cliente */}
            <div className="bg-gray-50 rounded-3xl p-4 mb-5 max-h-40 overflow-y-auto border border-gray-100">
              {selectedGroup.sales.map((sale) => (
                <div key={sale.id} className="mb-4 last:mb-0 border-b border-gray-200 last:border-0 pb-4 last:pb-0">
                  <p className="text-[10px] font-black uppercase text-gray-400 mb-2 flex justify-between items-center">
                    <span className="flex items-center gap-1.5">
                      <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider ${
                        sale.tipo_pedido === 'reserva' 
                          ? 'bg-purple-100 text-purple-800' 
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {sale.tipo_pedido === 'reserva' ? 'Reserva' : 'PDV'}
                      </span>
                      <span>
                        {new Date(sale.created_at).toLocaleDateString()} às {new Date(sale.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </span>
                    <span className="font-bold text-gray-700">R$ {sale.valor_total.toFixed(2)}</span>
                  </p>
                  <div className="space-y-1">
                    {sale.itens?.map((item, i) => (
                      <div key={i} className="flex justify-between items-center text-xs">
                        <span className="font-bold text-gray-700 uppercase">{item.quantidade}x {item.nome}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Total */}
            <div className="bg-red-50 p-5 rounded-3xl text-center mb-5 relative border border-red-100">
              <p className="text-[9px] font-black text-red-400 uppercase">
                Total a Pagar ({selectedGroup.sales.length} compras)
              </p>
              <p className="text-3xl font-black text-red-600">
                R$ {selectedGroup.total.toFixed(2)}
              </p>
              
              {selectedGroup.telefone ? (
                <div className="mt-3 flex justify-center">
                  <a 
                    href={generateWhatsAppLink(selectedGroup)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-white text-gray-700 hover:bg-gray-50 border border-gray-200 px-4 py-2 rounded-xl text-[10px] font-black uppercase shadow-sm flex items-center gap-2 transition-all"
                  >
                    <i className="fa-brands fa-whatsapp text-green-500 text-sm"></i>
                    Cobrar no WhatsApp
                  </a>
                </div>
              ) : (
                <div className="mt-3 flex justify-center">
                  <button
                    onClick={(e) => openEditModal(selectedGroup, e)}
                    className="bg-white text-purple-900 border border-purple-200 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase flex items-center gap-1.5 shadow-xs"
                  >
                    <i className="fa-solid fa-phone"></i>
                    Cadastrar Telefone para Cobrar
                  </button>
                </div>
              )}
            </div>
            
            {/* QR Code Pix */}
            {paymentMethod === PaymentMethod.PIX && pixQrCode && (
              <div className="bg-gray-100 p-4 rounded-xl mb-5 flex flex-col items-center justify-center fade-in animate-in slide-in-from-top-2">
                <p className="text-[10px] font-black uppercase text-purple-900 mb-2">QR Code PIX</p>
                <QRCodeSVG value={pixQrCode} size={170} />
              </div>
            )}

            {/* Formas de Baixa */}
            <div className="grid grid-cols-2 gap-2 mb-5">
               {[PaymentMethod.PIX, PaymentMethod.CASH, PaymentMethod.DEBIT, PaymentMethod.CREDIT].map(m => (
                 <button 
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={`py-3 rounded-2xl text-[10px] font-black uppercase border-2 transition-all ${
                    paymentMethod === m 
                      ? 'bg-purple-900 border-purple-900 text-white shadow-lg' 
                      : 'bg-white text-gray-400 border-gray-100'
                  }`}
                 >
                   {m}
                 </button>
               ))}
            </div>

            <button 
              onClick={handlePayment}
              disabled={isProcessing || (paymentMethod === PaymentMethod.PIX && !pixQrCode)}
              className="w-full bg-green-600 text-white py-4 rounded-2xl font-black uppercase shadow-xl hover:bg-green-700 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? 'Processando...' : `Confirmar Baixa (${paymentMethod})`}
            </button>
            <button 
              onClick={() => setSelectedGroup(null)} 
              className="w-full mt-3 text-[10px] font-bold text-gray-400 uppercase py-1"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FiadoView;
