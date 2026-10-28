import React, { useState, useEffect } from 'react';
import { Product, AppSettings, PaymentMethod } from '../types';
import { PWAInstallButton } from './PWAInstallButton';
import { db } from '../services/firebaseService';
import { normalizePhone, formatPhone } from '../utils/phoneUtils';
import { safeStorage } from '../utils/safeStorage';

interface ReservaViewProps {
  products: Product[];
  settings: AppSettings;
  onReserve: (data: any) => Promise<void>;
}

const LOCAL_STORAGE_CUSTOMER_KEY = 'cantina_reserva_customer';

const ReservaView: React.FC<ReservaViewProps> = ({ products, settings, onReserve }) => {
  const [cart, setCart] = useState<any[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [isFinishing, setIsFinishing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('Todos');
  const [autoIdentifiedName, setAutoIdentifiedName] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ total: number; customer: string } | null>(null);

  // Carrega dados salvos no próprio aparelho/celular na inicialização
  useEffect(() => {
    try {
      const saved = safeStorage.getItem(LOCAL_STORAGE_CUSTOMER_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.nome) setCustomerName(parsed.nome);
        if (parsed.telefone) setCustomerPhone(parsed.telefone);
        if (parsed.nome) setAutoIdentifiedName(parsed.nome);
      }
    } catch (e) {
      console.warn("Erro ao ler dados locais de reserva:", e);
    }
  }, []);

  // Busca automática do cliente ao digitar o número de telefone (com ou sem separação)
  const handlePhoneChange = async (val: string) => {
    setCustomerPhone(val);
    setFormError(null);
    const cleanDigits = normalizePhone(val);

    if (cleanDigits.length >= 10) {
      // 1. Primeiro verifica se coincide com o celular localmente salvo
      try {
        const saved = safeStorage.getItem(LOCAL_STORAGE_CUSTOMER_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          const savedClean = normalizePhone(parsed.telefone);
          if (savedClean && (savedClean === cleanDigits || cleanDigits.endsWith(savedClean) || savedClean.endsWith(cleanDigits))) {
            if (parsed.nome) {
              setCustomerName(parsed.nome);
              setAutoIdentifiedName(parsed.nome);
              return;
            }
          }
        }
      } catch (e) {}

      // 2. Busca no banco de dados centralizado do Firestore
      try {
        const found = await db.getCustomerByPhone(cleanDigits);
        if (found && found.nome) {
          setCustomerName(found.nome);
          setAutoIdentifiedName(found.nome);
        }
      } catch (e) {
        console.warn("Erro ao buscar cliente por telefone:", e);
      }
    } else {
      if (!val) setAutoIdentifiedName(null);
    }
  };

  const availableProducts = products.filter(p => p.ativo && p.estoque > 0);
  const categories = ['Todos', ...Array.from(new Set(availableProducts.map(p => p.categoria)))].filter(Boolean);

  const filteredProducts = activeCategory === 'Todos' 
    ? availableProducts 
    : availableProducts.filter(p => p.categoria === activeCategory);

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(i => i.produto_id === product.id);
      if (existing) {
        if (existing.quantidade >= product.estoque) {
          setFormError(`Estoque insuficiente de ${product.nome}!`);
          return prev;
        }
        return prev.map(i => i.produto_id === product.id ? { ...i, quantidade: i.quantidade + 1, subtotal: (i.quantidade + 1) * i.preco_unitario } : i);
      }
      return [...prev, { produto_id: product.id, nome: product.nome, preco_unitario: product.preco, quantidade: 1, subtotal: product.preco }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.produto_id !== productId));
  };

  const updateQuantity = (productId: string, delta: number) => {
    const product = products.find(p => p.id === productId);
    setCart(prev => prev.map(item => {
      if (item.produto_id === productId) {
        const newQ = item.quantidade + delta;
        if (newQ < 1) return item;
        if (product && newQ > product.estoque) {
          setFormError(`Estoque insuficiente de ${product.nome}!`);
          return item;
        }
        return { ...item, quantidade: newQ, subtotal: newQ * item.preco_unitario };
      }
      return item;
    }));
  };

  const total = cart.reduce((acc, item) => acc + item.subtotal, 0);

  const handleFinish = async () => {
    setFormError(null);
    if (cart.length === 0) {
      setFormError("Adicione pelo menos um produto para reservar!");
      return;
    }
    if (!paymentMethod) {
      setFormError("Selecione a forma de pagamento (PIX ou Fiado)!");
      return;
    }
    if (!customerName.trim()) {
      setFormError("Por favor, digite o seu nome!");
      return;
    }
    if (!customerPhone.trim()) {
      setFormError("Por favor, digite o seu telefone / WhatsApp!");
      return;
    }

    const clean = normalizePhone(customerPhone);
    if (clean.length < 8) {
      setFormError("Número de telefone incompleto! Digite o DDD e o número.");
      return;
    }

    setIsProcessing(true);
    try {
      const formattedTel = formatPhone(clean) || customerPhone.trim();

      await onReserve({
        items: cart,
        paymentMethod,
        total,
        customerName: customerName.trim(),
        telefone_comprador: formattedTel,
        tipo_pedido: 'reserva'
      });

      // Salva no aparelho local (safeStorage) para a próxima reserva já vir pré-preenchida
      safeStorage.setItem(LOCAL_STORAGE_CUSTOMER_KEY, JSON.stringify({
        nome: customerName.trim(),
        telefone: formattedTel,
        telefone_limpo: clean
      }));

      // Garante também o salvamento imediato na coleção de clientes do banco
      db.saveOrUpdateCustomer({
        nome: customerName.trim(),
        telefone: clean,
        valorAdicional: total,
        origem: 'reserva'
      }).catch(err => console.warn("Aviso cadastro cliente:", err));

      setSuccessInfo({
        total,
        customer: customerName.trim()
      });

      setCart([]);
      setPaymentMethod(null);
      setIsFinishing(false);
    } catch (e: any) {
      setFormError("Erro ao registrar reserva: " + (e.message || "Tente novamente"));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
      <div className="flex-1 p-6 md:p-10 flex flex-col h-screen overflow-hidden">
        <div className="mb-6 flex justify-between items-center gap-4">
           <div className="flex items-center gap-4">
             <div className="w-12 h-12 bg-purple-900 text-white rounded-2xl flex items-center justify-center font-black text-2xl shadow-xl rotate-3">
               {settings.cantinaName[0]}
             </div>
             <div>
               <h1 className="text-2xl font-black text-purple-950 uppercase tracking-tighter">Reservas</h1>
               <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">{settings.cantinaName}</p>
             </div>
           </div>
           <PWAInstallButton />
        </div>

        {/* Notificação de boas-vindas caso já tenha dados salvos */}
        {customerName && (
          <div className="mb-4 bg-purple-50 border border-purple-200 p-3 rounded-2xl flex items-center justify-between text-xs text-purple-950 font-bold">
            <div className="flex items-center gap-2">
              <span className="text-base">👋</span>
              <span>Olá, <strong>{customerName}</strong>! Seus dados de reserva estão salvos neste aparelho.</span>
            </div>
            <button 
              onClick={() => {
                setCustomerName('');
                setCustomerPhone('');
                setAutoIdentifiedName(null);
                safeStorage.removeItem(LOCAL_STORAGE_CUSTOMER_KEY);
              }}
              className="text-[9px] uppercase tracking-wider text-purple-700 hover:underline ml-2"
            >
              Trocar
            </button>
          </div>
        )}

        <div className="flex gap-2 overflow-x-auto pb-4 mb-4 scrollbar-hide flex-shrink-0">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all active:scale-95 ${
                activeCategory === cat ? 'bg-purple-900 text-white shadow-xl scale-105' : 'bg-white text-gray-400 hover:bg-purple-50 hover:text-purple-600 shadow-sm'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto pb-32 md:pb-6 pr-2">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredProducts.map(p => (
              <button 
                key={p.id} 
                onClick={() => addToCart(p)}
                className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-start hover:border-purple-200 transition-all active:scale-95 text-left group"
              >
                <div className="w-full flex justify-between items-start mb-4">
                  <span className="text-[9px] font-black bg-purple-50 text-purple-600 px-3 py-1 rounded-full uppercase tracking-widest">{p.categoria}</span>
                  <span className="text-[10px] font-bold text-gray-400">Estq: {p.estoque}</span>
                </div>
                <h3 className="font-black text-gray-800 text-sm uppercase leading-tight group-hover:text-purple-700 transition-colors">{p.nome}</h3>
                <p className="font-black text-purple-600 text-lg mt-auto pt-4">R$ {p.preco.toFixed(2)}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Cart Panel */}
      <div className={`fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity ${isFinishing ? 'opacity-100 visible' : 'opacity-0 invisible'} md:relative md:opacity-100 md:visible md:w-[420px] md:bg-white md:border-l md:border-gray-100 md:shadow-2xl flex flex-col h-screen`}>
         <div className={`absolute bottom-0 w-full h-[88vh] bg-white rounded-t-[40px] p-6 flex flex-col md:relative md:h-full md:rounded-none md:p-8 transition-transform duration-500 ${isFinishing ? 'translate-y-0' : 'translate-y-full md:translate-y-0'}`}>
            <div className="flex justify-between items-center mb-6 md:hidden">
              <h2 className="text-xl font-black text-purple-950 uppercase">Sua Reserva</h2>
              <button onClick={() => setIsFinishing(false)} className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-500">
                <i className="fa-solid fa-times"></i>
              </button>
            </div>

            <div className="hidden md:block mb-6">
              <h2 className="text-xl font-black text-purple-950 uppercase">Sua Reserva</h2>
              <p className="text-[10px] text-gray-400 font-bold uppercase mt-1 tracking-widest">{cart.length} itens no pedido</p>
            </div>

            {formError && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-2xl text-xs font-bold animate-in fade-in">
                ⚠️ {formError}
              </div>
            )}

            <div className="flex-1 overflow-y-auto min-h-0 pr-2 space-y-3">
              {cart.map((item, idx) => (
                <div key={idx} className="bg-gray-50 p-4 rounded-2xl flex justify-between items-center border border-gray-100">
                  <div>
                    <h4 className="font-black text-gray-800 text-xs uppercase">{item.nome}</h4>
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
              ))}
              {cart.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-gray-300 gap-4 opacity-50 py-12">
                  <i className="fa-solid fa-basket-shopping text-5xl"></i>
                  <p className="text-xs font-black uppercase tracking-widest">Nenhum item selecionado</p>
                </div>
              )}
            </div>

            {cart.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                {/* Campo de Telefone com identificação automática */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[9px] font-black uppercase tracking-wider text-purple-900 ml-1">
                      Telefone / WhatsApp
                    </label>
                    {autoIdentifiedName && (
                      <span className="text-[8px] font-black uppercase bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                        ✓ Cliente Identificado
                      </span>
                    )}
                  </div>
                  <input 
                    type="tel" 
                    placeholder="Ex: (11) 98765-4321 ou 11987654321" 
                    value={customerPhone} 
                    onChange={e => handlePhoneChange(e.target.value)} 
                    className="w-full bg-gray-50 border-2 border-transparent focus:border-purple-200 rounded-2xl px-5 py-3.5 font-black text-xs text-purple-950 placeholder-gray-400 outline-none" 
                  />
                  <p className="text-[8px] text-gray-400 mt-1 ml-1 font-bold">
                    Pode digitar com ou sem traço/espaço. O sistema identifica automaticamente.
                  </p>
                </div>

                {/* Campo de Nome (preenchido automaticamente caso já exista) */}
                <div>
                  <label className="text-[9px] font-black uppercase tracking-wider text-purple-900 ml-1 mb-1 block">
                    Nome Completo
                  </label>
                  <input 
                    type="text" 
                    placeholder="SEU NOME COMPLETO" 
                    value={customerName} 
                    onChange={e => {
                      setCustomerName(e.target.value);
                      setFormError(null);
                    }} 
                    className="w-full bg-gray-50 border-2 border-transparent focus:border-purple-200 rounded-2xl px-5 py-3.5 font-black uppercase text-xs text-purple-950 placeholder-gray-400 outline-none" 
                  />
                </div>

                {/* Forma de Pagamento */}
                <div>
                  <label className="text-[9px] font-black uppercase tracking-wider text-purple-900 ml-1 mb-1 block">
                    Forma de Pagamento
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                     <button 
                       type="button"
                       onClick={() => setPaymentMethod(PaymentMethod.PIX)}
                       className={`py-3 rounded-xl text-[10px] font-black uppercase transition-all flex items-center justify-center gap-2 ${paymentMethod === PaymentMethod.PIX ? 'bg-purple-900 text-white shadow-lg scale-102' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                     >
                       <i className="fa-brands fa-pix"></i> PIX
                     </button>
                     <button 
                       type="button"
                       onClick={() => setPaymentMethod(PaymentMethod.FIADO)}
                       className={`py-3 rounded-xl text-[10px] font-black uppercase transition-all flex items-center justify-center gap-2 ${paymentMethod === PaymentMethod.FIADO ? 'bg-purple-900 text-white shadow-lg scale-102' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                     >
                       <i className="fa-solid fa-clock"></i> Fiado
                     </button>
                  </div>
                </div>

                <div className="bg-purple-50 p-4 rounded-2xl flex justify-between items-center border border-purple-100">
                  <span className="text-[9px] font-black uppercase tracking-widest text-purple-900">Total Reserva</span>
                  <span className="text-2xl font-black text-purple-950">R$ {total.toFixed(2)}</span>
                </div>

                <button 
                  onClick={handleFinish} 
                  disabled={isProcessing}
                  className="w-full bg-green-500 hover:bg-green-600 text-white py-4 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-green-500/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-xs flex items-center justify-center gap-2"
                >
                  {isProcessing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Registrando Reserva...</span>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-check"></i>
                      <span>Confirmar Reserva</span>
                    </>
                  )}
                </button>
              </div>
            )}
         </div>
      </div>

      {/* Mobile Cart Toggle */}
      {!isFinishing && cart.length > 0 && (
        <div className="md:hidden fixed bottom-6 left-6 right-6 z-40">
          <button 
            onClick={() => setIsFinishing(true)}
            className="w-full bg-purple-900 text-white p-5 rounded-3xl shadow-2xl flex justify-between items-center font-black uppercase animate-in slide-in-from-bottom-10"
          >
            <div className="flex items-center gap-3">
               <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
                 {cart.length}
               </div>
               <span className="text-xs tracking-widest">Ver Reserva</span>
            </div>
            <span className="text-lg">R$ {total.toFixed(2)}</span>
          </button>
        </div>
      )}

      {/* Modal de Confirmação de Sucesso */}
      {successInfo && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center space-y-4 animate-in zoom-in-95">
            <div className="w-16 h-16 bg-green-100 text-green-600 rounded-3xl flex items-center justify-center text-3xl mx-auto shadow-inner">
              ✓
            </div>
            <h3 className="text-xl font-black text-purple-950 uppercase tracking-tight">
              Reserva Confirmada!
            </h3>
            <p className="text-xs text-gray-600 leading-relaxed font-bold">
              Obrigado, <strong className="text-purple-900">{successInfo.customer}</strong>! Sua reserva no valor de <strong className="text-green-600">R$ {successInfo.total.toFixed(2)}</strong> foi registrada com sucesso.
            </p>
            <p className="text-[10px] text-gray-400 bg-purple-50 p-3 rounded-xl border border-purple-100 font-bold">
              Seus dados foram salvos neste aparelho. Na sua próxima reserva, seu nome será preenchido automaticamente!
            </p>
            <button 
              onClick={() => setSuccessInfo(null)}
              className="w-full bg-purple-900 text-white py-4 rounded-2xl font-black uppercase tracking-wider text-xs shadow-lg hover:bg-black transition-all"
            >
              Fazer Outra Reserva
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReservaView;
