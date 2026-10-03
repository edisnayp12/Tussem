
import React, { useState, useMemo, useEffect } from 'react';
import { Product, SaleItem, PaymentMethod, Sale, Category, AppSettings } from '../types';
import Scanner from './Scanner';
import { QRCodeSVG } from 'qrcode.react';
import { generateStaticPix } from '../services/pix';

interface SalesViewProps {
  products: Product[];
  settings: AppSettings;
  onCompleteSale: (sale: any) => Promise<void>;
}

const SalesView: React.FC<SalesViewProps> = ({ products, settings, onCompleteSale }) => {
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('Todos');
  const [isFinishing, setIsFinishing] = useState(false);
  const [pixQrCode, setPixQrCode] = useState<string | null>(null);
  const [pixPaymentId, setPixPaymentId] = useState<string | null>(null);
  const [isPollingPix, setIsPollingPix] = useState(false);

  const cartTotal = useMemo(() => cart.reduce((acc, item) => acc + ((item.preco_unitario || 0) * (item.quantidade || 0)), 0), [cart]);

  const filteredProducts = products.filter(p => {
    // Fix: Property 'codigo' does not exist on type 'Product'. Now fixed in types.ts.
    const productName = p.nome || '';
    const productCode = p.codigo || p.codigo_barras || '';
    const matchesSearch = productName.toLowerCase().includes(searchTerm.toLowerCase()) || productCode.includes(searchTerm);
    const matchesCategory = activeCategory === 'Todos' || p.categoria === activeCategory;
    const isActivo = p.ativo !== false;
    return matchesSearch && matchesCategory && isActivo;
  });

  const addToCart = (product: Product) => {
    // Fix: Property 'estoque_atual' does not exist on type 'Product'. Using 'estoque'.
    if (product.estoque <= 0) {
      alert(`Ops! ${product.nome} está sem estoque.`);
      return;
    }
    setCart(prev => {
      const existing = prev.find(item => item.produto_id === product.id);
      // Fix: Property 'estoque_atual' does not exist on type 'Product'. Using 'estoque'.
      if (existing && existing.quantidade >= product.estoque) {
        alert("Quantidade limitada ao estoque disponível.");
        return prev;
      }
      if (existing) {
        return prev.map(item => item.produto_id === product.id ? { ...item, quantidade: item.quantidade + 1, subtotal: (item.quantidade + 1) * (item.preco_unitario || 0) } : item);
      }
      return [...prev, { produto_id: product.id, nome: product.nome, preco_unitario: product.preco || 0, quantidade: 1, subtotal: product.preco || 0 }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.produto_id !== productId));
  };

  const updateQuantity = (productId: string, delta: number) => {
    const product = products.find(p => p.id === productId);
    setCart(prev => prev.map(item => {
      if (item.produto_id === productId) {
        const newQty = item.quantidade + delta;
        // Fix: Property 'estoque_atual' does not exist on type 'Product'. Using 'estoque'.
        if (newQty > (product?.estoque || 0)) {
           alert("Estoque máximo atingido.");
           return item;
        }
        const finalQty = Math.max(1, newQty);
        return { ...item, quantidade: finalQty, subtotal: finalQty * item.preco_unitario };
      }
      return item;
    }));
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPollingPix && pixPaymentId && settings.mercadoPagoToken) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/mercadopago/payment/${pixPaymentId}`, {
            headers: { "Authorization": `Bearer ${settings.mercadoPagoToken}` }
          });
          const data = await res.json();
          if (data.status === 'approved') {
            setIsPollingPix(false);
            clearInterval(interval);
            await completeSaleConfirmed();
          }
        } catch (e) {
          console.error("Erro consultando pix", e);
        }
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [isPollingPix, pixPaymentId, settings.mercadoPagoToken]);

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
  };

  const completeSaleConfirmed = async () => {
    setIsFinishing(true);
    setPixQrCode(null);
    setPixPaymentId(null);
    try {
      await onCompleteSale({
        items: cart,
        total: cartTotal,
        paymentMethod,
        customerName: paymentMethod === PaymentMethod.FIADO ? customerName.trim() : undefined,
        telefone_comprador: paymentMethod === PaymentMethod.FIADO ? customerPhone.trim() : undefined,
        isDebtPaid: paymentMethod !== PaymentMethod.FIADO
      });
      setCart([]);
      setPaymentMethod(null);
      setCustomerName('');
      setCustomerPhone('');
    } catch (e: any) {
      console.error(e);
      alert(e.message || "Erro inesperado ao finalizar venda.");
    } finally {
      setIsFinishing(false);
    }
  };

  const finalizeSale = async () => {
    if (!paymentMethod || isFinishing || cart.length === 0) return;
    
    if (paymentMethod === PaymentMethod.FIADO) {
      if (!customerName.trim()) {
        alert('Por favor, informe o nome do cliente para a venda fiada.');
        return;
      }
      const cleanPhone = customerPhone.replace(/\D/g, '');
      if (!customerPhone.trim()) {
        alert('Por favor, informe o número de telefone (WhatsApp) do cliente para a venda fiada.');
        return;
      }
      if (cleanPhone.length < 10) {
        alert('Por favor, informe um número de telefone com DDD válido (mínimo 10 dígitos) para a venda fiada.');
        return;
      }
    }
    
    if (paymentMethod === PaymentMethod.PIX) {
      if (!settings.pixModo || settings.pixModo === 'mercadopago') {
        if (!settings.mercadoPagoToken) {
          alert('Configure o token do Mercado Pago nos Ajustes!');
          return;
        }
        setIsFinishing(true);
        try {
          const res = await fetch("/api/mercadopago/pix", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transaction_amount: cartTotal,
              description: `Venda Cantina - ${cartTotal}`,
              token: settings.mercadoPagoToken
            })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Erro Mercado Pago");
          
          setPixQrCode(data.point_of_interaction.transaction_data.qr_code);
          setPixPaymentId(data.id);
          setIsPollingPix(true);
          setIsFinishing(false);
          return;
        } catch (e: any) {
          alert("Erro ao gerar PIX Automático: " + e.message + "\n\nO pagamento será confirmado manualmente.");
          // Fallback to manual will happen if completeSaleConfirmed is called directly inside a fallback flow, but here we just return to avoid double execution logic
          setIsFinishing(false);
          return;
        }
      } else {
        if (!settings.pixChave) {
           alert('Configure a Chave PIX, Titular e Cidade nos Ajustes para utilizar o PIX Manual!');
           return;
        }
        setIsFinishing(true);
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
      }
    }
    
    await completeSaleConfirmed();
  };

  // Helper para exibir o nome bonito do método
  const getMethodLabel = (method: PaymentMethod) => {
    switch(method) {
      case PaymentMethod.PIX: return 'PIX';
      case PaymentMethod.CASH: return 'Dinheiro';
      case PaymentMethod.DEBIT: return 'Débito';
      case PaymentMethod.CREDIT: return 'Crédito';
      case PaymentMethod.FIADO: return 'Fiado';
      default: return method;
    }
  };

  return (
    <>
      {pixQrCode && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-[40px] p-8 w-full max-w-sm shadow-2xl flex flex-col items-center">
            <h3 className="text-xl font-black text-purple-950 uppercase mb-4">Pagamento PIX</h3>
            <p className="text-xs text-gray-500 font-bold mb-6 text-center">
              {isPollingPix ? 'Escaneie o QR Code abaixo no app do seu banco' : 'Pagamento Manual: Confirme abaixo após o cliente escanear e pagar.'}
            </p>
            <div className="bg-gray-100 p-4 rounded-xl mb-6">
              <QRCodeSVG value={pixQrCode} size={200} />
            </div>
            <p className="text-xl font-black text-green-600 mb-6">R$ {cartTotal.toFixed(2)}</p>
            <div className="w-full space-y-3">
              <button 
                onClick={completeSaleConfirmed} 
                className="w-full bg-green-500 text-white py-4 rounded-2xl font-black text-[12px] uppercase shadow-lg hover:bg-green-600 transition-all"
              >
                Confirmar Manualmente
              </button>
              <button 
                onClick={() => { setPixQrCode(null); setIsPollingPix(false); }} 
                className="w-full bg-gray-200 text-gray-700 py-4 rounded-2xl font-black text-[12px] uppercase shadow-md hover:bg-gray-300 transition-all"
              >
                Cancelar Pagamento
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="lg:col-span-8 space-y-4">
        <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100">
           <div className="flex flex-col md:flex-row gap-4 mb-6">
              <div className="flex-1 relative">
                 <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-gray-300"></i>
                 <input
                  type="text"
                  placeholder="Nome do item ou código..."
                  className="w-full bg-gray-50 border-none rounded-2xl pl-12 pr-4 py-4 text-sm font-bold focus:ring-2 focus:ring-purple-500 transition-all outline-none"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <button onClick={() => setIsScannerOpen(true)} className="bg-purple-900 text-white w-14 h-14 flex items-center justify-center rounded-2xl shadow-lg active:scale-95 transition-all hover:bg-black">
                <i className="fa-solid fa-barcode text-xl"></i>
              </button>
           </div>
           
           <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {['Todos', ...Array.from(new Set([...Object.values(Category), ...products.map(p => p.categoria)]))].filter(Boolean).map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat as any)}
                  className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                    activeCategory === cat ? 'bg-purple-700 text-white shadow-md' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                  }`}
                >
                  {cat}
                </button>
              ))}
           </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {filteredProducts.map(product => {
            // Fix: Property 'estoque_atual' does not exist on type 'Product'. Using 'estoque'.
            const isOut = product.estoque <= 0;
            return (
              <button
                key={product.id}
                onClick={() => addToCart(product)}
                disabled={isOut}
                className={`p-4 rounded-[28px] text-left border-2 transition-all relative group overflow-hidden bg-white border-white hover:border-purple-200 hover:shadow-xl ${isOut ? 'opacity-40 cursor-not-allowed' : 'active:scale-95'}`}
              >
                <span className="text-[8px] font-black uppercase text-purple-400 tracking-tighter mb-1 block">{product.categoria}</span>
                <h4 className="text-xs font-black text-gray-800 uppercase line-clamp-2 min-h-[2.5rem] leading-tight mb-2">{product.nome}</h4>
                <div className="flex justify-between items-end">
                  <p className="text-base font-black text-purple-900">R$ {product.preco.toFixed(2)}</p>
                  {/* Fix: Property 'estoque_atual' and 'estoque_minimo' does not exist on type 'Product'. Using updated interface from types.ts. */}
                  <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-md ${(product.estoque_minimo !== undefined && product.estoque <= product.estoque_minimo) ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                    EST: {product.estoque}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="lg:col-span-4 flex flex-col gap-4">
        <div className="bg-white p-6 rounded-[40px] shadow-sm border border-gray-100 flex-1 flex flex-col sticky top-28 h-[calc(100vh-160px)]">
           <h2 className="text-xl font-black text-purple-950 uppercase tracking-tight mb-6 flex justify-between">
              Checkout
              <i className="fa-solid fa-receipt opacity-20"></i>
           </h2>

           <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-hide">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-200 py-10 opacity-60">
                   <i className="fa-solid fa-cart-shopping text-6xl mb-4"></i>
                   <p className="text-[10px] font-black uppercase tracking-widest">Carrinho Vazio</p>
                </div>
              ) : (
                cart.map(item => (
                  <div key={item.produto_id} className="flex items-center justify-between bg-gray-50/50 p-4 rounded-3xl border border-gray-100 animate-in slide-in-from-right-2">
                    <div className="flex-1">
                       <h5 className="text-[10px] font-black text-gray-800 uppercase leading-tight">{item.nome}</h5>
                       <p className="text-[9px] font-bold text-purple-500 mt-0.5">R$ {item.preco_unitario.toFixed(2)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                       <button onClick={() => removeFromCart(item.produto_id)} className="w-7 h-7 flex items-center justify-center bg-red-50 text-red-500 rounded-lg shadow-sm border border-red-100 hover:bg-red-100 transition-all mr-1">
                         <i className="fa-solid fa-trash text-[10px]"></i>
                       </button>
                       <button onClick={() => updateQuantity(item.produto_id, -1)} className="w-7 h-7 bg-white rounded-lg shadow-sm border border-gray-100 font-bold hover:bg-gray-50">-</button>
                       <span className="text-xs font-black text-gray-900 w-4 text-center">{item.quantidade}</span>
                       <button onClick={() => updateQuantity(item.produto_id, 1)} className="w-7 h-7 bg-white rounded-lg shadow-sm border border-gray-100 font-bold hover:bg-gray-50">+</button>
                    </div>
                  </div>
                ))
              )}
           </div>

           {cart.length > 0 && (
             <div className="mt-6 pt-6 border-t border-dashed border-gray-200">
                <div className="flex justify-between items-center mb-6">
                   <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Valor Total</span>
                   <span className="text-3xl font-black text-purple-950 tracking-tight">R$ {cartTotal.toFixed(2)}</span>
                </div>

                <div className="space-y-4">
                   <div className="grid grid-cols-2 gap-2">
                      {Object.values(PaymentMethod).map(method => (
                        <button
                          key={method}
                          onClick={() => setPaymentMethod(method)}
                          disabled={isFinishing}
                          className={`py-3 rounded-2xl text-[9px] font-black uppercase tracking-widest border-2 transition-all ${
                            paymentMethod === method ? 'bg-purple-900 border-purple-900 text-white shadow-xl' : 'bg-white border-gray-50 text-gray-400'
                          } ${isFinishing ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          {getMethodLabel(method)}
                        </button>
                      ))}
                   </div>

                   {paymentMethod === PaymentMethod.FIADO && (
                     <div className="bg-purple-50/70 p-4 rounded-3xl border border-purple-100 space-y-3 animate-in fade-in slide-in-from-top-2">
                       <div className="flex items-center justify-between">
                         <div className="flex items-center gap-2">
                           <span className="w-2 h-2 rounded-full bg-purple-600 animate-pulse"></span>
                           <p className="text-[10px] font-black text-purple-950 uppercase tracking-widest">
                             Dados do Cliente Fiado
                           </p>
                         </div>
                         <span className="text-[8px] font-black uppercase text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full tracking-wider">
                           Obrigatório
                         </span>
                       </div>

                       <div>
                         <label className="text-[9px] font-black uppercase text-purple-900 tracking-wider mb-1 block pl-1">
                           Nome do Cliente *
                         </label>
                         <input
                           type="text"
                           placeholder="Nome completo do cliente..."
                           className="w-full bg-white border border-purple-100 rounded-2xl px-4 py-3.5 text-xs font-bold text-purple-950 placeholder-gray-400 focus:ring-2 focus:ring-purple-500 outline-none shadow-sm"
                           value={customerName}
                           onChange={(e) => setCustomerName(e.target.value)}
                           disabled={isFinishing}
                         />
                       </div>

                       <div>
                         <label className="text-[9px] font-black uppercase text-purple-900 tracking-wider mb-1 block pl-1">
                           Telefone / WhatsApp com DDD *
                         </label>
                         <div className="relative">
                           <i className="fa-brands fa-whatsapp absolute left-4 top-1/2 -translate-y-1/2 text-green-500 text-sm"></i>
                           <input
                             type="tel"
                             placeholder="(11) 99999-9999"
                             className="w-full bg-white border border-purple-100 rounded-2xl pl-11 pr-4 py-3.5 text-xs font-bold text-purple-950 placeholder-gray-400 focus:ring-2 focus:ring-purple-500 outline-none shadow-sm"
                             value={customerPhone}
                             onChange={(e) => setCustomerPhone(formatPhone(e.target.value))}
                             disabled={isFinishing}
                           />
                         </div>
                         <p className="text-[8px] text-gray-500 mt-1 pl-1">
                           Necessário para cobranças futuras via WhatsApp.
                         </p>
                       </div>
                     </div>
                   )}

                   <button
                    onClick={finalizeSale}
                    disabled={!paymentMethod || isFinishing || cart.length === 0}
                    className={`w-full py-5 rounded-3xl font-black text-xs uppercase tracking-widest transition-all ${
                      !paymentMethod || isFinishing || cart.length === 0 ? 'bg-gray-100 text-gray-300 cursor-not-allowed' : 'bg-green-600 text-white shadow-xl active:scale-95 hover:bg-green-700'
                    }`}
                   >
                    {isFinishing ? (
                      <span className="flex items-center justify-center gap-2">
                        <i className="fa-solid fa-spinner animate-spin"></i> Processando...
                      </span>
                    ) : 'Finalizar Venda'}
                   </button>
                </div>
             </div>
           )}
        </div>
      </div>
      {isScannerOpen && <Scanner onScan={(code) => {
          // Fix: Property 'codigo' and 'codigo_barras' usage on Product.
          const product = products.find(p => p.codigo === code || p.codigo_barras === code);
          if (product) { addToCart(product); setIsScannerOpen(false); }
          else alert('Produto não encontrado com este código.');
      }} onClose={() => setIsScannerOpen(false)} />}
    </div>
    </>
  );
};

export default SalesView;
