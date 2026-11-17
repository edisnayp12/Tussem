import React, { useState, useMemo, useEffect } from 'react';
import { Product, SaleItem, PaymentMethod, Sale, AppSettings, Customer, User, UserRole } from '../types';
import { PDV_CATEGORIES } from '../constants';
import Scanner from './Scanner';
import { QRCodeSVG } from 'qrcode.react';
import { generateStaticPix } from '../services/pix';
import { normalizePhone, formatPhone } from '../utils/phoneUtils';
import { getSaleWhatsAppReceiptLink, printSaleThermalReceipt } from '../utils/receiptUtils';
import { playSuccessChime } from '../utils/soundUtils';
import { parseLocaleNumber, formatSafeDateTime } from '../utils/browserUtils';
import { useFeedback } from './FeedbackProvider';
import CashOutflowModal from './CashOutflowModal';

interface SalesViewProps {
  products: Product[];
  settings: AppSettings;
  fiados?: Sale[];
  customers?: Customer[];
  sales?: Sale[];
  currentUser?: User | null;
  hasOpenShift?: boolean;
  onCompleteSale: (sale: any) => Promise<Sale | void>;
  onUpdateSaleContact?: (saleId: string, telefone: string, cliente_nome?: string) => Promise<void>;
  onAddCashOutflow?: (data: { categoria: string; valor: number; motivo: string }) => Promise<void>;
  onOpenAdminPanel?: () => void;
}

const getCategoryIcon = (category: string, name: string): string => {
  const catLower = (category || '').toLowerCase();
  const nameLower = (name || '').toLowerCase();

  if (catLower.includes('combo') || nameLower.includes('combo')) return 'fa-boxes-stacked';
  if (catLower.includes('doce') || nameLower.includes('brigadeiro') || nameLower.includes('bolo')) return 'fa-cookie-bite';
  if (nameLower.includes('suco') || nameLower.includes('café') || nameLower.includes('cafe')) return 'fa-mug-hot';
  if (nameLower.includes('água') || nameLower.includes('agua')) return 'fa-bottle-water';
  if (catLower.includes('bebida') || catLower.includes('refrigerante') || catLower.includes('drink') || catLower.includes('cerveja')) {
    return 'fa-glass-water';
  }
  return 'fa-burger';
};

const matchesSelectedCategory = (productCategory: string, selectedCategory: string): boolean => {
  if (selectedCategory === 'Todos') return true;
  const prodCat = (productCategory || '').trim().toLowerCase();
  const sel = selectedCategory.trim().toLowerCase();

  if (prodCat === sel) return true;
  if (sel === 'salgados' && (prodCat === 'lanches' || prodCat === 'salgado')) return true;
  if (
    sel === 'bebidas' &&
    ['refrigerantes', 'bebida', 'café', 'café com leite', 'cerveja', 'drinks'].includes(prodCat)
  ) {
    return true;
  }
  if (sel === 'doces' && (prodCat === 'doce' || prodCat === 'sobremesas')) return true;
  if (sel === 'combos' && prodCat === 'combo') return true;
  return false;
};

const buildSimulatedPixPayload = (amount: number, cantinaName: string): string => {
  const cleanName = (cantinaName || 'CANTINA TUSEMM').slice(0, 20).toUpperCase();
  const ref = `TUSEMM${Date.now().toString().slice(-6)}`;
  return `00020126360014BR.GOV.BCB.PIX011400000000000000520400005303986540${amount.toFixed(2)}5802BR5915${cleanName}6009SAO PAULO62070503${ref}6304ABCD`;
};

