import React, { useState, useMemo, useEffect } from 'react';
import { Product, SaleItem, PaymentMethod, Sale, Category, AppSettings, Customer } from '../types';
import Scanner from './Scanner';
import { QRCodeSVG } from 'qrcode.react';
import { generateStaticPix } from '../services/pix';
import { normalizePhone, formatPhone } from '../utils/phoneUtils';
import { getSaleWhatsAppReceiptLink, printSaleThermalReceipt } from '../utils/receiptUtils';
import { playSuccessChime } from '../utils/soundUtils';
import { useFeedback } from './FeedbackProvider';

interface SalesViewProps {
  products: Product[];
  settings: AppSettings;
  fiados?: Sale[];
  customers?: Customer[];
  onCompleteSale: (sale: any) => Promise<Sale | void>;
  onUpdateSaleContact?: (saleId: string, telefone: string, cliente_nome?: string) => Promise<void>;
}

const SalesView: React.FC<SalesViewProps> = ({
  products,
  settings,
  fiados = [],
  customers = [],
  onCompleteSale,
  onUpdateSaleContact
}) => {
  const { showToast } = useFeedback();
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerSearchFilter, setCustomerSearchFilter] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('Todos');
  const [isFinishing, setIsFinishing] = useState(false);
  const [pixQrCode, setPixQrCode] = useState<string | null>(null);
  const [pixPaymentId, setPixPaymentId] = useState<string | null>(null);
  const [isPollingPix, setIsPollingPix] = useState(false);
  const [isSavingReceiptPhone, setIsSavingReceiptPhone] = useState(false);
  const [completedReceipt, setCompletedReceipt] = useState<{
    sale: Sale;
    phone: string;
    phoneSaved?: boolean;
  } | null>(null);

  const cartTotal = useMemo(
    () => cart.reduce((acc, item) => acc + (item.preco_unitario || 0) * (item.quantidade || 0), 0),
    [cart]
  );

  const filteredProducts = products.filter((p) => {
    const productName = p.nome || '';
    const productCode = p.codigo || p.codigo_barras || '';
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch =
      productName.toLowerCase().includes(searchLower) || productCode.toLowerCase().includes(searchLower);
    const matchesCategory = activeCategory === 'Todos' || p.categoria === activeCategory;
    const isActivo = p.ativo !== false;
    return matchesSearch && matchesCategory && isActivo;
  });

  const addToCart = (product: Product) => {
    if (product.estoque <= 0) {
      showToast(`Ops! ${product.nome} está sem estoque.`, 'warning');
      return;
    }
    setCart((prev) => {
      const existing = prev.find((item) => item.produto_id === product.id);
      if (existing && existing.quantidade >= product.estoque) {
        showToast('Quantidade limitada ao estoque disponível.', 'warning');
        return prev;
      }
      if (existing) {
        return prev.map((item) =>
          item.produto_id === product.id
            ? {
                ...item,
                quantidade: item.quantidade + 1,
                subtotal: (item.quantidade + 1) * (item.preco_unitario || 0)
              }
            : item
        );
      }
      return [
        ...prev,
        {
          produto_id: product.id,
          nome: product.nome,
          preco_unitario: product.preco || 0,
          quantidade: 1,
          subtotal: product.preco || 0
        }
      ];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.produto_id !== productId));
  };

  const updateQuantity = (productId: string, delta: number) => {
    const product = products.find((p) => p.id === productId);
    setCart((prev) =>
      prev.map((item) => {
        if (item.produto_id === productId) {
          const newQty = item.quantidade + delta;
          if (newQty > (product?.estoque || 0)) {
            showToast('Estoque máximo atingido.', 'warning');
            return item;
          }
          const finalQty = Math.max(1, newQty);
          return { ...item, quantidade: finalQty, subtotal: finalQty * item.preco_unitario };
        }
        return item;
      })
    );
  };

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isPollingPix && pixPaymentId && settings.mercadoPagoToken) {
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
        } catch (e) {
          console.error('Erro consultando pix', e);
        }
      }, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPollingPix, pixPaymentId, settings.mercadoPagoToken]);

  const isFiado = paymentMethod === PaymentMethod.FIADO;

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
    if (!q) return allAvailableCustomers.slice(0, 20);
    return allAvailableCustomers
      .filter((c) => {
        const nameOk = c.nome.toLowerCase().includes(q);
        const phoneOk = c.telefone.includes(q) || (digits && normalizePhone(c.telefone).includes(digits));
        return nameOk || phoneOk;
      })
      .slice(0, 20);
  }, [allAvailableCustomers, customerSearchFilter]);

  const handlePhoneChange = (val: string) => {
    const formatted = formatPhone(val);
    setCustomerPhone(formatted || val);
    setValidationError(null);

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

  const completeSaleConfirmed = async () => {
    setIsFinishing(true);
    setPixQrCode(null);
    setPixPaymentId(null);
    setValidationError(null);
    try {
      const finalName = isFiado ? customerName.trim() || 'Sem Nome' : customerName.trim() || undefined;
      const finalPhone = customerPhone.trim() || undefined;

      const fallbackSale: Sale = {
        id: `VD-${Date.now().toString().slice(-6)}`,
        valor_total: cartTotal,
        forma_pagamento: paymentMethod!,
        created_at: new Date().toISOString(),
        itens: [...cart],
        cliente_nome: finalName || 'Cliente Balcão',
        telefone_comprador: finalPhone,
        status: paymentMethod === PaymentMethod.FIADO ? 'pendente' : 'pago'
      };

      const savedSale = await onCompleteSale({
        items: cart,
        total: cartTotal,
        paymentMethod,
        customerName: finalName,
        telefone_comprador: finalPhone,
        isDebtPaid: paymentMethod !== PaymentMethod.FIADO
      });

      playSuccessChime();
      setCompletedReceipt({
        sale: savedSale || fallbackSale,
        phone: finalPhone || '',
        phoneSaved: Boolean(finalPhone)
      });

      setCart([]);
      setPaymentMethod(null);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerSearchFilter('');
      setValidationError(null);
    } catch (e: any) {
      console.error(e);
      setValidationError(e.message || 'Erro inesperado ao finalizar venda.');
    } finally {
      setIsFinishing(false);
    }
  };

  const handleSaveReceiptPhone = async () => {
    if (!completedReceipt || !onUpdateSaleContact) return;
    const clean = normalizePhone(completedReceipt.phone);
    if (clean.length < 8) {
      showToast('Digite um telefone válido com DDD.', 'warning');
      return;
    }
    setIsSavingReceiptPhone(true);
    try {
      const formatted = formatPhone(clean);
      await onUpdateSaleContact(
        completedReceipt.sale.id,
        formatted,
        completedReceipt.sale.cliente_nome !== 'Cliente Balcão' ? completedReceipt.sale.cliente_nome : undefined
      );
      setCompletedReceipt((prev) =>
        prev
          ? {
              ...prev,
              phone: formatted,
              phoneSaved: true,
              sale: { ...prev.sale, telefone_comprador: formatted }
            }
          : null
      );
      showToast('Telefone salvo na venda concluída!', 'success');
    } catch (e: any) {
      showToast('Erro ao salvar telefone: ' + (e.message || 'tente novamente'), 'error');
    } finally {
      setIsSavingReceiptPhone(false);
    }
  };

  const finalizeSale = async () => {
    if (!paymentMethod || isFinishing || cart.length === 0) return;
    setValidationError(null);

    if (paymentMethod === PaymentMethod.FIADO) {
      await completeSaleConfirmed();
      return;
    }

    if (paymentMethod === PaymentMethod.PIX) {
      if (settings.mercadoPagoToken && (!settings.pixModo || settings.pixModo === 'mercadopago')) {
        setIsFinishing(true);
        try {
          const res = await fetch('/api/mercadopago/pix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transaction_amount: cartTotal,
              description: `Venda Cantina - ${cartTotal}`,
              token: settings.mercadoPagoToken
            })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Erro Mercado Pago');

          setPixQrCode(data.point_of_interaction.transaction_data.qr_code);
          setPixPaymentId(data.id);
          setIsPollingPix(true);
          setIsFinishing(false);
          return;
        } catch (e: any) {
          console.warn('Mercado Pago falhou ou offline, finalizando manualmente:', e);
          await completeSaleConfirmed();
          return;
        }
      } else if (settings.pixChave && settings.pixModo === 'manual') {
        setIsFinishing(true);
        try {
          const code = generateStaticPix(
            settings.pixChave,
            settings.pixTitular || 'Cantina',
            settings.pixCidade || 'Sua Cidade',
            cartTotal,
            `V${Date.now()}`
          );
          setPixQrCode(code);
          setIsPollingPix(false);
          setIsFinishing(false);
          return;
        } catch (e) {
          console.warn('Erro ao gerar PIX estático:', e);
          await completeSaleConfirmed();
          return;
        }
      } else {
        await completeSaleConfirmed();
        return;
      }
    }

    await completeSaleConfirmed();
  };

  const getMethodLabel = (method: PaymentMethod) => {
    switch (method) {
      case PaymentMethod.PIX:
        return 'PIX';
      case PaymentMethod.CASH:
        return 'Dinheiro';
      case PaymentMethod.DEBIT:
        return 'Débito';
      case PaymentMethod.CREDIT:
        return 'Crédito';
      case PaymentMethod.FIADO:
        return 'Fiado';
      default:
        return method;
    }
  };

  return (
    <>
      {pixQrCode && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#160e2b] rounded-[40px] p-8 w-full max-w-sm shadow-2xl flex flex-col items-center border border-gray-100 dark:border-purple-900/40">
            <h3 className="text-xl font-black text-purple-950 dark:text-white uppercase mb-4">Pagamento PIX</h3>
            <p className="text-xs text-gray-500 dark:text-purple-300 font-bold mb-6 text-center">
              {isPollingPix
                ? 'Escaneie o QR Code abaixo no app do seu banco'
                : 'Pagamento Manual: Confirme abaixo após o cliente escanear e pagar.'}
            </p>
            <div className="bg-white p-4 rounded-xl mb-6">
              <QRCodeSVG value={pixQrCode} size={200} />
            </div>
            <p className="text-xl font-black text-green-600 dark:text-green-400 mb-6">R$ {cartTotal.toFixed(2)}</p>
            <div className="w-full space-y-3">
              <button
                type="button"
                onClick={completeSaleConfirmed}
                className="w-full bg-green-500 text-white py-4 rounded-2xl font-black text-[12px] uppercase shadow-lg hover:bg-green-600 transition-all"
              >
                Confirmar Manualmente
              </button>
              <button
                type="button"
                onClick={() => {
                  setPixQrCode(null);
                  setIsPollingPix(false);
                }}
                className="w-full bg-gray-200 dark:bg-[#20143a] text-gray-700 dark:text-purple-200 py-4 rounded-2xl font-black text-[12px] uppercase shadow-md hover:bg-gray-300 transition-all"
              >
                Cancelar Pagamento
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-20 lg:pb-0">
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-white dark:bg-[#160e2b] p-6 rounded-[32px] shadow-sm border border-gray-100 dark:border-purple-900/40">
            <div className="flex flex-col md:flex-row gap-4 mb-6">
              <div className="flex-1 relative">
                <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-gray-300"></i>
                <input
                  type="text"
                  placeholder="Nome do item ou código..."
                  className="w-full bg-gray-50 dark:bg-[#20143a] border-none rounded-2xl pl-12 pr-4 py-4 text-sm font-bold focus:ring-2 focus:ring-purple-500 transition-all outline-none"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={() => setIsScannerOpen(true)}
                className="bg-purple-900 text-white w-full md:w-14 h-14 flex items-center justify-center gap-2 rounded-2xl shadow-lg active:scale-95 transition-all hover:bg-black"
                title="Ler código de barras"
              >
                <i className="fa-solid fa-barcode text-xl"></i>
                <span className="md:hidden text-xs font-black uppercase">Leitor de Código</span>
              </button>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {['Todos', ...Array.from(new Set([...Object.values(Category), ...products.map((p) => p.categoria)]))]
                .filter(Boolean)
                .map((cat) => (
                  <button
                    type="button"
                    key={cat}
                    onClick={() => setActiveCategory(cat as any)}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                      activeCategory === cat
                        ? 'bg-purple-700 text-white shadow-md'
                        : 'bg-gray-50 dark:bg-[#20143a] text-gray-400 hover:bg-gray-100'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {filteredProducts.map((product) => {
              const isOut = product.estoque <= 0;
              return (
                <button
                  type="button"
                  key={product.id}
                  onClick={() => addToCart(product)}
                  disabled={isOut}
                  className={`p-4 rounded-[28px] text-left border-2 transition-all relative group overflow-hidden bg-white dark:bg-[#160e2b] border-white dark:border-purple-900/40 hover:border-purple-200 dark:hover:border-purple-600 hover:shadow-xl ${
                    isOut ? 'opacity-40 cursor-not-allowed' : 'active:scale-95'
                  }`}
                >
                  <span className="text-[8px] font-black uppercase text-purple-400 tracking-tighter mb-1 block">
                    {product.categoria}
                  </span>
                  <h4 className="text-xs font-black text-gray-800 dark:text-white uppercase line-clamp-2 min-h-[2.5rem] leading-tight mb-2">
                    {product.nome}
                  </h4>
                  <div className="flex justify-between items-end">
                    <p className="text-base font-black text-purple-900 dark:text-amber-300">
                      R$ {(product.preco || 0).toFixed(2)}
                    </p>
                    <span
                      className={`text-[8px] font-black px-1.5 py-0.5 rounded-md ${
                        product.estoque_minimo !== undefined && product.estoque <= product.estoque_minimo
                          ? 'bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-300'
                          : 'bg-green-50 text-green-600 dark:bg-green-950/60 dark:text-green-300'
                      }`}
                    >
                      EST: {product.estoque}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-4 flex flex-col gap-4">
          <div
            id="pdv-checkout-panel"
            className="bg-white dark:bg-[#160e2b] p-6 rounded-[40px] shadow-sm border border-gray-100 dark:border-purple-900/40 flex-1 flex flex-col lg:sticky lg:top-28 h-auto lg:max-h-[calc(100dvh-140px)]"
          >
            <h2 className="text-xl font-black text-purple-950 dark:text-white uppercase tracking-tight mb-6 flex justify-between">
              Checkout
              <i className="fa-solid fa-receipt opacity-20"></i>
            </h2>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-hide">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-300 dark:text-purple-400/40 py-10 opacity-70">
                  <i className="fa-solid fa-cart-shopping text-6xl mb-4"></i>
                  <p className="text-[10px] font-black uppercase tracking-widest">Carrinho Vazio</p>
                </div>
              ) : (
                cart.map((item) => (
                  <div
                    key={item.produto_id}
                    className="flex items-center justify-between bg-gray-50/50 dark:bg-[#20143a] p-4 rounded-3xl border border-gray-100 dark:border-purple-900/40 animate-in slide-in-from-right-2"
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      <h5 className="text-[10px] font-black text-gray-800 dark:text-white uppercase leading-tight truncate">
                        {item.nome}
                      </h5>
                      <p className="text-[9px] font-bold text-purple-500 dark:text-amber-300 mt-0.5">
                        R$ {item.preco_unitario.toFixed(2)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => removeFromCart(item.produto_id)}
                        className="w-7 h-7 flex items-center justify-center bg-red-50 dark:bg-red-950/60 text-red-500 rounded-lg shadow-sm border border-red-100 dark:border-red-900/50 hover:bg-red-100 transition-all mr-1"
                      >
                        <i className="fa-solid fa-trash text-[10px]"></i>
                      </button>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.produto_id, -1)}
                        className="w-7 h-7 bg-white dark:bg-[#160e2b] rounded-lg shadow-sm border border-gray-100 dark:border-purple-900 font-bold hover:bg-gray-50"
                      >
                        -
                      </button>
                      <span className="text-xs font-black text-gray-900 dark:text-white w-5 text-center">
                        {item.quantidade}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.produto_id, 1)}
                        className="w-7 h-7 bg-white dark:bg-[#160e2b] rounded-lg shadow-sm border border-gray-100 dark:border-purple-900 font-bold hover:bg-gray-50"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {cart.length > 0 && (
              <div className="mt-6 pt-6 border-t border-dashed border-gray-200 dark:border-purple-900/50">
                <div className="flex justify-between items-center mb-6">
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Valor Total</span>
                  <span className="text-3xl font-black text-purple-950 dark:text-amber-300 tracking-tight">
                    R$ {cartTotal.toFixed(2)}
                  </span>
                </div>

                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 pl-1">
                      Forma de Pagamento
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.values(PaymentMethod).map((method) => (
                        <button
                          type="button"
                          key={method}
                          onClick={() => {
                            setPaymentMethod(method);
                            setValidationError(null);
                          }}
                          disabled={isFinishing}
                          className={`py-3 rounded-2xl text-[9px] font-black uppercase tracking-widest border-2 transition-all ${
                            paymentMethod === method
                              ? method === PaymentMethod.FIADO
                                ? 'bg-purple-900 border-purple-900 text-white shadow-xl ring-2 ring-purple-300 scale-105'
                                : 'bg-purple-900 border-purple-900 text-white shadow-xl'
                              : 'bg-white dark:bg-[#20143a] border-gray-100 dark:border-purple-900/40 text-gray-500 dark:text-purple-200 hover:border-gray-200'
                          } ${isFinishing ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          {getMethodLabel(method)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {isFiado && (
                    <div className="bg-purple-50 dark:bg-purple-950/60 p-4 rounded-3xl border border-purple-200 dark:border-purple-800 shadow-sm space-y-3 animate-in fade-in slide-in-from-top-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-black uppercase tracking-widest text-purple-950 dark:text-purple-200 flex items-center gap-1.5">
                          <i className="fa-solid fa-user-clock text-purple-600 dark:text-purple-300"></i>
                          Dados do Fiado (Opcional)
                        </span>
                        <span className="text-[8px] font-black uppercase tracking-widest bg-purple-200 text-purple-900 px-2 py-0.5 rounded-full">
                          WhatsApp
                        </span>
                      </div>

                      {allAvailableCustomers.length > 0 && (
                        <div className="space-y-1.5">
                          <input
                            type="text"
                            placeholder="Filtrar cliente cadastrado..."
                            value={customerSearchFilter}
                            onChange={(e) => setCustomerSearchFilter(e.target.value)}
                            className="w-full bg-white dark:bg-[#160e2b] border border-purple-200 dark:border-purple-800 rounded-xl px-3 py-1.5 text-[11px] font-bold text-purple-950 dark:text-white outline-none"
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
                                className={`px-2.5 py-1 rounded-xl text-[9px] font-black uppercase tracking-wider border transition-all active:scale-95 flex items-center gap-1 ${
                                  customerName.toLowerCase() === cust.nome.toLowerCase()
                                    ? 'bg-purple-900 text-white border-purple-900 shadow-xs'
                                    : 'bg-white dark:bg-[#160e2b] text-purple-900 dark:text-purple-200 border-purple-200 dark:border-purple-800 hover:bg-purple-100'
                                }`}
                              >
                                <i className="fa-solid fa-user text-[8px] opacity-60"></i>
                                <span>{cust.nome}</span>
                                {cust.hasFiado && (
                                  <span className="text-[7px] bg-amber-100 text-amber-800 px-1 rounded font-black">
                                    fiado
                                  </span>
                                )}
                                {cust.telefone && <i className="fa-brands fa-whatsapp text-green-600 text-[9px]"></i>}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="space-y-2.5">
                        <div>
                          <label className="text-[9px] font-black uppercase text-purple-900 dark:text-purple-300 tracking-wider mb-1 block pl-1">
                            Nome do Cliente
                          </label>
                          <input
                            type="text"
                            placeholder="Ex: Maria, João ou deixe vazio..."
                            value={customerName}
                            onChange={(e) => {
                              setCustomerName(e.target.value);
                              setValidationError(null);
                            }}
                            disabled={isFinishing}
                            className="w-full bg-white dark:bg-[#160e2b] border border-gray-200 dark:border-purple-800 focus:border-purple-500 rounded-2xl px-4 py-3 font-bold uppercase text-xs text-purple-950 dark:text-white placeholder-gray-400 outline-none transition-all"
                          />
                        </div>

                        <div>
                          <label className="text-[9px] font-black uppercase text-purple-900 dark:text-purple-300 tracking-wider mb-1 block pl-1">
                            Telefone / WhatsApp com DDD
                          </label>
                          <div className="relative">
                            <i className="fa-brands fa-whatsapp absolute left-4 top-1/2 -translate-y-1/2 text-green-500 text-sm"></i>
                            <input
                              type="tel"
                              placeholder="(11) 99999-9999"
                              value={customerPhone}
                              onChange={(e) => handlePhoneChange(e.target.value)}
                              disabled={isFinishing}
                              className="w-full bg-white dark:bg-[#160e2b] border border-gray-200 dark:border-purple-800 focus:border-purple-500 rounded-2xl pl-11 pr-4 py-3 font-bold text-xs text-purple-950 dark:text-white placeholder-gray-400 outline-none transition-all"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {validationError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-3.5 rounded-2xl text-xs font-bold flex items-center gap-2 animate-in fade-in">
                      <i className="fa-solid fa-triangle-exclamation text-red-500 text-base"></i>
                      <span>{validationError}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={finalizeSale}
                    disabled={!paymentMethod || isFinishing || cart.length === 0}
                    className={`w-full py-5 rounded-3xl font-black text-xs uppercase tracking-widest transition-all ${
                      !paymentMethod || isFinishing || cart.length === 0
                        ? 'bg-gray-200 dark:bg-purple-950/60 text-gray-400 cursor-not-allowed shadow-none'
                        : 'bg-green-600 text-white shadow-xl active:scale-95 hover:bg-green-700'
                    }`}
                  >
                    {isFinishing ? (
                      <span className="flex items-center justify-center gap-2">
                        <i className="fa-solid fa-spinner animate-spin"></i> Processando...
                      </span>
                    ) : isFiado ? (
                      'Finalizar Venda no Fiado'
                    ) : (
                      'Finalizar Venda'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

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
      </div>

      {/* Floating Mobile Checkout Button */}
      {cart.length > 0 && (
        <div className="lg:hidden fixed bottom-20 left-4 right-4 z-40">
          <button
            type="button"
            onClick={() => {
              const checkoutEl = document.getElementById('pdv-checkout-panel');
              checkoutEl?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="w-full bg-purple-900 text-white p-4 rounded-3xl shadow-2xl flex justify-between items-center font-black uppercase active:scale-95 transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center text-xs">
                {cart.reduce((acc, item) => acc + item.quantidade, 0)}
              </div>
              <span className="text-xs tracking-widest">Ir para Pagamento</span>
            </div>
            <span className="text-lg">R$ {cartTotal.toFixed(2)}</span>
          </button>
        </div>
      )}

      {/* Modal de Comprovante de Venda Digital */}
      {completedReceipt && (
        <div className="fixed inset-0 bg-black/80 z-[115] flex items-center justify-center p-4 backdrop-blur-sm animate-in zoom-in-95">
          <div className="bg-white dark:bg-[#180e2f] rounded-[36px] p-6 sm:p-8 w-full max-w-sm shadow-2xl text-center border border-purple-200 dark:border-purple-900/50">
            <div className="w-16 h-16 rounded-3xl bg-green-100 dark:bg-green-950 text-green-600 dark:text-green-300 flex items-center justify-center text-3xl mx-auto mb-4 shadow-inner">
              <i className="fa-solid fa-circle-check"></i>
            </div>
            <h3 className="text-xl font-black uppercase text-purple-950 dark:text-purple-100">Venda Registrada!</h3>
            <p className="text-2xl font-black text-purple-700 dark:text-purple-300 mt-1">
              R$ {Number(completedReceipt.sale.valor_total).toFixed(2)}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-4">
              {completedReceipt.sale.cliente_nome || 'Cliente Balcão'} •{' '}
              {completedReceipt.sale.forma_pagamento.toUpperCase()}
            </p>

            {/* Campo rápido para inserir telefone na venda concluída antes de enviar WhatsApp */}
            <div className="bg-gray-50 dark:bg-[#20143a] p-3 rounded-2xl mb-4 border border-gray-100 dark:border-purple-900/40 text-left">
              <label className="text-[9px] font-black uppercase text-purple-900 dark:text-purple-300 block mb-1">
                WhatsApp do Cliente (Opcional)
              </label>
              <div className="flex gap-2">
                <input
                  type="tel"
                  placeholder="(11) 99999-9999"
                  value={completedReceipt.phone}
                  onChange={(e) =>
                    setCompletedReceipt((prev) =>
                      prev ? { ...prev, phone: formatPhone(e.target.value), phoneSaved: false } : null
                    )
                  }
                  className="flex-1 bg-white dark:bg-[#160e2b] border border-gray-200 dark:border-purple-800 rounded-xl px-3 py-2 text-xs font-bold text-gray-900 dark:text-white outline-none"
                />
                {onUpdateSaleContact && normalizePhone(completedReceipt.phone).length >= 8 && !completedReceipt.phoneSaved && (
                  <button
                    type="button"
                    onClick={handleSaveReceiptPhone}
                    disabled={isSavingReceiptPhone}
                    className="bg-purple-900 hover:bg-purple-800 text-white px-3 py-2 rounded-xl text-[10px] font-black uppercase shrink-0 disabled:opacity-50"
                  >
                    {isSavingReceiptPhone ? '...' : 'Salvar'}
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <a
                href={getSaleWhatsAppReceiptLink(completedReceipt.sale, settings, completedReceipt.phone)}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-2xl font-black text-xs uppercase shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <i className="fa-brands fa-whatsapp text-lg"></i> Enviar Comprovante WhatsApp
              </a>

              <button
                type="button"
                onClick={() => printSaleThermalReceipt(completedReceipt.sale, settings)}
                className="w-full bg-purple-50 dark:bg-purple-950/40 text-purple-900 dark:text-purple-200 border border-purple-200 dark:border-purple-800 py-3.5 rounded-2xl font-black text-xs uppercase hover:bg-purple-100 transition-all flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-print"></i> Imprimir Recibo Térmico
              </button>

              <button
                type="button"
                onClick={() => setCompletedReceipt(null)}
                className="w-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 py-3.5 rounded-2xl font-black text-xs uppercase hover:bg-gray-200 transition-all active:scale-95 mt-2"
              >
                Nova Venda
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SalesView;
