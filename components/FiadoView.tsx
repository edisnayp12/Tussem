import React, { useState, useMemo, useEffect } from 'react';
import { Sale, PaymentMethod, AppSettings, Product, SaleItem, Customer } from '../types';
import { QRCodeSVG } from 'qrcode.react';
import { generateStaticPix } from '../services/pix';
import { normalizePhone, formatPhone, getWhatsAppLink } from '../utils/phoneUtils';

interface FiadoViewProps {
  fiados: Sale[];
  allSales?: Sale[];
  customers?: Customer[];
  products?: Product[];
  settings: AppSettings;
  onPayDebt: (pedidoId: string, method: PaymentMethod) => Promise<void>;
  onUpdateFiadoCustomer?: (saleIds: string[], nome: string, telefone?: string) => Promise<void>;
  onAddFiadoSale?: (sale: any) => Promise<void>;
  onNavigateToPDV?: () => void;
  onLogBatchDispatch?: (count: number, total: number) => Promise<void>;
}

export interface FiadoGroup {
  key: string;
  nome: string;
  total: number;
  sales: Sale[];
  telefone?: string;
  isConcluded?: boolean;
}

const FiadoView: React.FC<FiadoViewProps> = ({ 
  fiados, 
  allSales = [],
  customers = [],
  products = [], 
  settings, 
  onPayDebt, 
  onUpdateFiadoCustomer,
  onAddFiadoSale,
  onNavigateToPDV,
  onLogBatchDispatch
}) => {
  // Aba Principal: 'pendentes' (Em Aberto) vs 'concluidos' (Vendas de Fiado Já Concluídas)
  const [activeTab, setActiveTab] = useState<'pendentes' | 'concluidos'>('pendentes');
  
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<FiadoGroup | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pixQrCode, setPixQrCode] = useState<string | null>(null);

  // Estados para Modal de Edição / Inserção de Nome e Telefone (Pendentes ou Concluídas)
  const [editingGroup, setEditingGroup] = useState<FiadoGroup | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Estados para Modal de Incluir Novo Pedido no Fiado
  const [isAddSaleOpen, setIsAddSaleOpen] = useState(false);
  const [customerSelectionMode, setCustomerSelectionMode] = useState<'cadastrado' | 'novo'>('cadastrado');
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<{ nome: string; telefone: string; debt?: number } | null>(null);
  
  const [newSaleCustomerName, setNewSaleCustomerName] = useState('');
  const [newSaleCustomerPhone, setNewSaleCustomerPhone] = useState('');
  const [quickCart, setQuickCart] = useState<SaleItem[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('todos');
  const [isSubmittingSale, setIsSubmittingSale] = useState(false);
  const [overdueFilter, setOverdueFilter] = useState<'todos' | '7dias' | '15dias' | '30dias'>('todos');
  const [aiLoadingKey, setAiLoadingKey] = useState<string | null>(null);

  // ==============================================================
  // ESTADOS DO MODAL DE DISPARO DE COBRANÇA EM MASSA (TODOS DE UMA VEZ)
  // ==============================================================
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [batchTemplateType, setBatchTemplateType] = useState<'amigavel' | 'direto' | 'detalhado' | 'custom'>('amigavel');
  const [customTemplateText, setCustomTemplateText] = useState('');
  const [sentClientKeys, setSentClientKeys] = useState<Set<string>>(new Set());
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
  const [batchTab, setBatchTab] = useState<'fila' | 'lista'>('fila');
  const [isAutoTimerRunning, setIsAutoTimerRunning] = useState(false);
  const [timerSecondsLeft, setTimerSecondsLeft] = useState(3);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [showMissingPhonesList, setShowMissingPhonesList] = useState(false);

  // ==============================================================
  // 1. AGRUPAMENTO DOS FIADOS PENDENTES (EM ABERTO)
  // ==============================================================
  const groupedFiados = useMemo(() => {
    let filtered = fiados;
    const term = searchTerm.trim().toLowerCase();
    const cleanSearchTerm = term.replace(/\D/g, '');

    if (term && activeTab === 'pendentes') {
      filtered = fiados.filter(f => {
        const nameMatch = f.cliente_nome?.toLowerCase().includes(term);
        const normPhone = normalizePhone(f.telefone_comprador);
        const phoneMatch = f.telefone_comprador?.includes(term) || (cleanSearchTerm && normPhone.includes(cleanSearchTerm));
        return nameMatch || phoneMatch;
      });
    }
    
    const grouped: Record<string, FiadoGroup> = {};
    
    filtered.forEach(f => {
      const normPhone = normalizePhone(f.telefone_comprador || (f as any).telefone_limpo);
      const rawNome = f.cliente_nome?.trim();
      const nome = rawNome && rawNome.length > 0 ? rawNome : 'Sem Nome';
      
      const groupKey = normPhone.length >= 8 
        ? `tel_${normPhone}` 
        : (nome !== 'Sem Nome' ? `nome_${nome.toLowerCase()}` : `sem_nome_${f.id}`);

      if (!grouped[groupKey]) {
        grouped[groupKey] = {
          key: groupKey,
          nome: nome,
          total: 0,
          sales: [],
          telefone: normPhone ? formatPhone(normPhone) : (f.telefone_comprador || ''),
          isConcluded: false
        };
      } else {
        if (nome && nome !== 'Sem Nome' && (grouped[groupKey].nome === 'Sem Nome' || nome.length > grouped[groupKey].nome.length)) {
          grouped[groupKey].nome = nome;
        }
        if (!grouped[groupKey].telefone && (normPhone || f.telefone_comprador)) {
          grouped[groupKey].telefone = normPhone ? formatPhone(normPhone) : f.telefone_comprador;
        }
      }

      grouped[groupKey].sales.push(f);
      grouped[groupKey].total += (Number(f.valor_total) || 0);
    });
    
    let result = Object.values(grouped).sort((a,b) => a.nome.localeCompare(b.nome));

    if (overdueFilter !== 'todos') {
      const now = Date.now();
      const minDays = overdueFilter === '7dias' ? 7 : (overdueFilter === '15dias' ? 15 : 30);
      result = result.filter(g => {
        const oldestSaleTime = Math.min(...g.sales.map(s => new Date(s.created_at).getTime()));
        const days = (now - oldestSaleTime) / (1000 * 60 * 60 * 24);
        return days >= minDays;
      });
    }

    return result;
  }, [fiados, searchTerm, overdueFilter, activeTab]);

  // ==============================================================
  // 2. VENDAS DE FIADO JÁ CONCLUÍDAS / QUITADAS (HISTÓRICO PAGO)
  // ==============================================================
  const concludedFiadoSales = useMemo(() => {
    return allSales.filter(sale => 
      sale.status === 'pago' && 
      (
        sale.forma_pagamento === PaymentMethod.FIADO || 
        (sale as any).pago_com || 
        (sale as any).forma_pagamento_original === PaymentMethod.FIADO ||
        (sale.tipo_pedido === 'reserva' && (sale as any).forma_pagamento_original === PaymentMethod.FIADO)
      )
    );
  }, [allSales]);

  const groupedConcludedFiados = useMemo(() => {
    let filtered = concludedFiadoSales;
    const term = searchTerm.trim().toLowerCase();
    const cleanSearchTerm = term.replace(/\D/g, '');

    if (term && activeTab === 'concluidos') {
      filtered = concludedFiadoSales.filter(f => {
        const nameMatch = f.cliente_nome?.toLowerCase().includes(term);
        const normPhone = normalizePhone(f.telefone_comprador);
        const phoneMatch = f.telefone_comprador?.includes(term) || (cleanSearchTerm && normPhone.includes(cleanSearchTerm));
        return nameMatch || phoneMatch;
      });
    }

    const grouped: Record<string, FiadoGroup> = {};

    filtered.forEach(f => {
      const normPhone = normalizePhone(f.telefone_comprador || (f as any).telefone_limpo);
      const rawNome = f.cliente_nome?.trim();
      const nome = rawNome && rawNome.length > 0 ? rawNome : 'Sem Nome';
      
      const groupKey = normPhone.length >= 8 
        ? `tel_${normPhone}` 
        : (nome !== 'Sem Nome' ? `nome_${nome.toLowerCase()}` : `concluido_${f.id}`);

      if (!grouped[groupKey]) {
        grouped[groupKey] = {
          key: groupKey,
          nome: nome,
          total: 0,
          sales: [],
          telefone: normPhone ? formatPhone(normPhone) : (f.telefone_comprador || ''),
          isConcluded: true
        };
      } else {
        if (nome && nome !== 'Sem Nome' && (grouped[groupKey].nome === 'Sem Nome' || nome.length > grouped[groupKey].nome.length)) {
          grouped[groupKey].nome = nome;
        }
        if (!grouped[groupKey].telefone && (normPhone || f.telefone_comprador)) {
          grouped[groupKey].telefone = normPhone ? formatPhone(normPhone) : f.telefone_comprador;
        }
      }

      grouped[groupKey].sales.push(f);
      grouped[groupKey].total += (Number(f.valor_total) || 0);
    });

    return Object.values(grouped).sort((a, b) => {
      const timeA = Math.max(...a.sales.map(s => new Date(s.created_at).getTime()));
      const timeB = Math.max(...b.sales.map(s => new Date(s.created_at).getTime()));
      return timeB - timeA;
    });
  }, [concludedFiadoSales, searchTerm, activeTab]);

  // Totais calculados
  const totalPendingFiltered = useMemo(() => {
    return groupedFiados.reduce((acc, g) => acc + g.total, 0);
  }, [groupedFiados]);

  const totalConcludedFiltered = useMemo(() => {
    return groupedConcludedFiados.reduce((acc, g) => acc + g.total, 0);
  }, [groupedConcludedFiados]);

  const missingContactCountPending = useMemo(() => {
    return groupedFiados.filter(g => !g.telefone || g.nome === 'Sem Nome').length;
  }, [groupedFiados]);

  const missingContactCountConcluded = useMemo(() => {
    return groupedConcludedFiados.filter(g => !g.telefone || g.nome === 'Sem Nome').length;
  }, [groupedConcludedFiados]);

  // ==============================================================
  // 3. DEVEDORES APTOS PARA DISPARO EM MASSA (COM WHATSAPP)
  // ==============================================================
  const eligibleBatchDebtors = useMemo(() => {
    return groupedFiados.filter(g => Boolean(g.telefone && g.telefone.replace(/\D/g, '').length >= 8));
  }, [groupedFiados]);

  const nonEligibleBatchDebtors = useMemo(() => {
    return groupedFiados.filter(g => !g.telefone || g.telefone.replace(/\D/g, '').length < 8);
  }, [groupedFiados]);

  const totalEligibleBatchDebt = useMemo(() => {
    return eligibleBatchDebtors.reduce((acc, g) => acc + g.total, 0);
  }, [eligibleBatchDebtors]);

  // ==============================================================
  // 4. MODELOS E CONSTRUTOR DE MENSAGENS DE DISPARO EM MASSA
  // ==============================================================
  const getBatchMessageText = (group: FiadoGroup) => {
    let rawTemplate = '';
    if (batchTemplateType === 'amigavel') {
      rawTemplate = `Olá {nome}! Tudo bem? Passando para lembrar da sua conta pendente na Cantina {cantina} no valor total de R$ {valor}.\n\nChave PIX: {pix}\nTitular: {titular}\n\nQualquer dúvida estamos à disposição. Muito obrigado e axé! 🙏`;
    } else if (batchTemplateType === 'direto') {
      rawTemplate = `Olá {nome}! Consta um saldo em aberto na Cantina {cantina} no valor de R$ {valor}. Para acerto via PIX: {pix} ({titular}). Agradecemos a preferência!`;
    } else if (batchTemplateType === 'detalhado') {
      rawTemplate = `Olá {nome}! Segue o resumo da sua conta pendente na Cantina {cantina} (R$ {valor}):\n{itens}\n\nChave PIX: {pix}\nTitular: {titular}\n\nPor favor, envie o comprovante após o pagamento. Muito obrigado!`;
    } else {
      rawTemplate = customTemplateText || `Olá {nome}! Sua conta na Cantina {cantina} está em R$ {valor}. Chave PIX: {pix}. Obrigado!`;
    }

    const total = group.total.toFixed(2).replace('.', ',');
    const itemsList = group.sales.flatMap(s => (s.itens || []).map(i => `- ${i.quantidade}x ${i.nome}`)).slice(0, 5).join('\n');
    const oldestSale = Math.min(...group.sales.map(s => new Date(s.created_at).getTime()));
    const days = Math.max(1, Math.floor((Date.now() - oldestSale) / (1000 * 60 * 60 * 24)));

    return rawTemplate
      .replace(/{nome}/g, group.nome)
      .replace(/{valor}/g, total)
      .replace(/{itens}/g, itemsList || '- Consumo no balcão')
      .replace(/{dias}/g, `${days}`)
      .replace(/{pix}/g, settings.pixChave || 'Consulte o caixa')
      .replace(/{titular}/g, settings.pixTitular || 'Cantina TUSEMM')
      .replace(/{cantina}/g, settings.cantinaName || 'TUSEMM');
  };

  const getBatchWhatsAppLink = (group: FiadoGroup) => {
    const rawDigits = group.telefone?.replace(/\D/g, '') || '';
    let cleanPhone = rawDigits;
    if (cleanPhone.length >= 12 && cleanPhone.startsWith('55')) {
      cleanPhone = cleanPhone.slice(2);
    }
    const msg = getBatchMessageText(group);
    return `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(msg)}`;
  };

  // Abrir Modal de Envio em Massa
  const openBatchModal = () => {
    setCurrentQueueIndex(0);
    setIsAutoTimerRunning(false);
    setTimerSecondsLeft(3);
    setSentClientKeys(new Set());
    setCopyFeedback(false);
    setIsBatchModalOpen(true);
  };

  // Disparo de um cliente na fila e avanço
  const handleDispatchCurrentInQueue = () => {
    const currentDebtor = eligibleBatchDebtors[currentQueueIndex];
    if (!currentDebtor) return;

    const link = getBatchWhatsAppLink(currentDebtor);
    window.open(link, '_blank');

    setSentClientKeys(prev => {
      const next = new Set(prev);
      next.add(currentDebtor.key);
      return next;
    });

    if (currentQueueIndex + 1 < eligibleBatchDebtors.length) {
      setCurrentQueueIndex(c => c + 1);
      setTimerSecondsLeft(3);
    } else {
      setIsAutoTimerRunning(false);
      if (onLogBatchDispatch) {
        onLogBatchDispatch(eligibleBatchDebtors.length, totalEligibleBatchDebt).catch(() => {});
      }
    }
  };

  const handleSkipCurrentInQueue = () => {
    if (currentQueueIndex + 1 < eligibleBatchDebtors.length) {
      setCurrentQueueIndex(c => c + 1);
      setTimerSecondsLeft(3);
    } else {
      setIsAutoTimerRunning(false);
    }
  };

  const handleDispatchSingleInList = (group: FiadoGroup) => {
    const link = getBatchWhatsAppLink(group);
    window.open(link, '_blank');
    setSentClientKeys(prev => {
      const next = new Set(prev);
      next.add(group.key);
      return next;
    });
  };

  // Temporizador automático para o disparo sequencial (evita bloqueio de popup)
  useEffect(() => {
    let interval: any = null;
    if (isBatchModalOpen && isAutoTimerRunning && eligibleBatchDebtors.length > 0) {
      if (currentQueueIndex >= eligibleBatchDebtors.length) {
        setIsAutoTimerRunning(false);
        return;
      }

      interval = setInterval(() => {
        setTimerSecondsLeft(prev => {
          if (prev <= 1) {
            handleDispatchCurrentInQueue();
            return 3;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setTimerSecondsLeft(3);
    }

    return () => clearInterval(interval);
  }, [isBatchModalOpen, isAutoTimerRunning, currentQueueIndex, eligibleBatchDebtors]);

  // Copiar todas as mensagens formatadas de uma única vez
  const handleCopyAllBatch = () => {
    if (eligibleBatchDebtors.length === 0) return;
    let fullText = `*COBRANÇAS EM MASSA - CANTINA ${settings.cantinaName || 'TUSEMM'}*\n`;
    fullText += `Data: ${new Date().toLocaleDateString('pt-BR')} | Total a receber: R$ ${totalEligibleBatchDebt.toFixed(2)}\n\n`;

    eligibleBatchDebtors.forEach((d, idx) => {
      const msg = getBatchMessageText(d);
      fullText += `━━━━━━━━━━━━━━━━━━━━━\n`;
      fullText += `📌 [${idx + 1}/${eligibleBatchDebtors.length}] ${d.nome} - Tel: ${d.telefone}\n`;
      fullText += `Valor: R$ ${d.total.toFixed(2)}\n`;
      fullText += `Mensagem:\n${msg}\n\n`;
    });

    navigator.clipboard.writeText(fullText).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 3000);
    }).catch(() => {
      alert("Não foi possível copiar automaticamente para a área de transferência.");
    });
  };

  // ==============================================================
  // 5. BASE DE CLIENTES JÁ CADASTRADOS (PARA NOVO PEDIDO)
  // ==============================================================
  const registeredCustomersList = useMemo(() => {
    const map = new Map<string, { nome: string; telefone: string; debt: number; totalOrders: number }>();

    customers.forEach(c => {
      const cleanPhone = normalizePhone(c.telefone || c.telefone_limpo);
      const key = cleanPhone || c.nome.toLowerCase().trim();
      if (!key) return;

      map.set(key, {
        nome: c.nome || 'Cliente',
        telefone: c.telefone ? formatPhone(c.telefone) : '',
        debt: Number(c.total_fiado_aberto) || 0,
        totalOrders: Number(c.total_pedidos) || 0
      });
    });

    groupedFiados.forEach(g => {
      const cleanPhone = normalizePhone(g.telefone);
      const key = cleanPhone || g.nome.toLowerCase().trim();
      const existing = map.get(key);

      if (existing) {
        existing.debt = g.total;
        if (!existing.telefone && g.telefone) existing.telefone = g.telefone;
      } else if (g.nome !== 'Sem Nome' || g.telefone) {
        map.set(key, {
          nome: g.nome,
          telefone: g.telefone || '',
          debt: g.total,
          totalOrders: g.sales.length
        });
      }
    });

    groupedConcludedFiados.forEach(g => {
      const cleanPhone = normalizePhone(g.telefone);
      const key = cleanPhone || g.nome.toLowerCase().trim();
      if (!map.has(key) && (g.nome !== 'Sem Nome' || g.telefone)) {
        map.set(key, {
          nome: g.nome,
          telefone: g.telefone || '',
          debt: 0,
          totalOrders: g.sales.length
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [customers, groupedFiados, groupedConcludedFiados]);

  // Filtro de clientes cadastrados no modal
  const filteredRegisteredCustomers = useMemo(() => {
    const term = customerSearchTerm.trim().toLowerCase();
    const cleanDigits = term.replace(/\D/g, '');
    if (!term) return registeredCustomersList.slice(0, 30);

    return registeredCustomersList.filter(c => {
      const nameMatch = c.nome.toLowerCase().includes(term);
      const phoneMatch = c.telefone.toLowerCase().includes(term) || (cleanDigits && c.telefone.replace(/\D/g, '').includes(cleanDigits));
      return nameMatch || phoneMatch;
    }).slice(0, 30);
  }, [registeredCustomersList, customerSearchTerm]);

  // Categorias de produtos disponíveis
  const productCategories = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => {
      if (p.categoria) set.add(p.categoria);
    });
    return ['todos', ...Array.from(set)];
  }, [products]);

  // Produtos filtrados para o modal de adicionar venda
  const filteredProducts = useMemo(() => {
    let list = products.filter(p => p.ativo !== false);
    if (selectedCategory !== 'todos') {
      list = list.filter(p => p.categoria === selectedCategory);
    }
    const term = productSearch.trim().toLowerCase();
    if (term) {
      list = list.filter(p => p.nome.toLowerCase().includes(term) || p.codigo?.toLowerCase().includes(term));
    }
    return list.slice(0, 24);
  }, [products, selectedCategory, productSearch]);

  const quickCartTotal = useMemo(() => {
    return quickCart.reduce((sum, item) => sum + (item.subtotal || 0), 0);
  }, [quickCart]);

  // Handle Pix Generation no modal de quitação
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

  // Realizar quitação
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

  // Modal: Editar / Inserir Telefone
  const openEditModal = (group: FiadoGroup, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingGroup(group);
    setEditName(group.nome === 'Sem Nome' ? '' : group.nome);
    setEditPhone(formatPhone(group.telefone || ''));
    setSaveSuccessMsg(null);
  };

  const handleSaveCustomer = async () => {
    if (!editingGroup || !onUpdateFiadoCustomer) return;
    setIsSavingCustomer(true);
    try {
      const saleIds = editingGroup.sales.map(s => s.id);
      const cleanPhoneDigits = editPhone.replace(/\D/g, '');
      const formattedPhoneToSave = cleanPhoneDigits ? formatPhone(cleanPhoneDigits) : '';
      const finalName = editName.trim() || 'Sem Nome';

      await onUpdateFiadoCustomer(saleIds, finalName, formattedPhoneToSave);
      
      setSaveSuccessMsg("Telefone e dados salvos com sucesso!");
      setTimeout(() => {
        setEditingGroup(null);
        setSaveSuccessMsg(null);
        if (selectedGroup && selectedGroup.key === editingGroup.key) {
          setSelectedGroup(prev => prev ? {
            ...prev,
            nome: finalName,
            telefone: formattedPhoneToSave
          } : null);
        }
      }, 700);
    } catch (err: any) {
      alert("Erro ao atualizar telefone: " + (err.message || "Tente novamente"));
    } finally {
      setIsSavingCustomer(false);
    }
  };

  // Modal: Incluir Novo Pedido no Fiado
  const openAddSaleModal = (preselected?: { nome: string; telefone?: string; debt?: number }, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setQuickCart([]);
    setProductSearch('');
    setSelectedCategory('todos');
    setCustomerSearchTerm('');

    if (preselected) {
      setSelectedCustomer({
        nome: preselected.nome === 'Sem Nome' ? '' : preselected.nome,
        telefone: formatPhone(preselected.telefone || ''),
        debt: preselected.debt || 0
      });
      setNewSaleCustomerName(preselected.nome === 'Sem Nome' ? '' : preselected.nome);
      setNewSaleCustomerPhone(formatPhone(preselected.telefone || ''));
      setCustomerSelectionMode('cadastrado');
    } else {
      setSelectedCustomer(null);
      setNewSaleCustomerName('');
      setNewSaleCustomerPhone('');
      setCustomerSelectionMode('cadastrado');
    }

    setIsAddSaleOpen(true);
  };

  const handleSelectRegisteredCustomer = (cust: { nome: string; telefone: string; debt: number }) => {
    setSelectedCustomer(cust);
    setNewSaleCustomerName(cust.nome);
    setNewSaleCustomerPhone(cust.telefone);
  };

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

  const handleConfirmFiadoSale = async () => {
    if (quickCart.length === 0) {
      alert("Selecione pelo menos um produto para o pedido.");
      return;
    }
    const finalName = (newSaleCustomerName || selectedCustomer?.nome || '').trim();
    if (!finalName) {
      alert("Por favor, selecione um cliente cadastrado ou informe o nome do cliente.");
      return;
    }
    if (!onAddFiadoSale) {
      alert("Função de registrar venda não disponível.");
      return;
    }

    setIsSubmittingSale(true);
    try {
      const finalPhone = (newSaleCustomerPhone || selectedCustomer?.telefone || '').trim();

      await onAddFiadoSale({
        items: quickCart,
        total: quickCartTotal,
        paymentMethod: PaymentMethod.FIADO,
        customerName: finalName,
        telefone_comprador: finalPhone,
        isDebtPaid: false
      });

      setIsAddSaleOpen(false);
      setSelectedCustomer(null);
      setQuickCart([]);
      alert(`Novo pedido de R$ ${quickCartTotal.toFixed(2)} incluído no fiado de ${finalName} com sucesso!`);
    } catch (e: any) {
      alert("Erro ao adicionar pedido no fiado: " + (e.message || "Tente novamente"));
    } finally {
      setIsSubmittingSale(false);
    }
  };

  // WhatsApp para Cobrança Individual
  const generateWhatsAppLink = (group: FiadoGroup) => {
    const rawDigits = group.telefone?.replace(/\D/g, '') || '';
    if (!rawDigits) return '#';
    
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

  // WhatsApp de Comprovante de Quitação
  const generateConcludedReceiptWhatsAppLink = (group: FiadoGroup) => {
    const rawDigits = group.telefone?.replace(/\D/g, '') || '';
    if (!rawDigits) return '#';

    let cleanPhone = rawDigits;
    if (cleanPhone.length >= 12 && cleanPhone.startsWith('55')) {
      cleanPhone = cleanPhone.slice(2);
    }

    const total = group.total.toFixed(2).replace('.', ',');
    const lastSale = group.sales[0];
    const dataPagamento = lastSale ? new Date(lastSale.created_at).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR');

    const message = `Olá ${group.nome}! Confirmamos o recebimento e quitação do seu fiado na Cantina ${settings.cantinaName || 'TUSEMM'} no valor total de R$ ${total} em ${dataPagamento}.\n\nSua conta está em dia! Agradecemos pela preferência e confiança. Axé! 🙏`;

    return `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(message)}`;
  };

  const handleAICobrar = async (group: FiadoGroup) => {
    const rawDigits = group.telefone?.replace(/\D/g, '') || '';
    if (!rawDigits) return alert("Adicione um número de telefone ao cliente primeiro para enviar a cobrança.");
    
    setAiLoadingKey(group.key);
    try {
      const oldestSale = Math.min(...group.sales.map(s => new Date(s.created_at).getTime()));
      const days = Math.max(1, Math.floor((Date.now() - oldestSale) / (1000 * 60 * 60 * 24)));
      const itemsList = group.sales.flatMap(s => (s.itens || []).map(i => `${i.quantidade}x ${i.nome}`)).slice(0, 4).join(', ');

      const res = await fetch('/api/ai/draft-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName: group.nome,
          debtAmount: group.total,
          daysOverdue: `${days} dias`,
          items: itemsList,
          pixKey: settings.pixChave
        })
      });
      const data = await res.json();
      let cleanPhone = rawDigits;
      if (cleanPhone.length >= 12 && cleanPhone.startsWith('55')) {
        cleanPhone = cleanPhone.slice(2);
      }
      const msg = data.message || `Olá, ${group.nome}! Passando para lembrar da sua conta na Cantina TUSEMM no valor de R$ ${group.total.toFixed(2)}. Chave PIX: ${settings.pixChave || ''}. Axé! 🙏`;
      window.open(`https://wa.me/55${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
    } catch (e: any) {
      alert("Erro ao gerar mensagem de IA: " + e.message);
    } finally {
      setAiLoadingKey(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      
      {/* ============================================================== */}
      {/* HEADER BANNER                                                  */}
      {/* ============================================================== */}
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
              Gerencie contas em aberto, lance novos pedidos para clientes já cadastrados e dispare a cobrança de todos os fiados de uma única vez via WhatsApp.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* BOTÃO COBRAR TODOS DE UMA VEZ */}
            {activeTab === 'pendentes' && (
              <button
                onClick={openBatchModal}
                disabled={eligibleBatchDebtors.length === 0}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-black px-6 py-4 rounded-2xl text-xs uppercase tracking-wider shadow-lg flex items-center gap-2.5 transition-all active:scale-95 disabled:opacity-50"
                title="Cobrar todos os fiados pendentes de uma só vez no WhatsApp"
              >
                <i className="fa-brands fa-whatsapp text-lg"></i>
                Cobrar Todos ({eligibleBatchDebtors.length})
              </button>
            )}

            <button
              onClick={() => openAddSaleModal()}
              className="bg-purple-600 hover:bg-purple-500 text-white font-black px-6 py-4 rounded-2xl text-xs uppercase tracking-wider shadow-lg flex items-center gap-2.5 transition-all active:scale-95"
            >
              <i className="fa-solid fa-cart-plus text-sm"></i>
              + Novo Pedido Fiado
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6 pt-6 border-t border-white/10">
          <div className="bg-white/5 rounded-2xl p-4">
            <span className="text-[10px] font-black uppercase tracking-widest opacity-60 block">Em Aberto a Receber</span>
            <span className="text-xl md:text-2xl font-black text-amber-300">R$ {totalPendingFiltered.toFixed(2)}</span>
          </div>
          <div className="bg-white/5 rounded-2xl p-4">
            <span className="text-[10px] font-black uppercase tracking-widest opacity-60 block">Clientes em Aberto</span>
            <span className="text-xl md:text-2xl font-black text-white">{groupedFiados.length}</span>
          </div>
          <div className="bg-white/5 rounded-2xl p-4">
            <span className="text-[10px] font-black uppercase tracking-widest opacity-60 block">Total Já Quitado</span>
            <span className="text-xl md:text-2xl font-black text-emerald-400">R$ {totalConcludedFiltered.toFixed(2)}</span>
          </div>
          <div className="bg-white/5 rounded-2xl p-4">
            <span className="text-[10px] font-black uppercase tracking-widest opacity-60 block">
              {activeTab === 'pendentes' ? 'Sem WhatsApp (Abertos)' : 'Sem WhatsApp (Quitados)'}
            </span>
            <span className={`text-xl md:text-2xl font-black ${
              (activeTab === 'pendentes' ? missingContactCountPending : missingContactCountConcluded) > 0 
                ? 'text-rose-400' 
                : 'text-emerald-400'
            }`}>
              {activeTab === 'pendentes' ? missingContactCountPending : missingContactCountConcluded} clientes
            </span>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* BANNER DE DESTAQUE: DISPARO EM MASSA DE COBRANÇAS              */}
      {/* ============================================================== */}
      {activeTab === 'pendentes' && eligibleBatchDebtors.length > 0 && (
        <div className="bg-gradient-to-r from-emerald-950/90 via-purple-950/90 to-indigo-950/90 border border-emerald-500/30 p-5 rounded-[32px] flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl relative overflow-hidden">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500 text-emerald-950 flex items-center justify-center text-2xl font-black shadow-lg flex-shrink-0">
              <i className="fa-solid fa-bullhorn"></i>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-base font-black uppercase text-white tracking-tight">
                  Disparo em Massa de Cobrança WhatsApp
                </h4>
                <span className="bg-emerald-400 text-emerald-950 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full">
                  {eligibleBatchDebtors.length} clientes prontos
                </span>
              </div>
              <p className="text-xs text-emerald-200/90 font-bold mt-1">
                Envie a notificação de dívida de uma única vez para todos os <strong>{eligibleBatchDebtors.length} clientes</strong> com WhatsApp (total de <strong>R$ {totalEligibleBatchDebt.toFixed(2)}</strong>).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <button
              onClick={openBatchModal}
              className="w-full md:w-auto bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-black px-6 py-4 rounded-2xl text-xs uppercase tracking-wider shadow-xl flex items-center justify-center gap-2.5 transition-all active:scale-95"
            >
              <i className="fa-brands fa-whatsapp text-base"></i>
              Enviar Cobrança Para Todos
            </button>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* SELETOR DE ABAS: PENDENTES vs QUITADOS / CONCLUÍDOS            */}
      {/* ============================================================== */}
      <div className="flex bg-gray-100 dark:bg-[#1f1538] p-1.5 rounded-2xl max-w-md shadow-inner">
        <button
          onClick={() => setActiveTab('pendentes')}
          className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
            activeTab === 'pendentes'
              ? 'bg-purple-900 text-white shadow-md'
              : 'text-gray-500 dark:text-purple-300 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          <i className="fa-solid fa-clock-rotate-left"></i>
          <span>Em Aberto ({groupedFiados.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('concluidos')}
          className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
            activeTab === 'concluidos'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'text-gray-500 dark:text-purple-300 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          <i className="fa-solid fa-circle-check"></i>
          <span>Quitados / Concluídos ({groupedConcludedFiados.length})</span>
        </button>
      </div>

      {/* ============================================================== */}
      {/* BARRA DE BUSCA E FILTROS                                       */}
      {/* ============================================================== */}
      <div className="bg-white dark:bg-[#160e2b] p-5 rounded-3xl shadow-sm border border-gray-100 dark:border-purple-900/40 flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
        <div className="relative flex-1">
          <i className="fa-solid fa-search absolute left-5 top-1/2 -translate-y-1/2 text-gray-400"></i>
          <input
            type="text"
            placeholder={
              activeTab === 'pendentes' 
                ? "Buscar fiado em aberto por nome ou telefone..." 
                : "Buscar fiado concluído/quitado por nome ou telefone..."
            }
            className="w-full bg-gray-50 dark:bg-[#20143a] border border-transparent focus:border-purple-600 rounded-2xl pl-12 pr-6 py-4 text-sm font-bold text-gray-900 dark:text-white outline-none placeholder-gray-400"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Filtro de Vencimento (apenas para pendentes) */}
        {activeTab === 'pendentes' && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 flex-shrink-0">
            <span className="text-[9px] font-black uppercase text-gray-400 dark:text-purple-300 mr-1 hidden sm:inline">Tempo:</span>
            {[
              { id: 'todos', label: 'Todos' },
              { id: '7dias', label: '> 7 dias' },
              { id: '15dias', label: '> 15 dias' },
              { id: '30dias', label: '⚠️ > 30 dias' },
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setOverdueFilter(f.id as any)}
                className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase whitespace-nowrap transition-all ${
                  overdueFilter === f.id
                    ? 'bg-purple-900 text-white shadow-md'
                    : 'bg-gray-100 dark:bg-[#20143a] hover:bg-gray-200 dark:hover:bg-purple-900/40 text-gray-700 dark:text-purple-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {searchTerm.trim() && (
          <div className="bg-purple-50 dark:bg-purple-950/60 text-purple-900 dark:text-purple-200 px-6 py-3 rounded-2xl flex items-center justify-between md:justify-end gap-3 whitespace-nowrap">
            <span className="text-[10px] font-black uppercase tracking-widest opacity-70">Resultado busca:</span>
            <span className="text-base font-black">
              R$ {(activeTab === 'pendentes' ? totalPendingFiltered : totalConcludedFiltered).toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* ABA 1: LISTA DE FIADOS PENDENTES (EM ABERTO)                   */}
      {/* ============================================================== */}
      {activeTab === 'pendentes' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {groupedFiados.map(group => {
            const hasPhone = Boolean(group.telefone && group.telefone.replace(/\D/g, '').length >= 8);
            const isSemNome = group.nome === 'Sem Nome';

            return (
              <div 
                key={group.key}
                className="bg-white dark:bg-[#160e2b] p-6 rounded-3xl shadow-sm border border-gray-100 dark:border-purple-900/40 hover:border-purple-300 dark:hover:border-purple-600 hover:shadow-md transition-all flex flex-col justify-between relative group overflow-hidden"
              >
                {/* Top Card Bar */}
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1 pr-2">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-black text-purple-950 dark:text-white uppercase text-lg leading-tight">
                        {group.nome}
                      </h3>
                      {isSemNome && (
                        <span className="bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[8px] font-black uppercase px-2 py-0.5 rounded-full">
                          Sem Nome
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      {group.sales.length} {group.sales.length === 1 ? 'compra pendente' : 'compras pendentes'}
                    </p>
                  </div>

                  <div className="bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 px-3.5 py-1.5 rounded-2xl font-black text-sm whitespace-nowrap border border-red-100 dark:border-red-900/40">
                    R$ {group.total.toFixed(2)}
                  </div>
                </div>

                {/* Informação de Contato / WhatsApp */}
                <div className="my-3 py-2 px-3 bg-gray-50 dark:bg-[#20143a] rounded-2xl flex items-center justify-between">
                  {hasPhone ? (
                    <div className="flex items-center gap-2 text-xs font-bold text-green-700 dark:text-green-400">
                      <i className="fa-brands fa-whatsapp text-green-600 dark:text-green-400 text-base"></i>
                      <span>{formatPhone(group.telefone || '')}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                      <i className="fa-solid fa-triangle-exclamation text-amber-500"></i>
                      <span>Sem WhatsApp cadastrado</span>
                    </div>
                  )}

                  <button
                    onClick={(e) => openEditModal(group, e)}
                    title="Editar ou incluir número de telefone"
                    className="bg-white dark:bg-purple-900/50 hover:bg-purple-50 dark:hover:bg-purple-800/60 text-purple-700 dark:text-purple-200 border border-purple-200 dark:border-purple-700 px-2.5 py-1 rounded-xl text-[9px] font-black uppercase tracking-wider flex items-center gap-1 shadow-xs transition-all active:scale-95"
                  >
                    <i className="fa-solid fa-pen-to-square"></i>
                    {hasPhone && !isSemNome ? 'Editar' : 'Completar Tel'}
                  </button>
                </div>

                {/* Botões de Ação do Card */}
                <div className="mt-4 pt-3 border-t border-gray-100 dark:border-purple-900/30 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => { setSelectedGroup(group); setPaymentMethod(PaymentMethod.CASH); }}
                      className="bg-green-600 hover:bg-green-700 text-white py-3 rounded-2xl text-[10px] font-black uppercase tracking-wider shadow-sm flex items-center justify-center gap-1.5 transition-all active:scale-95"
                    >
                      <i className="fa-solid fa-check"></i>
                      Quitar Tudo
                    </button>

                    <button
                      onClick={(e) => openAddSaleModal({ nome: group.nome, telefone: group.telefone, debt: group.total }, e)}
                      title="Incluir novo pedido para este cliente cadastrado"
                      className="bg-purple-100 dark:bg-purple-950/80 hover:bg-purple-200 dark:hover:bg-purple-900 text-purple-900 dark:text-purple-200 py-3 rounded-2xl text-[10px] font-black uppercase tracking-wider shadow-sm flex items-center justify-center gap-1.5 transition-all active:scale-95 border border-purple-200 dark:border-purple-800"
                    >
                      <i className="fa-solid fa-cart-plus"></i>
                      + Pedido
                    </button>
                  </div>

                  {/* Botões de Cobrança WhatsApp e IA */}
                  {hasPhone ? (
                    <div className="grid grid-cols-2 gap-2">
                      <a
                        href={generateWhatsAppLink(group)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/60 py-2.5 rounded-2xl text-[9px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-xs"
                      >
                        <i className="fa-brands fa-whatsapp text-emerald-600 text-xs"></i>
                        Cobrar WhatsApp
                      </a>
                      <button
                        type="button"
                        onClick={() => handleAICobrar(group)}
                        disabled={aiLoadingKey === group.key}
                        className="bg-purple-50 dark:bg-purple-950/40 hover:bg-purple-100 text-purple-900 dark:text-purple-200 border border-purple-200 dark:border-purple-900/60 py-2.5 rounded-2xl text-[9px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-xs disabled:opacity-50"
                      >
                        {aiLoadingKey === group.key ? (
                          <i className="fa-solid fa-spinner animate-spin text-xs"></i>
                        ) : (
                          <i className="fa-solid fa-wand-magic-sparkles text-purple-600 text-xs"></i>
                        )}
                        Cobrança IA
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => openEditModal(group, e)}
                      className="w-full bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900/60 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-xs"
                    >
                      <i className="fa-brands fa-whatsapp text-amber-600 text-sm"></i>
                      Cadastrar Telefone p/ Cobrar
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {groupedFiados.length === 0 && (
            <div className="col-span-full text-center py-16 bg-white dark:bg-[#160e2b] rounded-[32px] border border-gray-100 dark:border-purple-900/40 shadow-sm">
              <div className="w-20 h-20 bg-green-50 dark:bg-green-950/50 text-green-600 rounded-full flex items-center justify-center text-4xl mx-auto mb-4">
                <i className="fa-solid fa-circle-check"></i>
              </div>
              <h4 className="text-lg font-black uppercase text-gray-800 dark:text-white mb-1">Nenhum Fiado Pendente</h4>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest max-w-sm mx-auto mb-6">
                Todos os clientes estão com suas contas quitadas e em dia!
              </p>
              <button
                onClick={() => openAddSaleModal()}
                className="bg-purple-900 text-white font-black px-6 py-4 rounded-2xl text-xs uppercase tracking-wider shadow-lg active:scale-95 transition-all inline-flex items-center gap-2"
              >
                <i className="fa-solid fa-plus"></i>
                Lançar Novo Fiado
              </button>
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* ABA 2: VENDAS DE FIADO JÁ CONCLUÍDAS / QUITADAS                 */}
      {/* ============================================================== */}
      {activeTab === 'concluidos' && (
        <div className="space-y-4">
          <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 p-4 rounded-3xl flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-black text-lg flex-shrink-0">
                <i className="fa-solid fa-receipt"></i>
              </div>
              <div>
                <h4 className="text-sm font-black uppercase text-emerald-950 dark:text-emerald-200">
                  Histórico de Vendas de Fiado Concluídas
                </h4>
                <p className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
                  Aqui você pode consultar todas as dívidas quitadas, <strong>inserir ou atualizar o número de telefone</strong> para envio de comprovantes e adicionar novos pedidos fiados para o mesmo cliente.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-emerald-900 dark:text-emerald-200 bg-white dark:bg-[#160e2b] px-4 py-2 rounded-2xl border border-emerald-200 dark:border-emerald-900/60">
                {groupedConcludedFiados.length} clientes quitados
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {groupedConcludedFiados.map(group => {
              const hasPhone = Boolean(group.telefone && group.telefone.replace(/\D/g, '').length >= 8);
              const lastSale = group.sales[0];
              const paidMethod = lastSale ? (lastSale.pago_com || lastSale.forma_pagamento || 'quitado') : 'quitado';

              return (
                <div 
                  key={group.key}
                  className="bg-white dark:bg-[#160e2b] p-6 rounded-3xl shadow-sm border border-emerald-100 dark:border-emerald-900/30 hover:border-emerald-300 hover:shadow-md transition-all flex flex-col justify-between relative group"
                >
                  <div>
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1 pr-2">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-black text-purple-950 dark:text-white uppercase text-lg leading-tight">
                            {group.nome}
                          </h3>
                          <span className="bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 text-[8px] font-black uppercase px-2 py-0.5 rounded-full flex items-center gap-1">
                            <i className="fa-solid fa-check"></i> Quitado
                          </span>
                        </div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                          {group.sales.length} {group.sales.length === 1 ? 'venda quitada' : 'vendas quitadas'}
                        </p>
                      </div>

                      <div className="bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 px-3.5 py-1.5 rounded-2xl font-black text-sm whitespace-nowrap border border-emerald-100 dark:border-emerald-900/40">
                        R$ {group.total.toFixed(2)}
                      </div>
                    </div>

                    <div className="my-3 py-2 px-3 bg-gray-50 dark:bg-[#20143a] rounded-2xl flex items-center justify-between">
                      {hasPhone ? (
                        <div className="flex items-center gap-2 text-xs font-bold text-green-700 dark:text-green-400 truncate pr-2">
                          <i className="fa-brands fa-whatsapp text-green-600 text-base flex-shrink-0"></i>
                          <span className="truncate">{formatPhone(group.telefone || '')}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-[10px] font-bold text-amber-700 dark:text-amber-400 truncate pr-2">
                          <i className="fa-solid fa-phone-slash text-amber-500 flex-shrink-0"></i>
                          <span>Sem telefone cadastrado</span>
                        </div>
                      )}

                      <button
                        onClick={(e) => openEditModal(group, e)}
                        title="Inserir ou editar número de telefone desta venda concluída"
                        className="bg-white dark:bg-purple-950/60 hover:bg-purple-50 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 px-2.5 py-1 rounded-xl text-[9px] font-black uppercase tracking-wider flex items-center gap-1 shadow-xs transition-all active:scale-95 flex-shrink-0"
                      >
                        <i className="fa-solid fa-phone"></i>
                        {hasPhone ? 'Editar Tel' : 'Inserir Tel'}
                      </button>
                    </div>

                    <div className="bg-gray-50 dark:bg-[#20143a] p-3 rounded-2xl text-xs space-y-1 mb-3 max-h-24 overflow-y-auto">
                      <span className="text-[9px] font-black uppercase text-gray-400 block mb-1">
                        Últimos itens quitados:
                      </span>
                      {group.sales.flatMap(s => s.itens || []).slice(0, 4).map((it, idx) => (
                        <div key={idx} className="flex justify-between items-center text-[11px] font-bold text-gray-700 dark:text-gray-300">
                          <span className="truncate pr-2">{it.quantidade}x {it.nome}</span>
                          <span className="text-gray-900 dark:text-white font-black">R$ {((it.preco_unitario || 0) * it.quantidade).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-gray-100 dark:border-purple-900/30 space-y-2">
                    <div className="flex items-center justify-between text-[10px] font-bold text-gray-500 mb-1">
                      <span>Baixa: {paidMethod.toUpperCase()}</span>
                      <span>{lastSale ? new Date(lastSale.created_at).toLocaleDateString() : ''}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={(e) => openAddSaleModal({ nome: group.nome, telefone: group.telefone, debt: 0 }, e)}
                        title="Cliente já cadastrado voltou: lançar novo pedido fiado"
                        className="bg-purple-900 hover:bg-purple-800 text-white py-2.5 rounded-2xl text-[9px] font-black uppercase tracking-wider shadow-sm flex items-center justify-center gap-1.5 transition-all active:scale-95"
                      >
                        <i className="fa-solid fa-cart-plus"></i>
                        + Novo Pedido
                      </button>

                      {hasPhone ? (
                        <a
                          href={generateConcludedReceiptWhatsAppLink(group)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/60 py-2.5 rounded-2xl text-[9px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-xs"
                        >
                          <i className="fa-brands fa-whatsapp text-emerald-600 text-xs"></i>
                          Recibo WhatsApp
                        </a>
                      ) : (
                        <button
                          onClick={(e) => openEditModal(group, e)}
                          className="bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900/60 py-2.5 rounded-2xl text-[9px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-xs"
                        >
                          <i className="fa-solid fa-plus"></i>
                          Inserir Telefone
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {groupedConcludedFiados.length === 0 && (
              <div className="col-span-full text-center py-16 bg-white dark:bg-[#160e2b] rounded-[32px] border border-gray-100 dark:border-purple-900/40 shadow-sm">
                <div className="w-16 h-16 bg-gray-100 dark:bg-purple-950/60 text-gray-400 rounded-full flex items-center justify-center text-3xl mx-auto mb-3">
                  <i className="fa-solid fa-receipt"></i>
                </div>
                <h4 className="text-base font-black uppercase text-gray-800 dark:text-white mb-1">
                  Nenhum Fiado Quitado Encontrado
                </h4>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest max-w-sm mx-auto">
                  Assim que dívidas fiadas forem quitadas, elas aparecerão aqui permitindo inserir telefones e emitir recibos.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL NOVO: DISPARO EM MASSA DE COBRANÇAS (TODOS DE UMA VEZ)  */}
      {/* ============================================================== */}
      {isBatchModalOpen && (
        <div 
          className="fixed inset-0 bg-black/80 z-[130] flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm overflow-y-auto animate-in fade-in"
          onClick={() => setIsBatchModalOpen(false)}
        >
          <div 
            className="bg-white dark:bg-[#160e2b] rounded-[36px] sm:rounded-[44px] p-6 sm:p-8 w-full max-w-3xl shadow-2xl my-auto animate-in zoom-in-95 border border-purple-100 dark:border-purple-900/40 max-h-[92vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex justify-between items-start pb-4 border-b border-gray-100 dark:border-purple-900/30">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500 text-emerald-950 flex items-center justify-center text-2xl font-black shadow-lg">
                  <i className="fa-brands fa-whatsapp"></i>
                </div>
                <div>
                  <h3 className="text-xl sm:text-2xl font-black text-purple-950 dark:text-white uppercase tracking-tight">
                    Disparo em Massa de Cobrança
                  </h3>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-0.5">
                    Notifique todos os devedores no WhatsApp com 1 clique de forma inteligente
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsBatchModalOpen(false)}
                className="w-10 h-10 bg-gray-100 dark:bg-purple-950/60 hover:bg-gray-200 text-gray-500 rounded-full flex items-center justify-center transition-all"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="overflow-y-auto py-4 flex-1 space-y-5 pr-1">
              
              {/* Resumo de Devedores */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-emerald-50 dark:bg-emerald-950/60 p-3.5 rounded-2xl border border-emerald-200 dark:border-emerald-900/40">
                  <span className="text-[9px] font-black uppercase text-emerald-700 dark:text-emerald-300 block tracking-wider">Aptos p/ Envio</span>
                  <span className="text-xl font-black text-emerald-700 dark:text-emerald-300">{eligibleBatchDebtors.length} clientes</span>
                </div>
                <div className="bg-red-50 dark:bg-red-950/60 p-3.5 rounded-2xl border border-red-200 dark:border-red-900/40">
                  <span className="text-[9px] font-black uppercase text-red-600 dark:text-red-400 block tracking-wider">Total a Cobrar</span>
                  <span className="text-xl font-black text-red-600 dark:text-red-400">R$ {totalEligibleBatchDebt.toFixed(2)}</span>
                </div>
                <div className="bg-purple-50 dark:bg-purple-950/60 p-3.5 rounded-2xl border border-purple-200 dark:border-purple-900/40">
                  <span className="text-[9px] font-black uppercase text-purple-700 dark:text-purple-300 block tracking-wider">Disparados</span>
                  <span className="text-xl font-black text-purple-900 dark:text-purple-200">{sentClientKeys.size} de {eligibleBatchDebtors.length}</span>
                </div>
                <div className="bg-amber-50 dark:bg-amber-950/60 p-3.5 rounded-2xl border border-amber-200 dark:border-amber-900/40">
                  <span className="text-[9px] font-black uppercase text-amber-700 dark:text-amber-300 block tracking-wider">Sem Telefone</span>
                  <span className="text-xl font-black text-amber-700 dark:text-amber-300">{nonEligibleBatchDebtors.length} clientes</span>
                </div>
              </div>

              {/* Seletor de Modelo de Mensagem */}
              <div className="bg-gray-50 dark:bg-[#20143a] p-4 rounded-3xl border border-gray-100 dark:border-purple-900/30 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="text-[10px] font-black uppercase text-purple-900 dark:text-purple-300 tracking-wider">
                    Modelo de Mensagem a Ser Enviada:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { id: 'amigavel', label: 'Amigável (Padrão PIX)' },
                      { id: 'direto', label: 'Direto & Rápido' },
                      { id: 'detalhado', label: 'Com Itens' },
                      { id: 'custom', label: 'Personalizado' },
                    ].map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setBatchTemplateType(t.id as any)}
                        className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase transition-all ${
                          batchTemplateType === t.id
                            ? 'bg-purple-900 text-white shadow-xs'
                            : 'bg-white dark:bg-purple-950 text-gray-600 dark:text-purple-300'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {batchTemplateType === 'custom' && (
                  <div>
                    <textarea
                      rows={3}
                      value={customTemplateText}
                      onChange={e => setCustomTemplateText(e.target.value)}
                      placeholder="Olá {nome}! Sua conta na Cantina {cantina} está em R$ {valor}. Chave PIX: {pix}..."
                      className="w-full bg-white dark:bg-[#160e2b] border border-gray-200 dark:border-purple-900 rounded-2xl p-3 text-xs font-bold text-purple-950 dark:text-white outline-none focus:border-purple-600"
                    />
                    <p className="text-[9px] font-bold text-gray-400 mt-1">
                      Tags disponíveis: <code className="text-purple-600">{`{nome}`}</code>, <code className="text-purple-600">{`{valor}`}</code>, <code className="text-purple-600">{`{pix}`}</code>, <code className="text-purple-600">{`{titular}`}</code>, <code className="text-purple-600">{`{cantina}`}</code>, <code className="text-purple-600">{`{itens}`}</code>, <code className="text-purple-600">{`{dias}`}</code>.
                    </p>
                  </div>
                )}

                {/* Prévia da Mensagem (para o 1º devedor da fila) */}
                {eligibleBatchDebtors[0] && (
                  <div className="bg-white dark:bg-[#160e2b] p-3.5 rounded-2xl border border-gray-200 dark:border-purple-900/50">
                    <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600 block mb-1">
                      Prévia real (exemplo para {eligibleBatchDebtors[currentQueueIndex]?.nome || eligibleBatchDebtors[0].nome}):
                    </span>
                    <p className="text-xs text-gray-700 dark:text-gray-200 whitespace-pre-line font-medium leading-relaxed bg-gray-50 dark:bg-[#20143a] p-3 rounded-xl border border-gray-100 dark:border-purple-900/30">
                      {getBatchMessageText(eligibleBatchDebtors[currentQueueIndex] || eligibleBatchDebtors[0])}
                    </p>
                  </div>
                )}
              </div>

              {/* Alternador de Modo de Disparo: Fila Assistida vs Lista Completa */}
              <div className="flex bg-gray-100 dark:bg-purple-950/60 p-1 rounded-2xl max-w-sm">
                <button
                  type="button"
                  onClick={() => setBatchTab('fila')}
                  className={`flex-1 py-2 px-3 rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-1.5 transition-all ${
                    batchTab === 'fila' ? 'bg-purple-900 text-white shadow-xs' : 'text-gray-500 dark:text-purple-300'
                  }`}
                >
                  <i className="fa-solid fa-wand-magic-sparkles"></i>
                  Fila Inteligente
                </button>
                <button
                  type="button"
                  onClick={() => setBatchTab('lista')}
                  className={`flex-1 py-2 px-3 rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-1.5 transition-all ${
                    batchTab === 'lista' ? 'bg-purple-900 text-white shadow-xs' : 'text-gray-500 dark:text-purple-300'
                  }`}
                >
                  <i className="fa-solid fa-list-check"></i>
                  Lista com 1 Clique
                </button>
              </div>

              {/* ============================================================== */}
              {/* MODO 1: FILA INTELIGENTE DE DISPARO SEQUENCIAL (SEM BLOQUEIOS) */}
              {/* ============================================================== */}
              {batchTab === 'fila' && (
                <div className="space-y-4">
                  {/* Barra de Progresso Geral */}
                  <div>
                    <div className="flex justify-between items-center text-xs font-black text-gray-700 dark:text-purple-200 mb-1">
                      <span>Progresso do Disparo:</span>
                      <span className="text-purple-900 dark:text-amber-300">
                        {sentClientKeys.size} de {eligibleBatchDebtors.length} ({eligibleBatchDebtors.length > 0 ? Math.round((sentClientKeys.size / eligibleBatchDebtors.length) * 100) : 0}%)
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-purple-950 rounded-full h-3 overflow-hidden">
                      <div 
                        className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${eligibleBatchDebtors.length > 0 ? Math.min(100, (sentClientKeys.size / eligibleBatchDebtors.length) * 100) : 0}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Card do Cliente Atual da Vez */}
                  {currentQueueIndex < eligibleBatchDebtors.length ? (
                    (() => {
                      const current = eligibleBatchDebtors[currentQueueIndex];
                      const isSent = sentClientKeys.has(current.key);

                      return (
                        <div className="bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-[#20143a] dark:to-[#170e2b] p-6 rounded-3xl border-2 border-purple-200 dark:border-purple-800 space-y-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <span className="text-[10px] font-black uppercase text-purple-800 dark:text-purple-300 tracking-wider">
                                Cliente Atual da Fila ({currentQueueIndex + 1} de {eligibleBatchDebtors.length}):
                              </span>
                              <h4 className="text-xl font-black text-purple-950 dark:text-white uppercase mt-0.5">
                                {current.nome}
                              </h4>
                              <p className="text-xs font-bold text-green-700 dark:text-green-400 flex items-center gap-1.5 mt-0.5">
                                <i className="fa-brands fa-whatsapp text-sm"></i>
                                {formatPhone(current.telefone || '')}
                              </p>
                            </div>

                            <div className="text-right">
                              <span className="text-xl font-black text-red-600 dark:text-red-400 block">
                                R$ {current.total.toFixed(2)}
                              </span>
                              <span className="text-[9px] font-bold text-gray-500">
                                {current.sales.length} compra(s) pendente(s)
                              </span>
                            </div>
                          </div>

                          {/* Ações da Fila */}
                          <div className="pt-2 flex flex-col sm:flex-row gap-2">
                            <button
                              type="button"
                              onClick={handleDispatchCurrentInQueue}
                              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-wider shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all"
                            >
                              <i className="fa-brands fa-whatsapp text-base"></i>
                              <span>Abrir WhatsApp de {current.nome} e Avançar</span>
                            </button>

                            <button
                              type="button"
                              onClick={handleSkipCurrentInQueue}
                              className="px-5 py-4 rounded-2xl font-black text-xs uppercase bg-white dark:bg-purple-950 text-gray-600 dark:text-purple-300 border border-gray-200 dark:border-purple-800 hover:bg-gray-50"
                            >
                              Pular
                            </button>
                          </div>

                          {/* Temporizador Automático Opcional */}
                          <div className="flex items-center justify-between pt-2 border-t border-purple-200/60 dark:border-purple-900/40">
                            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-purple-900 dark:text-purple-200">
                              <input
                                type="checkbox"
                                checked={isAutoTimerRunning}
                                onChange={e => setIsAutoTimerRunning(e.target.checked)}
                                className="w-4 h-4 text-purple-600 rounded"
                              />
                              <span>Avanço automático contínuo (abre WhatsApp a cada 3s)</span>
                            </label>

                            {isAutoTimerRunning && (
                              <span className="text-xs font-black text-amber-600 dark:text-amber-400 animate-pulse">
                                Disparando em {timerSecondsLeft}s...
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    /* Fila Finalizada */
                    <div className="bg-emerald-50 dark:bg-emerald-950/60 p-8 rounded-3xl border border-emerald-200 dark:border-emerald-800 text-center space-y-3">
                      <div className="w-16 h-16 rounded-full bg-emerald-500 text-white flex items-center justify-center text-3xl mx-auto shadow-lg">
                        <i className="fa-solid fa-check"></i>
                      </div>
                      <h4 className="text-xl font-black uppercase text-emerald-950 dark:text-white">
                        Todos os {eligibleBatchDebtors.length} Clientes Notificados!
                      </h4>
                      <p className="text-xs font-bold text-emerald-800 dark:text-emerald-200 max-w-md mx-auto">
                        O lote de cobranças foi concluído com sucesso totalizando R$ {totalEligibleBatchDebt.toFixed(2)}.
                      </p>
                      <button
                        type="button"
                        onClick={() => setIsBatchModalOpen(false)}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-black px-6 py-3 rounded-2xl text-xs uppercase tracking-wider shadow-lg inline-block"
                      >
                        Concluir e Fechar
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ============================================================== */}
              {/* MODO 2: LISTA COMPLETA DE CLIENTES COM DISPARO DIRETO          */}
              {/* ============================================================== */}
              {batchTab === 'lista' && (
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-xs font-bold text-gray-500">
                    <span>Clique em cada cliente para disparar individualmente:</span>
                    <button
                      type="button"
                      onClick={() => setSentClientKeys(new Set(eligibleBatchDebtors.map(d => d.key)))}
                      className="text-[10px] uppercase font-black text-purple-600 hover:underline"
                    >
                      Marcar todos como enviados
                    </button>
                  </div>

                  <div className="max-h-64 overflow-y-auto space-y-2 border border-gray-100 dark:border-purple-900/40 rounded-2xl p-2 bg-gray-50/50 dark:bg-[#20143a]/50">
                    {eligibleBatchDebtors.map((group, idx) => {
                      const isSent = sentClientKeys.has(group.key);
                      return (
                        <div
                          key={group.key}
                          className="bg-white dark:bg-[#160e2b] p-3 rounded-xl border border-gray-100 dark:border-purple-900/30 flex items-center justify-between gap-3 hover:border-purple-300 transition-all"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-md bg-purple-100 dark:bg-purple-950 text-purple-900 dark:text-purple-200 text-[10px] font-black flex items-center justify-center flex-shrink-0">
                                {idx + 1}
                              </span>
                              <h5 className="font-black text-xs text-purple-950 dark:text-white uppercase truncate">
                                {group.nome}
                              </h5>
                            </div>
                            <div className="flex items-center gap-3 mt-0.5 text-[10px] font-bold text-gray-500 dark:text-gray-400">
                              <span>{formatPhone(group.telefone || '')}</span>
                              <span className="text-red-600 dark:text-red-400 font-black">R$ {group.total.toFixed(2)}</span>
                            </div>
                          </div>

                          <div>
                            {isSent ? (
                              <button
                                type="button"
                                onClick={() => handleDispatchSingleInList(group)}
                                className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase flex items-center gap-1.5"
                              >
                                <i className="fa-solid fa-check"></i> Reenviar
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleDispatchSingleInList(group)}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase flex items-center gap-1.5 shadow-sm active:scale-95"
                              >
                                <i className="fa-brands fa-whatsapp text-xs"></i> Enviar
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Ação de Copiar Todos os Textos Formatados */}
              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 bg-purple-50 dark:bg-purple-950/40 p-4 rounded-2xl border border-purple-100 dark:border-purple-900/40">
                <div>
                  <h5 className="font-black text-xs uppercase text-purple-950 dark:text-white">
                    Copiar Lista Consolidada de Cobranças
                  </h5>
                  <p className="text-[10px] font-bold text-gray-500 dark:text-purple-300">
                    Gera todas as mensagens personalizadas para colar em listas de transmissão ou WhatsApp Desktop.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyAllBatch}
                  className="bg-purple-900 hover:bg-purple-800 text-white px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 whitespace-nowrap active:scale-95 transition-all"
                >
                  <i className="fa-regular fa-copy"></i>
                  {copyFeedback ? '✓ Copiado com Sucesso!' : 'Copiar Todas'}
                </button>
              </div>

              {/* Seção: Clientes sem Telefone Cadastrado (Aviso) */}
              {nonEligibleBatchDebtors.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 p-4 rounded-2xl space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-black text-amber-800 dark:text-amber-300">
                      <i className="fa-solid fa-triangle-exclamation"></i>
                      <span>{nonEligibleBatchDebtors.length} cliente(s) em aberto sem WhatsApp cadastrado</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowMissingPhonesList(!showMissingPhonesList)}
                      className="text-[10px] font-black uppercase text-amber-900 dark:text-amber-200 underline"
                    >
                      {showMissingPhonesList ? 'Ocultar' : 'Ver Clientes'}
                    </button>
                  </div>

                  {showMissingPhonesList && (
                    <div className="space-y-1.5 pt-2 border-t border-amber-200 dark:border-amber-900/40">
                      {nonEligibleBatchDebtors.map(d => (
                        <div key={d.key} className="flex justify-between items-center text-xs">
                          <span className="font-bold text-gray-800 dark:text-white">{d.nome} (R$ {d.total.toFixed(2)})</span>
                          <button
                            type="button"
                            onClick={() => {
                              setIsBatchModalOpen(false);
                              openEditModal(d);
                            }}
                            className="bg-white dark:bg-[#160e2b] text-purple-900 dark:text-purple-300 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase border border-purple-200"
                          >
                            + Inserir Telefone
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="pt-4 border-t border-gray-100 dark:border-purple-900/30 flex justify-between items-center">
              <span className="text-[10px] font-bold text-gray-400">
                {sentClientKeys.size} de {eligibleBatchDebtors.length} cobranças abertas
              </span>
              <button
                onClick={() => setIsBatchModalOpen(false)}
                className="bg-gray-100 dark:bg-purple-950 text-gray-700 dark:text-purple-300 hover:bg-gray-200 px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 1: INSERIR / EDITAR TELEFONE E NOME (ABERTO OU QUITADO)  */}
      {/* ============================================================== */}
      {editingGroup && (
        <div 
          className="fixed inset-0 bg-black/80 z-[120] flex items-center justify-center p-4 backdrop-blur-sm overflow-y-auto animate-in fade-in"
          onClick={() => !isSavingCustomer && setEditingGroup(null)}
        >
          <div 
            className="bg-white dark:bg-[#160e2b] rounded-[40px] p-8 w-full max-w-md shadow-2xl my-auto animate-in zoom-in-95 border border-purple-100 dark:border-purple-900/40" 
            onClick={e => e.stopPropagation()}
          >
            <div className="text-center mb-6">
              <div className="w-14 h-14 bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 rounded-3xl flex items-center justify-center text-2xl mx-auto mb-3">
                <i className="fa-solid fa-phone-volume"></i>
              </div>
              <h3 className="text-xl font-black text-purple-950 dark:text-white uppercase tracking-tight">
                {editingGroup.isConcluded ? 'Inserir / Editar Telefone (Venda Quitada)' : 'Editar Dados do Fiado'}
              </h3>
              <p className="text-xs font-bold text-gray-500 dark:text-purple-300/70 mt-1">
                {editingGroup.isConcluded 
                  ? 'Adicione o WhatsApp deste cliente para registrar no histórico e poder enviar o comprovante.'
                  : 'Atualize o nome e o WhatsApp deste cliente para habilitar a cobrança automática.'}
              </p>
            </div>

            <div className="bg-purple-50 dark:bg-purple-950/60 p-4 rounded-2xl mb-5 border border-purple-100 dark:border-purple-900/40">
              <div className="flex justify-between items-center text-xs font-bold text-purple-900 dark:text-purple-200">
                <span>Vendas vinculadas:</span>
                <span className="font-black">{editingGroup.sales.length} venda(s)</span>
              </div>
              <div className="flex justify-between items-center text-xs font-bold text-purple-900 dark:text-purple-200 mt-1">
                <span>{editingGroup.isConcluded ? 'Total Quitado:' : 'Dívida pendente:'}</span>
                <span className={`font-black ${editingGroup.isConcluded ? 'text-emerald-600' : 'text-red-600'}`}>
                  R$ {editingGroup.total.toFixed(2)}
                </span>
              </div>
            </div>

            {saveSuccessMsg && (
              <div className="mb-4 bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 p-3 rounded-2xl text-xs font-black text-center flex items-center justify-center gap-2">
                <i className="fa-solid fa-circle-check"></i>
                {saveSuccessMsg}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase text-purple-900 dark:text-purple-300 tracking-wider mb-1 block pl-1">
                  Nome do Cliente
                </label>
                <input
                  type="text"
                  placeholder="Ex: João da Silva..."
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  disabled={isSavingCustomer}
                  className="w-full bg-gray-50 dark:bg-[#20143a] border border-gray-200 dark:border-purple-900 focus:border-purple-500 rounded-2xl px-5 py-3.5 font-bold uppercase text-xs text-purple-950 dark:text-white outline-none transition-all"
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-purple-900 dark:text-purple-300 tracking-wider mb-1 block pl-1">
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
                    className="w-full bg-gray-50 dark:bg-[#20143a] border border-gray-200 dark:border-purple-900 focus:border-purple-500 rounded-2xl pl-12 pr-4 py-3.5 font-bold text-xs text-purple-950 dark:text-white outline-none transition-all"
                  />
                </div>
                <p className="text-[9px] font-bold text-gray-400 mt-1 pl-1">
                  Necessário para abrir contato direto e comprovantes no WhatsApp.
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
                  <span>Salvando Telefone...</span>
                ) : (
                  <>
                    <i className="fa-solid fa-floppy-disk"></i>
                    Salvar Telefone no Fiado
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
      {/* MODAL 2: INCLUIR NOVO PEDIDO EM CLIENTES JÁ CADASTRADOS        */}
      {/* ============================================================== */}
      {isAddSaleOpen && (
        <div 
          className="fixed inset-0 bg-black/80 z-[120] flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm overflow-y-auto animate-in fade-in"
          onClick={() => !isSubmittingSale && setIsAddSaleOpen(false)}
        >
          <div 
            className="bg-white dark:bg-[#160e2b] rounded-[36px] sm:rounded-[40px] p-5 sm:p-8 w-full max-w-2xl shadow-2xl my-auto animate-in zoom-in-95 border border-purple-100 dark:border-purple-900/40 max-h-[92vh] flex flex-col" 
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center pb-4 border-b border-gray-100 dark:border-purple-900/30">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-900 text-white flex items-center justify-center text-lg font-black">
                  <i className="fa-solid fa-cart-plus"></i>
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-black text-purple-950 dark:text-white uppercase tracking-tight">
                    Incluir Pedido no Fiado
                  </h3>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    {selectedCustomer 
                      ? `Lançando pedido para: ${selectedCustomer.nome}` 
                      : 'Selecione um cliente já cadastrado ou informe um novo'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAddSaleOpen(false)}
                className="w-9 h-9 bg-gray-100 dark:bg-purple-950/60 hover:bg-gray-200 text-gray-500 rounded-full flex items-center justify-center transition-all"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="overflow-y-auto py-4 flex-1 space-y-4 pr-1">
              {selectedCustomer ? (
                <div className="bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 p-4 rounded-2xl flex items-center justify-between">
                  <div>
                    <span className="text-[9px] font-black uppercase tracking-widest text-purple-800 dark:text-purple-300 block">
                      Cliente Selecionado:
                    </span>
                    <h4 className="text-base font-black text-purple-950 dark:text-white uppercase">
                      {selectedCustomer.nome}
                    </h4>
                    <div className="flex items-center gap-3 mt-1 text-xs font-bold text-gray-600 dark:text-purple-200">
                      {selectedCustomer.telefone ? (
                        <span className="flex items-center gap-1 text-green-700 dark:text-green-400">
                          <i className="fa-brands fa-whatsapp"></i> {formatPhone(selectedCustomer.telefone)}
                        </span>
                      ) : (
                        <span className="text-amber-600 text-[11px]">Sem telefone cadastrado</span>
                      )}
                      {Number(selectedCustomer.debt) > 0 && (
                        <span className="bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 text-[10px] font-black uppercase px-2 py-0.5 rounded-md">
                          Dívida atual: R$ {selectedCustomer.debt?.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setSelectedCustomer(null);
                      setNewSaleCustomerName('');
                      setNewSaleCustomerPhone('');
                    }}
                    className="bg-white dark:bg-purple-900/60 hover:bg-purple-100 text-purple-900 dark:text-purple-200 border border-purple-200 dark:border-purple-700 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                  >
                    Trocar Cliente
                  </button>
                </div>
              ) : (
                <div className="bg-gray-50 dark:bg-[#20143a] p-4 rounded-3xl border border-gray-100 dark:border-purple-900/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase text-purple-900 dark:text-purple-300 tracking-wider">
                      Identificar Cliente do Fiado
                    </span>
                    <div className="flex bg-gray-200 dark:bg-purple-950 p-1 rounded-xl">
                      <button
                        type="button"
                        onClick={() => setCustomerSelectionMode('cadastrado')}
                        className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase transition-all ${
                          customerSelectionMode === 'cadastrado'
                            ? 'bg-purple-900 text-white shadow-xs'
                            : 'text-gray-500 dark:text-purple-300'
                        }`}
                      >
                        Clientes Cadastrados
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomerSelectionMode('novo')}
                        className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase transition-all ${
                          customerSelectionMode === 'novo'
                            ? 'bg-purple-900 text-white shadow-xs'
                            : 'text-gray-500 dark:text-purple-300'
                        }`}
                      >
                        Novo Cliente
                      </button>
                    </div>
                  </div>

                  {customerSelectionMode === 'cadastrado' ? (
                    <div>
                      <div className="relative mb-2">
                        <i className="fa-solid fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                        <input
                          type="text"
                          placeholder="Buscar cliente cadastrado por nome ou telefone..."
                          value={customerSearchTerm}
                          onChange={e => setCustomerSearchTerm(e.target.value)}
                          className="w-full bg-white dark:bg-[#160e2b] border border-gray-200 dark:border-purple-900 rounded-xl pl-9 pr-4 py-2.5 text-xs font-bold text-gray-900 dark:text-white outline-none focus:border-purple-500"
                        />
                      </div>

                      <div className="max-h-36 overflow-y-auto space-y-1.5 border border-gray-200 dark:border-purple-900/40 rounded-2xl p-2 bg-white dark:bg-[#160e2b]">
                        {filteredRegisteredCustomers.map((cust, idx) => (
                          <div
                            key={idx}
                            onClick={() => handleSelectRegisteredCustomer(cust)}
                            className="p-2 rounded-xl hover:bg-purple-50 dark:hover:bg-purple-900/40 cursor-pointer flex items-center justify-between transition-all border border-transparent hover:border-purple-200"
                          >
                            <div>
                              <p className="font-black text-xs text-purple-950 dark:text-white uppercase leading-tight">
                                {cust.nome}
                              </p>
                              <p className="text-[10px] font-bold text-gray-500 dark:text-purple-300">
                                {cust.telefone ? formatPhone(cust.telefone) : 'Sem WhatsApp'}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {cust.debt > 0 ? (
                                <span className="bg-red-50 text-red-600 text-[9px] font-black uppercase px-2 py-0.5 rounded-md">
                                  R$ {cust.debt.toFixed(2)}
                                </span>
                              ) : (
                                <span className="bg-emerald-50 text-emerald-700 text-[9px] font-black uppercase px-2 py-0.5 rounded-md">
                                  Em dia
                                </span>
                              )}
                              <span className="text-[9px] font-black uppercase bg-purple-100 text-purple-900 px-2 py-1 rounded-lg">
                                Escolher
                              </span>
                            </div>
                          </div>
                        ))}
                        {filteredRegisteredCustomers.length === 0 && (
                          <div className="text-center py-3 text-xs font-bold text-gray-400 uppercase">
                            Nenhum cliente cadastrado encontrado com esse termo.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="text-[8px] font-black uppercase text-purple-900 dark:text-purple-300 tracking-wider mb-1 block">
                          Nome do Novo Cliente
                        </label>
                        <input
                          type="text"
                          placeholder="Ex: Carlos Eduardo..."
                          value={newSaleCustomerName}
                          onChange={e => setNewSaleCustomerName(e.target.value)}
                          className="w-full bg-white dark:bg-[#160e2b] border border-gray-200 dark:border-purple-900 rounded-xl px-3 py-2 text-xs font-bold uppercase text-purple-950 dark:text-white outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="text-[8px] font-black uppercase text-purple-900 dark:text-purple-300 tracking-wider mb-1 block">
                          WhatsApp com DDD
                        </label>
                        <input
                          type="tel"
                          placeholder="(11) 99999-9999"
                          value={newSaleCustomerPhone}
                          onChange={e => setNewSaleCustomerPhone(formatPhone(e.target.value))}
                          className="w-full bg-white dark:bg-[#160e2b] border border-gray-200 dark:border-purple-900 rounded-xl px-3 py-2 text-xs font-bold text-purple-950 dark:text-white outline-none focus:border-purple-500"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Seletor de Produtos */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-black uppercase text-gray-700 dark:text-purple-200 tracking-wider">
                    Produtos para Adicionar ao Fiado
                  </span>
                  <span className="text-[9px] font-bold text-gray-400">
                    {quickCart.length} item(ns) selecionado(s)
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row gap-2 mb-2">
                  <div className="relative flex-1">
                    <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                    <input
                      type="text"
                      placeholder="Filtrar produtos..."
                      value={productSearch}
                      onChange={e => setProductSearch(e.target.value)}
                      className="w-full bg-gray-50 dark:bg-[#20143a] border border-gray-200 dark:border-purple-900 rounded-xl pl-9 pr-3 py-2 text-xs font-bold text-gray-900 dark:text-white outline-none focus:border-purple-500"
                    />
                  </div>

                  <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
                    {productCategories.slice(0, 6).map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-2.5 py-1.5 rounded-xl text-[9px] font-black uppercase whitespace-nowrap transition-all ${
                          selectedCategory === cat
                            ? 'bg-purple-900 text-white shadow-xs'
                            : 'bg-gray-100 dark:bg-purple-950 text-gray-600 dark:text-purple-300'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="max-h-48 overflow-y-auto space-y-1.5 border border-gray-100 dark:border-purple-900/30 rounded-2xl p-2 bg-gray-50/50 dark:bg-[#20143a]/50">
                  {filteredProducts.map(p => {
                    const inCart = quickCart.find(i => i.produto_id === p.id);
                    return (
                      <div
                        key={p.id}
                        className="bg-white dark:bg-[#160e2b] p-2.5 rounded-xl border border-gray-100 dark:border-purple-900/30 flex items-center justify-between text-xs hover:border-purple-300 transition-all"
                      >
                        <div className="flex-1 pr-2">
                          <p className="font-black text-gray-900 dark:text-white uppercase leading-tight">{p.nome}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] font-black text-purple-600 dark:text-amber-400">
                              R$ {Number(p.preco).toFixed(2)}
                            </span>
                            <span className="text-[9px] font-bold text-gray-400">
                              Estq: {p.estoque}
                            </span>
                          </div>
                        </div>
                        {inCart ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => updateQuickCartQty(p.id, -1)}
                              className="w-7 h-7 bg-gray-100 dark:bg-purple-950 rounded-lg font-black text-xs flex items-center justify-center hover:bg-gray-200 text-gray-700 dark:text-white"
                            >
                              -
                            </button>
                            <span className="font-black text-xs w-6 text-center text-purple-950 dark:text-white">
                              {inCart.quantidade}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateQuickCartQty(p.id, 1)}
                              className="w-7 h-7 bg-purple-100 dark:bg-purple-900 text-purple-900 dark:text-white rounded-lg font-black text-xs flex items-center justify-center hover:bg-purple-200"
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
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
                    <p className="text-center py-4 text-xs font-bold text-gray-400 uppercase">
                      Nenhum produto cadastrado com estoque disponível
                    </p>
                  )}
                </div>
              </div>

              {quickCart.length > 0 && (
                <div className="bg-amber-50/60 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-2xl p-3 space-y-2">
                  <span className="text-[9px] font-black uppercase text-amber-900 dark:text-amber-300 tracking-wider block">
                    Resumo do Novo Pedido:
                  </span>
                  <div className="space-y-1 max-h-24 overflow-y-auto">
                    {quickCart.map(item => (
                      <div key={item.produto_id} className="flex justify-between items-center text-xs">
                        <span className="font-bold text-gray-700 dark:text-gray-300 uppercase">
                          {item.quantidade}x {item.nome}
                        </span>
                        <span className="font-black text-gray-900 dark:text-white">
                          R$ {item.subtotal.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="pt-2 border-t border-amber-200/60 dark:border-amber-900/60 flex justify-between items-center text-sm font-black text-amber-950 dark:text-amber-200">
                    <span>Total deste Novo Pedido:</span>
                    <span>R$ {quickCartTotal.toFixed(2)}</span>
                  </div>

                  {selectedCustomer && Number(selectedCustomer.debt) > 0 && (
                    <div className="text-[10px] font-bold text-purple-900 dark:text-purple-300 pt-1 flex justify-between">
                      <span>Saldo anterior: R$ {selectedCustomer.debt.toFixed(2)} + Novo: R$ {quickCartTotal.toFixed(2)} =</span>
                      <span className="font-black text-red-600 dark:text-red-400">
                        Novo Total: R$ {(selectedCustomer.debt + quickCartTotal).toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-gray-100 dark:border-purple-900/30 space-y-2">
              <button
                onClick={handleConfirmFiadoSale}
                disabled={isSubmittingSale || quickCart.length === 0 || (!newSaleCustomerName.trim() && !selectedCustomer)}
                className="w-full bg-purple-900 hover:bg-purple-800 text-white py-4 rounded-2xl font-black uppercase text-xs tracking-wider shadow-xl active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmittingSale ? (
                  <span>Gravando Pedido no Fiado...</span>
                ) : (
                  <>
                    <i className="fa-solid fa-check"></i>
                    Confirmar Pedido Fiado (R$ {quickCartTotal.toFixed(2)})
                  </>
                )}
              </button>
              <button
                onClick={() => setIsAddSaleOpen(false)}
                disabled={isSubmittingSale}
                className="w-full py-2 text-xs font-black uppercase text-gray-400 hover:text-gray-600 transition-colors"
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
            className="bg-white dark:bg-[#160e2b] rounded-[40px] p-8 w-full max-w-sm shadow-2xl my-auto animate-in zoom-in-95 border border-purple-100 dark:border-purple-900/40" 
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-2xl font-black text-purple-950 dark:text-white uppercase text-center mb-1">
              Receber Fiado
            </h3>
            <p className="text-center text-xs font-bold text-gray-700 dark:text-purple-300 uppercase tracking-wider mb-1">
              {selectedGroup.nome}
            </p>

            {selectedGroup.telefone ? (
              <p className="text-center text-xs font-bold text-green-700 dark:text-green-400 flex items-center justify-center gap-1.5 mb-3">
                <i className="fa-brands fa-whatsapp text-green-600"></i>
                {formatPhone(selectedGroup.telefone)}
              </p>
            ) : (
              <p className="text-center text-[10px] font-bold text-amber-600 dark:text-amber-400 mb-3">
                Sem telefone cadastrado
              </p>
            )}

            <div className="flex justify-center gap-2 mb-4">
              <button
                onClick={(e) => openEditModal(selectedGroup, e)}
                className="bg-purple-50 dark:bg-purple-950/60 hover:bg-purple-100 text-purple-800 dark:text-purple-200 border border-purple-200 dark:border-purple-800 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider flex items-center gap-1 transition-all"
              >
                <i className="fa-solid fa-pen-to-square"></i>
                Editar Telefone
              </button>
              <button
                onClick={(e) => {
                  const grp = selectedGroup;
                  setSelectedGroup(null);
                  openAddSaleModal({ nome: grp.nome, telefone: grp.telefone, debt: grp.total }, e);
                }}
                className="bg-purple-50 dark:bg-purple-950/60 hover:bg-purple-100 text-purple-800 dark:text-purple-200 border border-purple-200 dark:border-purple-800 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider flex items-center gap-1 transition-all"
              >
                <i className="fa-solid fa-cart-plus"></i>
                + Pedido
              </button>
            </div>
            
            <div className="bg-gray-50 dark:bg-[#20143a] rounded-3xl p-4 mb-5 max-h-40 overflow-y-auto border border-gray-100 dark:border-purple-900/30">
              {selectedGroup.sales.map((sale) => (
                <div key={sale.id} className="mb-4 last:mb-0 border-b border-gray-200 dark:border-purple-900/30 last:border-0 pb-4 last:pb-0">
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
                    <span className="font-bold text-gray-700 dark:text-gray-300">R$ {sale.valor_total.toFixed(2)}</span>
                  </p>
                  <div className="space-y-1">
                    {sale.itens?.map((item, i) => (
                      <div key={i} className="flex justify-between items-center text-xs">
                        <span className="font-bold text-gray-700 dark:text-gray-300 uppercase">{item.quantidade}x {item.nome}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-red-50 dark:bg-red-950/50 p-5 rounded-3xl text-center mb-5 relative border border-red-100 dark:border-red-900/40">
              <p className="text-[9px] font-black text-red-400 uppercase">
                Total a Pagar ({selectedGroup.sales.length} compras)
              </p>
              <p className="text-3xl font-black text-red-600 dark:text-red-400">
                R$ {selectedGroup.total.toFixed(2)}
              </p>
              
              {selectedGroup.telefone ? (
                <div className="mt-3 flex justify-center">
                  <a 
                    href={generateWhatsAppLink(selectedGroup)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-white dark:bg-[#160e2b] text-gray-700 dark:text-gray-200 hover:bg-gray-50 border border-gray-200 dark:border-purple-800 px-4 py-2 rounded-xl text-[10px] font-black uppercase shadow-sm flex items-center gap-2 transition-all"
                  >
                    <i className="fa-brands fa-whatsapp text-green-500 text-sm"></i>
                    Cobrar no WhatsApp
                  </a>
                </div>
              ) : (
                <div className="mt-3 flex justify-center">
                  <button
                    onClick={(e) => openEditModal(selectedGroup, e)}
                    className="bg-white dark:bg-[#160e2b] text-purple-900 dark:text-purple-300 border border-purple-200 dark:border-purple-800 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase flex items-center gap-1.5 shadow-xs"
                  >
                    <i className="fa-solid fa-phone"></i>
                    Cadastrar Telefone para Cobrar
                  </button>
                </div>
              )}
            </div>
            
            {paymentMethod === PaymentMethod.PIX && pixQrCode && (
              <div className="bg-gray-100 dark:bg-white p-4 rounded-xl mb-5 flex flex-col items-center justify-center fade-in animate-in slide-in-from-top-2">
                <p className="text-[10px] font-black uppercase text-purple-900 mb-2">QR Code PIX</p>
                <QRCodeSVG value={pixQrCode} size={170} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 mb-5">
               {[PaymentMethod.PIX, PaymentMethod.CASH, PaymentMethod.DEBIT, PaymentMethod.CREDIT].map(m => (
                 <button 
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={`py-3 rounded-2xl text-[10px] font-black uppercase border-2 transition-all ${
                    paymentMethod === m 
                      ? 'bg-purple-900 border-purple-900 text-white shadow-lg' 
                      : 'bg-white dark:bg-[#20143a] text-gray-400 border-gray-100 dark:border-purple-900/30'
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