const SalesView: React.FC<SalesViewProps> = ({
  products,
  settings,
  fiados = [],
  customers = [],
  sales = [],
  currentUser,
  hasOpenShift = false,
  onCompleteSale,
  onUpdateSaleContact,
  onAddCashOutflow,
  onOpenAdminPanel
}) => {
  const { showToast } = useFeedback();
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('Todos');
  const [justAddedId, setJustAddedId] = useState<string | null>(null);

  // Gaveta do Carrinho (Bottom Sheet) e Modal de Cobrança Rápida
  const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.PIX);
  const [cashReceivedInput, setCashReceivedInput] = useState<string>('');
  const [pixQrCode, setPixQrCode] = useState<string | null>(null);
  const [pixPaymentId, setPixPaymentId] = useState<string | null>(null);
  const [isPollingPix, setIsPollingPix] = useState(false);

  // Campos opcionais de Fiado
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerSearchFilter, setCustomerSearchFilter] = useState('');

  // Histórico Rápido & Último Comprovante (não bloqueante)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [lastCompletedReceipt, setLastCompletedReceipt] = useState<{
    sale: Sale;
    phone: string;
    phoneSaved?: boolean;
  } | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [isSavingReceiptPhone, setIsSavingReceiptPhone] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isOutflowModalOpen, setIsOutflowModalOpen] = useState(false);

  const isAdmin = currentUser?.perfil === UserRole.ADMIN || currentUser?.usuario === 'Tusemm';

  const cartItemCount = useMemo(
    () => cart.reduce((acc, item) => acc + (Number(item.quantidade) || 0), 0),
    [cart]
  );

  const cartTotal = useMemo(
    () => cart.reduce((acc, item) => acc + (Number(item.preco_unitario) || 0) * (Number(item.quantidade) || 0), 0),
    [cart]
  );

  const categoryChips = useMemo(() => {
    const base = [...PDV_CATEGORIES] as string[];
    products.forEach((p) => {
      if (!p.categoria) return;
      const alreadyCovered = base.some((c) => c !== 'Todos' && matchesSelectedCategory(p.categoria, c));
      if (!alreadyCovered && !base.includes(p.categoria)) {
        base.push(p.categoria);
      }
    });
    return base;
  }, [products]);

  const filteredProducts = useMemo(() => {
    const searchLower = searchTerm.trim().toLowerCase();
    return products.filter((p) => {
      if (p.ativo === false) return false;
      const productName = (p.nome || '').toLowerCase();
      const productCode = (p.codigo || p.codigo_barras || '').toLowerCase();
      const matchesSearch = !searchLower || productName.includes(searchLower) || productCode.includes(searchLower);
      const matchesCategory = matchesSelectedCategory(p.categoria, activeCategory);
      return matchesSearch && matchesCategory;
    });
  }, [products, searchTerm, activeCategory]);

  const addToCart = (product: Product) => {
    if ((Number(product.estoque) || 0) <= 0) {
      return;
    }

    const existing = cart.find((item) => item.produto_id === product.id);
    if (existing && existing.quantidade >= (Number(product.estoque) || 0)) {
      showToast(`Estoque máximo de "${product.nome}" atingido.`, 'warning');
      return;
    }

    setCart((prev) => {
      const prevExisting = prev.find((item) => item.produto_id === product.id);
      if (prevExisting) {
        return prev.map((item) =>
          item.produto_id === product.id
            ? {
                ...item,
                quantidade: item.quantidade + 1,
                subtotal: (item.quantidade + 1) * (Number(item.preco_unitario) || 0)
              }
            : item
        );
      }
      return [
        ...prev,
        {
          produto_id: product.id,
          nome: product.nome,
          preco_unitario: Number(product.preco) || 0,
          quantidade: 1,
          subtotal: Number(product.preco) || 0
        }
      ];
    });

    setJustAddedId(product.id);
    setTimeout(() => {
      setJustAddedId((curr) => (curr === product.id ? null : curr));
    }, 420);
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.produto_id !== productId));
  };

  const updateQuantity = (productId: string, delta: number) => {
    const product = products.find((p) => p.id === productId);
    const maxStock = Number(product?.estoque) || 0;

    setCart((prev) =>
      prev.flatMap((item) => {
        if (item.produto_id !== productId) return [item];
        const newQty = item.quantidade + delta;
        if (newQty <= 0) return [];
        if (newQty > maxStock) {
          showToast('Estoque máximo disponível atingido.', 'warning');
          return [item];
        }
        return [
          {
            ...item,
            quantidade: newQty,
            subtotal: newQty * (Number(item.preco_unitario) || 0)
          }
        ];
      })
    );
  };

  // Customers list for Fiado payment option
  const allAvailableCustomers = useMemo(() => {
    const map = new Map<string, { nome: string; telefone: string; hasFiado?: boolean }>();

    (fiados || []).forEach((f) => {
      const nome = f.cliente_nome?.trim() || '';
      const telefone = f.telefone_comprador?.trim() || '';
      if (nome && nome !== 'Sem Nome') {
        const clean = normalizePhone(telefone);
        const key = clean || nome.toLowerCase();
        if (!map.has(key)) {
          map.set(key, { nome, telefone: clean ? formatPhone(clean) : telefone, hasFiado: true });
        }
      }
    });

    (customers || []).forEach((c) => {
      const clean = c.telefone_limpo || normalizePhone(c.telefone);
      const key = clean || c.nome.toLowerCase();
      if (!map.has(key)) {
        map.set(key, { nome: c.nome, telefone: clean ? formatPhone(clean) : c.telefone, hasFiado: false });
      }
    });

    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [fiados, customers]);

  const filteredCustomerChips = useMemo(() => {
    const q = customerSearchFilter.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    if (!q) return allAvailableCustomers.slice(0, 18);
    return allAvailableCustomers
      .filter((c) => {
        const nameOk = c.nome.toLowerCase().includes(q);
        const phoneOk = c.telefone.includes(q) || (digits && normalizePhone(c.telefone).includes(digits));
        return nameOk || phoneOk;
      })
      .slice(0, 18);
  }, [allAvailableCustomers, customerSearchFilter]);

  const handlePhoneChange = (val: string) => {
    const formatted = formatPhone(val);
    setCustomerPhone(formatted || val);

    const clean = normalizePhone(val);
    if (clean.length >= 8) {
      const match = allAvailableCustomers.find((c) => {
        const cClean = normalizePhone(c.telefone);
        return cClean && (cClean === clean || clean.endsWith(cClean) || cClean.endsWith(clean));
      });
      if (match && (!customerName || customerName === 'Sem Nome')) {
        setCustomerName(match.nome);
      }
    }
  };

  // Generate Pix QR Code automatically whenever Pix tab is active in Payment Modal
  const preparePixQrCode = async (amount: number) => {
    setPixPaymentId(null);
    setIsPollingPix(false);

    if (settings.mercadoPagoToken && (!settings.pixModo || settings.pixModo === 'mercadopago')) {
      try {
        const res = await fetch('/api/mercadopago/pix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transaction_amount: amount,
            description: `Venda Cantina - R$ ${amount.toFixed(2)}`,
            token: settings.mercadoPagoToken
          })
        });
        const data = await res.json();
        if (res.ok && data?.point_of_interaction?.transaction_data?.qr_code) {
          setPixQrCode(data.point_of_interaction.transaction_data.qr_code);
          setPixPaymentId(data.id);
          setIsPollingPix(true);
          return;
        }
      } catch {
        // fallback to static/simulated QR below
      }
    }

    if (settings.pixChave) {
      try {
        const code = generateStaticPix(
          settings.pixChave,
          settings.pixTitular || settings.cantinaName || 'Cantina TUSEMM',
          settings.pixCidade || 'Sao Paulo',
          amount,
          `V${Date.now().toString().slice(-6)}`
        );
        setPixQrCode(code);
        return;
      } catch {}
    }

    setPixQrCode(buildSimulatedPixPayload(amount, settings.cantinaName));
  };

  const openPaymentModal = () => {
    if (cart.length === 0) return;
    setIsCartSheetOpen(false);
    setPaymentMethod(PaymentMethod.PIX);
    setCashReceivedInput(cartTotal.toFixed(2).replace('.', ','));
    setIsPaymentModalOpen(true);
    preparePixQrCode(cartTotal);
  };

  const handleSelectPaymentMethod = (method: PaymentMethod) => {
    setPaymentMethod(method);
    if (method === PaymentMethod.PIX) {
      preparePixQrCode(cartTotal);
    } else {
      setIsPollingPix(false);
      setPixPaymentId(null);
    }
    if (method === PaymentMethod.CASH && !cashReceivedInput) {
      setCashReceivedInput(cartTotal.toFixed(2).replace('.', ','));
    }
  };

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isPaymentModalOpen && isPollingPix && pixPaymentId && settings.mercadoPagoToken) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/mercadopago/payment/${pixPaymentId}`, {
            headers: { Authorization: `Bearer ${settings.mercadoPagoToken}` }
          });
          const data = await res.json();
          if (data.status === 'approved') {
            setIsPollingPix(false);
            if (interval) clearInterval(interval);
            await completeSaleConfirmed();
          }
        } catch {}
      }, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPaymentModalOpen, isPollingPix, pixPaymentId, settings.mercadoPagoToken]);

  const parsedCashReceived = useMemo(() => {
    if (!cashReceivedInput.trim()) return 0;
    return parseLocaleNumber(cashReceivedInput);
  }, [cashReceivedInput]);

  const cashChange = useMemo(() => {
    return parsedCashReceived - cartTotal;
  }, [parsedCashReceived, cartTotal]);

  const isCashInsufficient =
    paymentMethod === PaymentMethod.CASH &&
    cashReceivedInput.trim() !== '' &&
    parsedCashReceived < cartTotal - 0.001;

  const completeSaleConfirmed = async () => {
    if (isFinishing || cart.length === 0) return;
    if (isCashInsufficient) {
      showToast('Valor recebido é menor que o total da venda.', 'warning');
      return;
    }

    setIsFinishing(true);
    try {
      const isFiado = paymentMethod === PaymentMethod.FIADO;
      const finalName = isFiado ? customerName.trim() || 'Sem Nome' : customerName.trim() || undefined;
      const finalPhone = customerPhone.trim() || undefined;
      const valorRecebido =
        paymentMethod === PaymentMethod.CASH
          ? parsedCashReceived > 0
            ? parsedCashReceived
            : cartTotal
          : undefined;
      const troco =
        paymentMethod === PaymentMethod.CASH && valorRecebido !== undefined
          ? Math.max(0, valorRecebido - cartTotal)
          : undefined;

      const fallbackSale: Sale = {
        id: `VD-${Date.now().toString().slice(-6)}`,
        usuario_id: currentUser?.id,
        operador_nome: currentUser?.nome || currentUser?.usuario || 'Operador',
        valor_total: cartTotal,
        valor_recebido: valorRecebido,
        troco,
        forma_pagamento: paymentMethod,
        created_at: new Date().toISOString(),
        itens: [...cart],
        cliente_nome: finalName || 'Balcão',
        telefone_comprador: finalPhone,
        status: isFiado ? 'pendente' : 'pago'
      };

      const savedSale = await onCompleteSale({
        items: cart,
        total: cartTotal,
        paymentMethod,
        customerName: finalName,
        telefone_comprador: finalPhone,
        valor_recebido: valorRecebido,
        troco,
        isDebtPaid: !isFiado
      });

      playSuccessChime();
      setLastCompletedReceipt({
        sale: savedSale || fallbackSale,
        phone: finalPhone || '',
        phoneSaved: Boolean(finalPhone)
      });

      setCart([]);
      setIsPaymentModalOpen(false);
      setIsCartSheetOpen(false);
      setPixQrCode(null);
      setPixPaymentId(null);
      setIsPollingPix(false);
      setCashReceivedInput('');
      setCustomerName('');
      setCustomerPhone('');
      setCustomerSearchFilter('');

      showToast('Venda finalizada!', 'success');
    } catch (e: any) {
      console.error(e);
      showToast(e?.message || 'Erro inesperado ao finalizar venda.', 'error');
    } finally {
      setIsFinishing(false);
    }
  };

  const handleSaveReceiptPhone = async () => {
    if (!lastCompletedReceipt || !onUpdateSaleContact) return;
    const clean = normalizePhone(lastCompletedReceipt.phone);
    if (clean.length < 8) {
      showToast('Digite um telefone válido com DDD.', 'warning');
      return;
    }
    setIsSavingReceiptPhone(true);
    try {
      const formatted = formatPhone(clean);
      await onUpdateSaleContact(
        lastCompletedReceipt.sale.id,
        formatted,
        lastCompletedReceipt.sale.cliente_nome !== 'Balcão' &&
          lastCompletedReceipt.sale.cliente_nome !== 'Cliente Balcão'
          ? lastCompletedReceipt.sale.cliente_nome
          : undefined
      );
      setLastCompletedReceipt((prev) =>
        prev
          ? {
              ...prev,
              phone: formatted,
              phoneSaved: true,
              sale: { ...prev.sale, telefone_comprador: formatted }
            }
          : null
      );
      showToast('Telefone salvo na venda!', 'success');
    } catch (e: any) {
      showToast('Erro ao salvar telefone: ' + (e?.message || 'tente novamente'), 'error');
    } finally {
      setIsSavingReceiptPhone(false);
    }
  };

  const recentSales = useMemo(() => (sales || []).slice(0, 15), [sales]);

  return (
    <>
      <div className="space-y-4 pb-36 md:pb-28 animate-in fade-in duration-300">
        {/* Topo do PDV: Busca instantânea + Scanner + Ações rápidas */}
        <div className="bg-white dark:bg-[#160e2b] p-4 sm:p-5 rounded-[28px] shadow-sm border border-purple-100 dark:border-purple-900/40 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="flex-1 relative">
              <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-purple-400"></i>
              <input
                type="text"
                placeholder="Buscar produto por nome ou código..."
                className="w-full bg-purple-50/60 dark:bg-[#20143a] border-2 border-purple-100/80 dark:border-purple-900/50 focus:border-purple-600 rounded-2xl pl-11 pr-10 py-3.5 text-sm font-bold text-purple-950 dark:text-white placeholder:text-gray-400 outline-none transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  aria-label="Limpar busca"
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-xl text-gray-400 hover:text-purple-800 flex items-center justify-center"
                >
                  <i className="fa-solid fa-xmark"></i>
                </button>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsScannerOpen(true)}
                className="flex-1 sm:flex-none bg-purple-900 hover:bg-purple-950 text-white px-4 h-[52px] rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-all"
                title="Ler código de barras"
              >
                <i className="fa-solid fa-barcode text-base"></i>
                <span className="sm:hidden lg:inline">Código</span>
              </button>

              <button
                type="button"
                onClick={() => setIsHistoryOpen(true)}
                className="flex-1 sm:flex-none bg-purple-50 dark:bg-[#20143a] hover:bg-purple-100 text-purple-900 dark:text-purple-200 border border-purple-200 dark:border-purple-800 px-4 h-[52px] rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-2 active:scale-95 transition-all"
                title="Histórico de vendas recentes"
              >
                <i className="fa-solid fa-clock-rotate-left"></i>
                <span>Histórico ({recentSales.length})</span>
              </button>

              {onAddCashOutflow && (
                <button
                  type="button"
                  onClick={() => setIsOutflowModalOpen(true)}
                  className="bg-rose-600 hover:bg-rose-700 text-white px-4 h-[52px] rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-all"
                  title="Lançar saída de valor do caixa"
                >
                  <i className="fa-solid fa-money-bill-transfer"></i>
                  <span className="hidden sm:inline">Saída Caixa</span>
                </button>
              )}

              {isAdmin && onOpenAdminPanel && (
                <button
                  type="button"
                  onClick={onOpenAdminPanel}
                  className="bg-amber-400 hover:bg-amber-500 text-purple-950 px-4 h-[52px] rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-all"
                  title="Painel Administrativo & Estoque"
                >
                  <i className="fa-solid fa-boxes-stacked"></i>
                  <span className="hidden sm:inline">Estoque / Admin</span>
                </button>
              )}
            </div>
          </div>

          {/* Chips Horizontais Roláveis de Categorias */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide -mx-1 px-1">
            {categoryChips.map((cat) => {
              const active = activeCategory === cat;
              return (
                <button
                  type="button"
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-4 py-2.5 rounded-2xl text-xs font-black uppercase tracking-wide transition-all whitespace-nowrap shrink-0 active:scale-95 ${
                    active
                      ? 'bg-purple-900 text-white shadow-md'
                      : 'bg-purple-50/70 dark:bg-[#20143a] text-purple-900/70 dark:text-purple-200 hover:bg-purple-100 border border-purple-100 dark:border-purple-900/40'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

        {/* Barra sutil do último comprovante disponível sem atrapalhar próxima venda */}
        {lastCompletedReceipt && cart.length === 0 && (
          <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <i className="fa-solid fa-circle-check text-emerald-600 dark:text-emerald-400"></i>
              <span className="text-xs font-bold text-emerald-900 dark:text-emerald-200 truncate">
                Última venda: R$ {Number(lastCompletedReceipt.sale.valor_total).toFixed(2)} (
                {lastCompletedReceipt.sale.forma_pagamento.toUpperCase()})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsReceiptModalOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-black uppercase shrink-0 active:scale-95"
            >
              Comprovante / WhatsApp
            </button>
          </div>
        )}

        {/* Grade Responsiva de Produtos (2 colunas no celular) */}
        {filteredProducts.length === 0 ? (
          <div className="bg-white dark:bg-[#160e2b] rounded-[28px] p-10 text-center border border-purple-100 dark:border-purple-900/40">
            <i className="fa-solid fa-box-open text-4xl text-purple-300 mb-3 block"></i>
            <p className="text-sm font-black text-purple-950 dark:text-white uppercase">Nenhum produto encontrado</p>
            <p className="text-xs text-gray-500 dark:text-purple-300/70 mt-1">
              Tente outro termo na busca ou selecione a categoria Todos.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredProducts.map((product) => {
              const stock = Number(product.estoque) || 0;
              const isOut = stock <= 0;
              const cartEntry = cart.find((it) => it.produto_id === product.id);
              const qtyInCart = cartEntry?.quantidade || 0;
              const isPulsing = justAddedId === product.id;

              return (
                <button
                  type="button"
                  key={product.id}
                  onClick={() => addToCart(product)}
                  disabled={isOut}
                  className={`relative p-4 rounded-[28px] text-left border-2 transition-all flex flex-col justify-between min-h-[156px] ${
                    isOut
                      ? 'bg-gray-100/80 dark:bg-[#140d24] border-gray-200 dark:border-purple-900/20 opacity-50 grayscale cursor-not-allowed'
                      : isPulsing
                      ? 'bg-purple-50 dark:bg-[#241645] border-purple-700 shadow-lg scale-[0.97]'
                      : qtyInCart > 0
                      ? 'bg-white dark:bg-[#160e2b] border-purple-500 dark:border-purple-500 shadow-md active:scale-95'
                      : 'bg-white dark:bg-[#160e2b] border-purple-100/80 dark:border-purple-900/40 hover:border-purple-300 hover:shadow-md active:scale-95'
                  }`}
                >
                  {/* Top icon & status */}
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <div
                      className={`w-11 h-11 rounded-2xl flex items-center justify-center text-lg shrink-0 ${
                        isOut
                          ? 'bg-gray-200 dark:bg-gray-800 text-gray-500'
                          : 'bg-purple-100/80 dark:bg-purple-950 text-purple-800 dark:text-purple-200'
                      }`}
                    >
                      <i className={`fa-solid ${getCategoryIcon(product.categoria, product.nome)}`}></i>
                    </div>

                    {isOut ? (
                      <span className="text-[10px] font-black uppercase bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 px-2.5 py-1 rounded-xl">
                        Esgotado
                      </span>
                    ) : qtyInCart > 0 ? (
                      <span className="min-w-[28px] h-7 px-2 rounded-xl bg-purple-900 text-white text-xs font-black flex items-center justify-center shadow-sm">
                        {qtyInCart}x
                      </span>
                    ) : null}
                  </div>

                  {/* Product Name */}
                  <div className="mb-3">
                    <span className="text-[10px] font-bold uppercase text-purple-600/75 dark:text-purple-300/70 block mb-0.5 truncate">
                      {product.categoria}
                    </span>
                    <h4 className="text-sm font-black text-purple-950 dark:text-white leading-snug line-clamp-2">
                      {product.nome}
                    </h4>
                  </div>

                  {/* Price & Stock metadata */}
                  <div className="flex items-baseline justify-between gap-2 pt-2 border-t border-purple-50 dark:border-purple-900/30">
                    <span className="text-base sm:text-lg font-black text-purple-900 dark:text-amber-300">
                      R$ {(Number(product.preco) || 0).toFixed(2)}
                    </span>
                    <span
                      className={`text-[11px] font-bold ${
                        isOut
                          ? 'text-red-500'
                          : product.estoque_minimo !== undefined && stock <= product.estoque_minimo
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-gray-400 dark:text-purple-300/60'
                      }`}
                    >
                      Est: {stock}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* BARRA DE CARRINHO FIXA NO RODAPÉ */}
      <div className="fixed bottom-[66px] md:bottom-4 left-3 right-3 md:left-32 md:right-6 z-40 max-w-5xl mx-auto">
        <div className="bg-purple-950 dark:bg-[#1e113a] text-white rounded-[28px] p-2.5 pl-4 shadow-[0_14px_35px_rgba(30,10,60,0.38)] border border-purple-700/60 flex items-center justify-between gap-3">
          {/* Resumo clicável -> Abre Bottom Sheet */}
          <button
            type="button"
            onClick={() => {
              if (cart.length > 0) setIsCartSheetOpen(true);
            }}
            disabled={cart.length === 0}
            className="flex-1 flex items-center gap-3 text-left min-w-0 py-1 disabled:opacity-70 active:scale-[0.98] transition-transform"
          >
            <div className="relative w-11 h-11 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
              <i className="fa-solid fa-basket-shopping text-lg text-amber-300"></i>
              {cartItemCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] px-1 rounded-full bg-amber-400 text-purple-950 text-[11px] font-black flex items-center justify-center shadow">
                  {cartItemCount}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-purple-200 uppercase">
                <span>
                  {cartItemCount === 0
                    ? 'Carrinho vazio'
                    : cartItemCount === 1
                    ? '1 item no pedido'
                    : `${cartItemCount} itens no pedido`}
                </span>
                {cartItemCount > 0 && <i className="fa-solid fa-chevron-up text-[10px] text-amber-300"></i>}
              </div>
              <p className="text-xl font-black text-white tracking-tight leading-tight">
                R$ {cartTotal.toFixed(2)}
              </p>
            </div>
          </button>

          {/* Botão Grande Cobrar */}
          <button
            type="button"
            onClick={openPaymentModal}
            disabled={cart.length === 0}
            className={`px-6 sm:px-8 h-13 rounded-2xl font-black text-sm uppercase tracking-wider transition-all flex items-center gap-2 shrink-0 ${
              cart.length === 0
                ? 'bg-white/10 text-purple-300/60 cursor-not-allowed'
                : 'bg-emerald-500 hover:bg-emerald-400 text-purple-950 shadow-lg active:scale-95'
            }`}
          >
            <span>Cobrar</span>
            <i className="fa-solid fa-arrow-right"></i>
          </button>
        </div>
      </div>

      {/* GAVETA DO CARRINHO (BOTTOM SHEET) */}
      {isCartSheetOpen && (
        <div
          className="fixed inset-0 bg-black/75 z-[105] flex items-end md:items-center justify-center backdrop-blur-sm animate-in fade-in"
          onClick={() => setIsCartSheetOpen(false)}
        >
          <div
            className="bg-white dark:bg-[#160e2b] w-full max-w-lg rounded-t-[36px] md:rounded-[36px] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] max-h-[85dvh] flex flex-col shadow-2xl border-t md:border border-purple-200 dark:border-purple-900/50 animate-in slide-in-from-bottom-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-1.5 bg-purple-200 dark:bg-purple-800 rounded-full mx-auto mb-4 md:hidden"></div>

            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-black text-purple-950 dark:text-white uppercase">
                  Itens do Pedido ({cartItemCount})
                </h3>
                <p className="text-xs text-gray-500 dark:text-purple-300/70 font-semibold">
                  Ajuste as quantidades ou remova itens antes de cobrar
                </p>
              </div>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setCart([]);
                    setIsCartSheetOpen(false);
                  }}
                  className="text-xs font-black uppercase text-red-600 hover:text-red-700 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/50"
                >
                  Limpar
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {cart.map((item) => (
                <div
                  key={item.produto_id}
                  className="flex items-center justify-between gap-3 bg-purple-50/60 dark:bg-[#20143a] p-3.5 rounded-2xl border border-purple-100 dark:border-purple-900/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-purple-950 dark:text-white truncate">{item.nome}</p>
                    <p className="text-xs font-bold text-purple-600 dark:text-amber-300">
                      R$ {Number(item.preco_unitario).toFixed(2)} un · Sub: R$ {Number(item.subtotal).toFixed(2)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => removeFromCart(item.produto_id)}
                      aria-label={`Remover ${item.nome}`}
                      className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/60 text-red-600 flex items-center justify-center active:scale-90"
                    >
                      <i className="fa-solid fa-trash text-xs"></i>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateQuantity(item.produto_id, -1)}
                      aria-label="Diminuir quantidade"
                      className="w-10 h-10 rounded-xl bg-white dark:bg-[#160e2b] border border-purple-200 dark:border-purple-800 text-purple-950 dark:text-white font-black text-lg active:scale-90"
                    >
                      -
                    </button>
                    <span className="w-8 text-center text-sm font-black text-purple-950 dark:text-white">
                      {item.quantidade}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateQuantity(item.produto_id, 1)}
                      aria-label="Aumentar quantidade"
                      className="w-10 h-10 rounded-xl bg-purple-900 text-white font-black text-lg active:scale-90"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4 mt-4 border-t border-purple-100 dark:border-purple-900/40 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-gray-500 dark:text-purple-300">Total do Pedido</span>
                <span className="text-2xl font-black text-purple-950 dark:text-amber-300">
                  R$ {cartTotal.toFixed(2)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setIsCartSheetOpen(false)}
                  className="col-span-1 py-4 rounded-2xl bg-gray-100 dark:bg-[#20143a] text-gray-700 dark:text-purple-200 font-black text-xs uppercase"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={openPaymentModal}
                  className="col-span-2 py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-purple-950 font-black text-sm uppercase shadow-lg active:scale-95"
                >
                  Cobrar R$ {cartTotal.toFixed(2)}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE FINALIZAÇÃO E PAGAMENTO RÁPIDO */}
      {isPaymentModalOpen && (
        <div
          className="fixed inset-0 bg-black/80 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm animate-in fade-in"
          onClick={() => !isFinishing && setIsPaymentModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-[#160e2b] w-full max-w-md rounded-t-[36px] sm:rounded-[36px] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] max-h-[92dvh] overflow-y-auto shadow-2xl border border-purple-200 dark:border-purple-900/50 animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Total */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-[11px] font-black uppercase text-purple-600 dark:text-purple-300">
                  Pagamento · {cartItemCount} {cartItemCount === 1 ? 'item' : 'itens'}
                </p>
                <h3 className="text-3xl font-black text-purple-950 dark:text-white tracking-tight">
                  R$ {cartTotal.toFixed(2)}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsPaymentModalOpen(false)}
                disabled={isFinishing}
                aria-label="Fechar pagamento"
                className="w-10 h-10 rounded-2xl bg-purple-50 dark:bg-[#20143a] text-purple-900 dark:text-purple-200 flex items-center justify-center"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            {/* 4 Botões Grandes de Forma de Pagamento */}
            <div className="grid grid-cols-2 gap-2.5 mb-5">
              {[
                { id: PaymentMethod.PIX, label: 'Pix', icon: 'fa-qrcode' },
                { id: PaymentMethod.CASH, label: 'Dinheiro', icon: 'fa-money-bill-wave' },
                { id: PaymentMethod.DEBIT, label: 'Cartão', icon: 'fa-credit-card', isCard: true },
                { id: PaymentMethod.FIADO, label: 'Saldo / Fiado', icon: 'fa-user-clock' }
              ].map((opt) => {
                const isSelected = opt.isCard
                  ? paymentMethod === PaymentMethod.DEBIT || paymentMethod === PaymentMethod.CREDIT
                  : paymentMethod === opt.id;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => handleSelectPaymentMethod(opt.id)}
                    className={`p-4 rounded-2xl border-2 flex items-center gap-3 font-black text-xs uppercase transition-all active:scale-95 ${
                      isSelected
                        ? 'bg-purple-900 border-purple-900 text-white shadow-lg'
                        : 'bg-purple-50/70 dark:bg-[#20143a] border-purple-100 dark:border-purple-900/40 text-purple-950 dark:text-purple-100 hover:border-purple-300'
                    }`}
                  >
                    <i className={`fa-solid ${opt.icon} text-lg`}></i>
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Sub-opção rápida se Cartão */}
            {(paymentMethod === PaymentMethod.DEBIT || paymentMethod === PaymentMethod.CREDIT) && (
              <div className="mb-5 space-y-3 animate-in fade-in">
                <div className="grid grid-cols-2 gap-2 bg-purple-50 dark:bg-[#20143a] p-1.5 rounded-2xl">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod(PaymentMethod.DEBIT)}
                    className={`py-2.5 rounded-xl text-xs font-black uppercase ${
                      paymentMethod === PaymentMethod.DEBIT
                        ? 'bg-white dark:bg-purple-900 text-purple-950 dark:text-white shadow-sm'
                        : 'text-gray-500 dark:text-purple-300'
                    }`}
                  >
                    Débito
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod(PaymentMethod.CREDIT)}
                    className={`py-2.5 rounded-xl text-xs font-black uppercase ${
                      paymentMethod === PaymentMethod.CREDIT
                        ? 'bg-white dark:bg-purple-900 text-purple-950 dark:text-white shadow-sm'
                        : 'text-gray-500 dark:text-purple-300'
                    }`}
                  >
                    Crédito
                  </button>
                </div>
                <button
                  type="button"
                  onClick={completeSaleConfirmed}
                  disabled={isFinishing}
                  className="w-full py-4.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm uppercase shadow-xl active:scale-95 transition-all disabled:opacity-50"
                >
                  {isFinishing ? 'Finalizando...' : 'Confirmar Pagamento'}
                </button>
              </div>
            )}

            {/* Fluxo Dinheiro + Cálculo de Troco */}
            {paymentMethod === PaymentMethod.CASH && (
              <div className="space-y-4 animate-in fade-in">
                <div>
                  <label className="text-[11px] font-black uppercase text-purple-900 dark:text-purple-300 mb-1.5 block">
                    Valor Recebido (R$)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={cashReceivedInput}
                    onChange={(e) => setCashReceivedInput(e.target.value)}
                    className="w-full bg-purple-50/70 dark:bg-[#20143a] border-2 border-purple-200 dark:border-purple-800 focus:border-purple-600 rounded-2xl px-4 py-4 text-2xl font-black text-purple-950 dark:text-white outline-none text-center"
                  />
                </div>

                {/* Botões Rápidos de Cédulas */}
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: 'Exato', value: cartTotal },
                    { label: 'R$ 10', value: 10 },
                    { label: 'R$ 20', value: 20 },
                    { label: 'R$ 50', value: 50 }
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setCashReceivedInput(preset.value.toFixed(2).replace('.', ','))}
                      className="py-3 rounded-xl bg-purple-100 dark:bg-purple-950/70 hover:bg-purple-200 text-purple-950 dark:text-purple-100 font-black text-xs uppercase active:scale-95 transition-all"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* Troco em destaque verde */}
                <div
                  className={`p-4 rounded-2xl border flex items-center justify-between ${
                    isCashInsufficient
                      ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
                      : 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                  }`}
                >
                  <span className="text-xs font-black uppercase">
                    {isCashInsufficient ? 'Falta Receber' : 'Troco'}
                  </span>
                  <span className="text-2xl font-black">
                    R$ {Math.abs(Math.max(isCashInsufficient ? cashChange : 0, cashChange)).toFixed(2)}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={completeSaleConfirmed}
                  disabled={isFinishing || isCashInsufficient}
                  className="w-full py-4.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm uppercase shadow-xl active:scale-95 transition-all disabled:opacity-50"
                >
                  {isFinishing ? 'Finalizando...' : 'Confirmar Pagamento'}
                </button>
              </div>
            )}

            {/* Fluxo Conferência Pix */}
            {paymentMethod === PaymentMethod.PIX && (
              <div className="space-y-4 text-center animate-in fade-in">
                <div className="bg-purple-50/70 dark:bg-[#20143a] p-5 rounded-3xl border border-purple-100 dark:border-purple-900/40 flex flex-col items-center">
                  <div className="bg-white p-3.5 rounded-2xl shadow-sm mb-3">
                    <QRCodeSVG value={pixQrCode || buildSimulatedPixPayload(cartTotal, settings.cantinaName)} size={172} />
                  </div>
                  <div className="flex items-center gap-2 text-xs font-black uppercase text-amber-600 dark:text-amber-300">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
                    <span>Aguardando confirmação</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={completeSaleConfirmed}
                  disabled={isFinishing}
                  className="w-full py-4.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm uppercase shadow-xl active:scale-95 transition-all disabled:opacity-50"
                >
                  {isFinishing ? 'Registrando...' : 'Confirmar Recebimento'}
                </button>
              </div>
            )}

            {/* Fluxo Saldo / Fiado */}
            {paymentMethod === PaymentMethod.FIADO && (
              <div className="space-y-3 animate-in fade-in">
                {allAvailableCustomers.length > 0 && (
                  <div className="bg-purple-50/70 dark:bg-[#20143a] p-3 rounded-2xl border border-purple-100 dark:border-purple-900/40 space-y-2">
                    <input
                      type="text"
                      placeholder="Buscar cliente cadastrado..."
                      value={customerSearchFilter}
                      onChange={(e) => setCustomerSearchFilter(e.target.value)}
                      className="w-full bg-white dark:bg-[#160e2b] border border-purple-200 dark:border-purple-800 rounded-xl px-3 py-2 text-xs font-bold text-purple-950 dark:text-white outline-none"
                    />
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                      {filteredCustomerChips.map((cust, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setCustomerName(cust.nome);
                            if (cust.telefone) setCustomerPhone(formatPhone(cust.telefone));
                          }}
                          className={`px-2.5 py-1 rounded-xl text-[10px] font-black uppercase border ${
                            customerName.toLowerCase() === cust.nome.toLowerCase()
                              ? 'bg-purple-900 text-white border-purple-900'
                              : 'bg-white dark:bg-[#160e2b] text-purple-900 dark:text-purple-200 border-purple-200 dark:border-purple-800'
                          }`}
                        >
                          {cust.nome}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <input
                  type="text"
                  placeholder="Nome do cliente (ex: Maria)"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full bg-purple-50/70 dark:bg-[#20143a] border border-purple-200 dark:border-purple-800 rounded-2xl px-4 py-3 text-sm font-bold text-purple-950 dark:text-white outline-none"
                />

                <input
                  type="tel"
                  placeholder="WhatsApp (opcional)"
                  value={customerPhone}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  className="w-full bg-purple-50/70 dark:bg-[#20143a] border border-purple-200 dark:border-purple-800 rounded-2xl px-4 py-3 text-sm font-bold text-purple-950 dark:text-white outline-none"
                />

                <button
                  type="button"
                  onClick={completeSaleConfirmed}
                  disabled={isFinishing}
                  className="w-full py-4.5 rounded-2xl bg-purple-900 hover:bg-purple-950 text-white font-black text-sm uppercase shadow-xl active:scale-95 transition-all disabled:opacity-50"
                >
                  {isFinishing ? 'Registrando...' : 'Confirmar no Saldo / Fiado'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL HISTÓRICO RÁPIDO DO PDV */}
      {isHistoryOpen && (
        <div
          className="fixed inset-0 bg-black/75 z-[115] flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm animate-in fade-in"
          onClick={() => setIsHistoryOpen(false)}
        >
          <div
            className="bg-white dark:bg-[#160e2b] w-full max-w-lg rounded-t-[36px] sm:rounded-[36px] p-6 max-h-[85dvh] flex flex-col shadow-2xl border border-purple-100 dark:border-purple-900/50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-black text-purple-950 dark:text-white uppercase">
                  Histórico Recente de Vendas
                </h3>
                <p className="text-xs text-gray-500 dark:text-purple-300/70 font-semibold">
                  Salvo localmente e sincronizado
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsHistoryOpen(false)}
                className="w-9 h-9 rounded-xl bg-purple-50 dark:bg-[#20143a] text-purple-900 dark:text-purple-200 flex items-center justify-center"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {recentSales.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-10 font-bold">
                  Nenhuma venda registrada ainda.
                </p>
              ) : (
                recentSales.map((s) => (
                  <div
                    key={s.id}
                    className="p-4 rounded-2xl bg-purple-50/50 dark:bg-[#20143a] border border-purple-100 dark:border-purple-900/40 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-black text-purple-950 dark:text-white uppercase">
                        {s.forma_pagamento.toUpperCase()} · {s.operador_nome || 'Operador'}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-purple-300/70 font-semibold mt-0.5">
                        {formatSafeDateTime(s.created_at)}
                      </p>
                      <p className="text-xs text-gray-700 dark:text-purple-100 mt-1.5 line-clamp-2">
                        {(s.itens || []).map((i) => `${i.quantidade}x ${i.nome}`).join(', ')}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-base font-black text-purple-900 dark:text-amber-300 block">
                        R$ {(Number(s.valor_total) || 0).toFixed(2)}
                      </span>
                      {s.troco !== undefined && s.troco > 0 && (
                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 block">
                          Troco: R$ {Number(s.troco).toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE COMPROVANTE (OPCIONAL SOB DEMANDA) */}
      {isReceiptModalOpen && lastCompletedReceipt && (
        <div
          className="fixed inset-0 bg-black/80 z-[120] flex items-center justify-center p-4 backdrop-blur-sm animate-in zoom-in-95"
          onClick={() => setIsReceiptModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-[#180e2f] rounded-[36px] p-6 sm:p-8 w-full max-w-sm shadow-2xl text-center border border-purple-200 dark:border-purple-900/50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-300 flex items-center justify-center text-2xl mx-auto mb-3">
              <i className="fa-solid fa-receipt"></i>
            </div>
            <h3 className="text-lg font-black uppercase text-purple-950 dark:text-purple-100">Comprovante da Venda</h3>
            <p className="text-2xl font-black text-purple-800 dark:text-amber-300 mt-1">
              R$ {Number(lastCompletedReceipt.sale.valor_total).toFixed(2)}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-4">
              {lastCompletedReceipt.sale.cliente_nome || 'Balcão'} ·{' '}
              {lastCompletedReceipt.sale.forma_pagamento.toUpperCase()}
            </p>

            <div className="bg-gray-50 dark:bg-[#20143a] p-3 rounded-2xl mb-4 border border-gray-100 dark:border-purple-900/40 text-left">
              <label className="text-[10px] font-black uppercase text-purple-900 dark:text-purple-300 block mb-1">
                WhatsApp do Cliente
              </label>
              <div className="flex gap-2">
                <input
                  type="tel"
                  placeholder="(11) 99999-9999"
                  value={lastCompletedReceipt.phone}
                  onChange={(e) =>
                    setLastCompletedReceipt((prev) =>
                      prev ? { ...prev, phone: formatPhone(e.target.value), phoneSaved: false } : null
                    )
                  }
                  className="flex-1 bg-white dark:bg-[#160e2b] border border-gray-200 dark:border-purple-800 rounded-xl px-3 py-2 text-xs font-bold text-gray-900 dark:text-white outline-none"
                />
                {onUpdateSaleContact && normalizePhone(lastCompletedReceipt.phone).length >= 8 && !lastCompletedReceipt.phoneSaved && (
                  <button
                    type="button"
                    onClick={handleSaveReceiptPhone}
                    disabled={isSavingReceiptPhone}
                    className="bg-purple-900 hover:bg-purple-800 text-white px-3 py-2 rounded-xl text-[10px] font-black uppercase shrink-0"
                  >
                    {isSavingReceiptPhone ? '...' : 'Salvar'}
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2.5">
              <a
                href={getSaleWhatsAppReceiptLink(lastCompletedReceipt.sale, settings, lastCompletedReceipt.phone)}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3.5 rounded-2xl font-black text-xs uppercase shadow-md flex items-center justify-center gap-2"
              >
                <i className="fa-brands fa-whatsapp text-base"></i> Enviar via WhatsApp
              </a>

              <button
                type="button"
                onClick={() => printSaleThermalReceipt(lastCompletedReceipt.sale, settings)}
                className="w-full bg-purple-50 dark:bg-purple-950/40 text-purple-900 dark:text-purple-200 border border-purple-200 dark:border-purple-800 py-3.5 rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-print"></i> Imprimir Recibo
              </button>

              <button
                type="button"
                onClick={() => setIsReceiptModalOpen(false)}
                className="w-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 py-3 rounded-2xl font-black text-xs uppercase"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SCANNER DE CÓDIGO DE BARRAS */}
      {isScannerOpen && (
        <Scanner
          products={products}
          onSelectProduct={(product) => {
            addToCart(product);
            setIsScannerOpen(false);
          }}
          onScan={(code) => {
            const lower = code.toLowerCase();
            const product = products.find(
              (p) =>
                p.codigo?.toLowerCase() === lower ||
                p.codigo_barras?.toLowerCase() === lower ||
                p.nome?.toLowerCase() === lower
            );
            if (product) {
              addToCart(product);
              setIsScannerOpen(false);
            } else {
              showToast('Produto não encontrado com este código.', 'warning');
            }
          }}
          onClose={() => setIsScannerOpen(false)}
        />
      )}

      {/* MODAL RÁPIDO: SAÍDA DE VALOR DO CAIXA */}
      {onAddCashOutflow && (
        <CashOutflowModal
          isOpen={isOutflowModalOpen}
          onClose={() => setIsOutflowModalOpen(false)}
          onConfirm={onAddCashOutflow}
          hasOpenShift={hasOpenShift}
        />
      )}
    </>
  );
};

export default SalesView;
