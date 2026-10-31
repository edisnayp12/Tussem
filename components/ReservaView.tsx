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
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return (safeStorage.getItem('cantina_theme') as 'light' | 'dark') || 'light';
    } catch {
      return 'light';
    }
  });

  // Alternar tema claro/escuro
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    safeStorage.setItem('cantina_theme', next);
    try {
      if (next === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    } catch (e) {}
  };

  // Carrega dados salvos no aparelho localmente
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
      // 1. Verifica se coincide com o celular localmente salvo
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

  const availableProducts = products.filter(p => p.ativo !== false && (p.estoque ?? 0) > 0);
  const categories = ['Todos', ...Array.from(new Set(availableProducts.map(p => p.categoria || 'Geral')))].filter(Boolean);

  const filteredProducts = activeCategory === 'Todos' 
    ? availableProducts 
    : availableProducts.filter(p => (p.categoria || 'Geral') === activeCategory);

  const getItemCount = (productId: string) => {
    const item = cart.find(i => i.produto_id === productId);
    return item ? item.quantidade : 0;
  };

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(i => i.produto_id === product.id);
      if (existing) {
        if (existing.quantidade >= product.estoque) {
          setFormError(`Estoque máximo atingido para ${product.nome}!`);
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
    }).filter(i => i.quantidade > 0));
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

      // Salva no aparelho local para a próxima reserva já vir pré-preenchida
      safeStorage.setItem(LOCAL_STORAGE_CUSTOMER_KEY, JSON.stringify({
        nome: customerName.trim(),
        telefone: formattedTel,
        telefone_limpo: clean
      }));

      // Sincroniza cliente no banco
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

  const cantinaLetter = (settings.cantinaName || 'C')[0].toUpperCase();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0d081a] text-gray-900 dark:text-gray-100 flex flex-col md:flex-row transition-colors duration-200">
      
      {/* Coluna Principal: Vitrine de Produtos */}
      <div className="flex-1 p-4 sm:p-6 md:p-8 flex flex-col min-h-screen md:h-screen md:overflow-hidden">
        
        {/* Top Header */}
        <header className="mb-4 sm:mb-6 flex justify-between items-center gap-3 bg-white dark:bg-[#160e2b] p-4 rounded-3xl border border-gray-100 dark:border-purple-900/40 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-purple-900 text-white rounded-2xl flex items-center justify-center font-black text-2xl shadow-lg rotate-3 flex-shrink-0">
              {cantinaLetter}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-purple-950 dark:text-white uppercase tracking-tight leading-none">
                  Reservas
                </h1>
                <span className="bg-purple-100 dark:bg-purple-950/80 text-purple-800 dark:text-purple-300 text-[9px] font-black uppercase px-2 py-0.5 rounded-full">
                  Online
                </span>
              </div>
              <p className="text-[10px] text-gray-500 dark:text-purple-300/70 font-bold uppercase tracking-wider mt-1">
                {settings.cantinaName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              title="Alternar Tema Claro / Escuro"
              className="w-10 h-10 rounded-2xl bg-gray-100 dark:bg-purple-950/50 hover:bg-gray-200 dark:hover:bg-purple-900/50 flex items-center justify-center text-gray-700 dark:text-amber-300 transition-all border border-gray-200 dark:border-purple-800/40"
            >
              <i className={`fa-solid ${theme === 'dark' ? 'fa-sun text-amber-300' : 'fa-moon text-purple-900'}`}></i>
            </button>
            <PWAInstallButton />
          </div>
        </header>

        {/* Notificação amigável de cliente reconhecido */}
        {customerName && (
          <div className="mb-4 bg-purple-50 dark:bg-purple-950/50 border border-purple-200 dark:border-purple-900/60 p-3 rounded-2xl flex items-center justify-between text-xs font-bold text-purple-950 dark:text-purple-200 animate-in fade-in">
            <div className="flex items-center gap-2 truncate pr-2">
              <span className="text-base">👋</span>
              <span className="truncate">Olá, <strong>{customerName}</strong>! Seus dados estão salvos.</span>
            </div>
            <button 
              onClick={() => {
                setCustomerName('');
                setCustomerPhone('');
                setAutoIdentifiedName(null);
                safeStorage.removeItem(LOCAL_STORAGE_CUSTOMER_KEY);
              }}
              className="text-[9px] uppercase tracking-wider text-purple-700 dark:text-amber-300 hover:underline flex-shrink-0 font-black"
            >
              Alterar
            </button>
          </div>
        )}

        {/* Categorias (Scroll Horizontal) */}
        <div className="flex gap-2 overflow-x-auto pb-3 mb-3 scrollbar-hide flex-shrink-0">
          {categories.map(cat => {
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 sm:px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-wider whitespace-nowrap transition-all active:scale-95 ${
                  isActive 
                    ? 'bg-purple-900 dark:bg-purple-700 text-white shadow-md shadow-purple-950/20' 
                    : 'bg-white dark:bg-[#160e2b] text-gray-500 dark:text-purple-300/80 border border-gray-100 dark:border-purple-900/40 hover:bg-purple-50 dark:hover:bg-purple-900/30'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {/* Grade de Produtos */}
        <div className="flex-1 overflow-y-auto pb-36 md:pb-6 pr-1">
          {filteredProducts.length === 0 ? (
            <div className="bg-white dark:bg-[#160e2b] rounded-3xl p-12 text-center border border-gray-100 dark:border-purple-900/40 space-y-3">
              <div className="w-16 h-16 bg-purple-50 dark:bg-purple-950/60 rounded-3xl flex items-center justify-center text-purple-900 dark:text-purple-300 text-2xl mx-auto">
                <i className="fa-solid fa-cookie-bite"></i>
              </div>
              <h3 className="font-black text-sm uppercase text-purple-950 dark:text-white">Nenhum produto disponível</h3>
              <p className="text-xs text-gray-400 dark:text-purple-300/60">
                Os itens desta categoria estão esgotados ou sendo preparados.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
              {filteredProducts.map(p => {
                const count = getItemCount(p.id);
                return (
                  <div 
                    key={p.id} 
                    className="bg-white dark:bg-[#160e2b] p-4 rounded-3xl shadow-sm border border-gray-100 dark:border-purple-900/40 hover:border-purple-300 dark:hover:border-purple-700 transition-all flex flex-col justify-between group relative overflow-hidden"
                  >
                    <div>
                      <div className="flex justify-between items-center gap-1 mb-2">
                        <span className="text-[8px] font-black bg-purple-50 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full uppercase tracking-wider truncate max-w-[90px]">
                          {p.categoria || 'Geral'}
                        </span>
                        <span className="text-[9px] font-bold text-gray-400 dark:text-gray-400">
                          Est: {p.estoque}
                        </span>
                      </div>

                      <h3 className="font-black text-gray-800 dark:text-white text-xs sm:text-sm uppercase leading-snug line-clamp-2 mt-1">
                        {p.nome}
                      </h3>
                    </div>

                    <div className="mt-4 pt-3 border-t border-gray-50 dark:border-purple-900/30 flex items-center justify-between gap-2">
                      <div>
                        <span className="text-[8px] uppercase font-bold text-gray-400 block leading-none">Preço</span>
                        <span className="font-black text-purple-700 dark:text-amber-400 text-sm sm:text-base">
                          R$ {(p.preco || 0).toFixed(2)}
                        </span>
                      </div>

                      {count > 0 ? (
                        <div className="flex items-center gap-1.5 bg-purple-50 dark:bg-purple-950/80 p-1 rounded-xl border border-purple-200 dark:border-purple-800">
                          <button
                            type="button"
                            onClick={() => updateQuantity(p.id, -1)}
                            className="w-6 h-6 rounded-lg bg-white dark:bg-[#20143a] text-purple-900 dark:text-white font-black text-xs flex items-center justify-center hover:bg-red-50 hover:text-red-600 transition-colors shadow-xs"
                          >
                            -
                          </button>
                          <span className="w-5 text-center font-black text-xs text-purple-950 dark:text-white">
                            {count}
                          </span>
                          <button
                            type="button"
                            onClick={() => addToCart(p)}
                            className="w-6 h-6 rounded-lg bg-purple-900 text-white font-black text-xs flex items-center justify-center hover:bg-black transition-colors shadow-xs"
                          >
                            +
                          </button>
                        </div>
                      ) : (
                        <button 
                          type="button"
                          onClick={() => addToCart(p)}
                          className="bg-purple-900 hover:bg-black dark:bg-purple-700 dark:hover:bg-purple-600 text-white px-3 py-2 rounded-xl font-black text-[10px] uppercase shadow-sm active:scale-95 transition-all flex items-center gap-1.5"
                        >
                          <i className="fa-solid fa-plus text-[9px]"></i>
                          <span>Adicionar</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Painel / Gaveta de Finalização da Reserva (Mobile Drawer & Desktop Sidebar) */}
      <div className={`fixed inset-0 z-50 bg-black/70 backdrop-blur-sm transition-opacity duration-300 ${
        isFinishing ? 'opacity-100 visible' : 'opacity-0 invisible'
      } md:relative md:opacity-100 md:visible md:w-[400px] md:bg-white md:dark:bg-[#160e2b] md:border-l md:border-gray-100 md:dark:border-purple-900/40 md:shadow-2xl flex flex-col h-screen`}>
        
        <div className={`absolute bottom-0 w-full max-h-[90vh] bg-white dark:bg-[#160e2b] text-gray-900 dark:text-white rounded-t-[36px] p-6 flex flex-col md:relative md:max-h-full md:h-full md:rounded-none md:p-8 transition-transform duration-300 ${
          isFinishing ? 'translate-y-0' : 'translate-y-full md:translate-y-0'
        }`}>
          
          {/* Header da Gaveta */}
          <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100 dark:border-purple-900/30">
            <div>
              <h2 className="text-xl font-black text-purple-950 dark:text-white uppercase tracking-tight">
                Sua Reserva
              </h2>
              <p className="text-[10px] text-gray-400 dark:text-purple-300/60 font-black uppercase tracking-wider">
                {cart.reduce((a, b) => a + b.quantidade, 0)} produto(s) adicionado(s)
              </p>
            </div>
            <button 
              type="button"
              onClick={() => setIsFinishing(false)} 
              className="md:hidden w-10 h-10 bg-gray-100 dark:bg-purple-950/60 rounded-full flex items-center justify-center text-gray-500 dark:text-purple-300 active:scale-90"
            >
              <i className="fa-solid fa-xmark text-sm"></i>
            </button>
          </div>

          {formError && (
            <div className="mb-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 px-3.5 py-2.5 rounded-2xl text-xs font-bold animate-in fade-in flex items-center gap-2">
              <i className="fa-solid fa-circle-exclamation text-sm"></i>
              <span>{formError}</span>
            </div>
          )}

          {/* Lista de Itens no Carrinho */}
          <div className="flex-1 overflow-y-auto min-h-0 pr-1 space-y-2.5">
            {cart.map((item, idx) => (
              <div 
                key={idx} 
                className="bg-gray-50 dark:bg-purple-950/30 p-3 rounded-2xl flex justify-between items-center border border-gray-100 dark:border-purple-900/40"
              >
                <div className="truncate pr-2">
                  <h4 className="font-black text-gray-800 dark:text-white text-xs uppercase truncate">
                    {item.nome}
                  </h4>
                  <p className="text-[10px] font-bold text-purple-700 dark:text-amber-400 mt-0.5">
                    R$ {(item.preco_unitario || 0).toFixed(2)} cada
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="flex items-center bg-white dark:bg-[#1a0f35] rounded-xl border border-gray-200 dark:border-purple-900/60 p-1">
                    <button 
                      type="button"
                      onClick={() => updateQuantity(item.produto_id, -1)} 
                      className="w-6 h-6 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-purple-900/50 font-black text-xs flex items-center justify-center"
                    >
                      -
                    </button>
                    <span className="w-5 text-center font-black text-xs text-purple-950 dark:text-white">
                      {item.quantidade}
                    </span>
                    <button 
                      type="button"
                      onClick={() => updateQuantity(item.produto_id, 1)} 
                      className="w-6 h-6 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-purple-900/50 font-black text-xs flex items-center justify-center"
                    >
                      +
                    </button>
                  </div>

                  <button 
                    type="button"
                    onClick={() => removeFromCart(item.produto_id)} 
                    className="w-7 h-7 flex items-center justify-center text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-xl transition-all"
                  >
                    <i className="fa-solid fa-trash-can text-xs"></i>
                  </button>
                </div>
              </div>
            ))}

            {cart.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-gray-300 dark:text-purple-400/40 gap-3 py-10 text-center">
                <i className="fa-solid fa-basket-shopping text-4xl"></i>
                <p className="text-xs font-black uppercase tracking-wider text-gray-400 dark:text-purple-300/60">
                  Sua cesta está vazia
                </p>
                <p className="text-[10px] text-gray-400 dark:text-purple-400/60 max-w-[200px]">
                  Escolha os produtos na vitrine ao lado para montar sua reserva.
                </p>
              </div>
            )}
          </div>

          {/* Dados do Cliente e Fechamento */}
          {cart.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-purple-900/40 space-y-3 flex-shrink-0">
              
              {/* Telefone */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[9px] font-black uppercase tracking-wider text-purple-900 dark:text-purple-300 ml-1">
                    WhatsApp / Telefone
                  </label>
                  {autoIdentifiedName && (
                    <span className="text-[8px] font-black uppercase bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">
                      ✓ Identificado
                    </span>
                  )}
                </div>
                <input 
                  type="tel" 
                  placeholder="(DDD) 99999-9999" 
                  value={customerPhone} 
                  onChange={e => handlePhoneChange(e.target.value)} 
                  className="w-full bg-gray-50 dark:bg-purple-950/40 border border-gray-200 dark:border-purple-900/60 focus:border-purple-500 rounded-2xl px-4 py-3 font-bold text-xs text-gray-900 dark:text-white placeholder-gray-400 outline-none transition-all" 
                />
              </div>

              {/* Nome */}
              <div>
                <label className="text-[9px] font-black uppercase tracking-wider text-purple-900 dark:text-purple-300 ml-1 mb-1 block">
                  Seu Nome
                </label>
                <input 
                  type="text" 
                  placeholder="Nome e Sobrenome" 
                  value={customerName} 
                  onChange={e => {
                    setCustomerName(e.target.value);
                    setFormError(null);
                  }} 
                  className="w-full bg-gray-50 dark:bg-purple-950/40 border border-gray-200 dark:border-purple-900/60 focus:border-purple-500 rounded-2xl px-4 py-3 font-bold uppercase text-xs text-gray-900 dark:text-white placeholder-gray-400 outline-none transition-all" 
                />
              </div>

              {/* Forma de Pagamento */}
              <div>
                <label className="text-[9px] font-black uppercase tracking-wider text-purple-900 dark:text-purple-300 ml-1 mb-1 block">
                  Pagamento da Reserva
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button 
                    type="button"
                    onClick={() => setPaymentMethod(PaymentMethod.PIX)}
                    className={`py-3 rounded-2xl text-[10px] font-black uppercase transition-all flex items-center justify-center gap-2 border ${
                      paymentMethod === PaymentMethod.PIX 
                        ? 'bg-purple-900 text-white border-purple-900 shadow-md' 
                        : 'bg-gray-50 dark:bg-purple-950/40 text-gray-700 dark:text-purple-200 border-gray-200 dark:border-purple-900/60 hover:bg-gray-100'
                    }`}
                  >
                    <i className="fa-brands fa-pix text-emerald-400"></i> PIX
                  </button>
                  <button 
                    type="button"
                    onClick={() => setPaymentMethod(PaymentMethod.FIADO)}
                    className={`py-3 rounded-2xl text-[10px] font-black uppercase transition-all flex items-center justify-center gap-2 border ${
                      paymentMethod === PaymentMethod.FIADO 
                        ? 'bg-purple-900 text-white border-purple-900 shadow-md' 
                        : 'bg-gray-50 dark:bg-purple-950/40 text-gray-700 dark:text-purple-200 border-gray-200 dark:border-purple-900/60 hover:bg-gray-100'
                    }`}
                  >
                    <i className="fa-solid fa-clock text-amber-400"></i> Fiado
                  </button>
                </div>
              </div>

              {/* Total Card */}
              <div className="bg-purple-50 dark:bg-purple-950/60 p-4 rounded-2xl flex justify-between items-center border border-purple-100 dark:border-purple-900/60">
                <span className="text-[9px] font-black uppercase tracking-widest text-purple-900 dark:text-purple-300">
                  Total da Reserva
                </span>
                <span className="text-xl font-black text-purple-950 dark:text-amber-400">
                  R$ {total.toFixed(2)}
                </span>
              </div>

              {/* Botão de Envio */}
              <button 
                type="button"
                onClick={handleFinish} 
                disabled={isProcessing}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-2xl font-black uppercase tracking-wider shadow-lg shadow-emerald-600/20 active:scale-95 transition-all disabled:opacity-50 text-xs flex items-center justify-center gap-2"
              >
                {isProcessing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Gravando Reserva...</span>
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-circle-check text-sm"></i>
                    <span>Confirmar Reserva</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Barra Flutuante Mobile para Ver Carrinho */}
      {!isFinishing && cart.length > 0 && (
        <div className="md:hidden fixed bottom-4 left-4 right-4 z-40 animate-in slide-in-from-bottom-6">
          <button 
            type="button"
            onClick={() => setIsFinishing(true)}
            className="w-full bg-gradient-to-r from-purple-900 via-purple-800 to-purple-950 text-white p-4 rounded-3xl shadow-2xl flex justify-between items-center font-black uppercase active:scale-95 transition-all border border-purple-500/30"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-amber-400 text-purple-950 rounded-xl flex items-center justify-center text-xs font-black shadow-inner">
                {cart.reduce((a, b) => a + b.quantidade, 0)}
              </div>
              <span className="text-xs tracking-wider">Ver Reserva</span>
            </div>
            <span className="text-base text-amber-300">R$ {total.toFixed(2)}</span>
          </button>
        </div>
      )}

      {/* Modal de Confirmação de Sucesso */}
      {successInfo && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-[#160e2b] rounded-[36px] p-6 sm:p-8 max-w-sm w-full shadow-2xl text-center space-y-4 border border-purple-200 dark:border-purple-900/60 animate-in zoom-in-95">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-950 text-green-600 dark:text-green-300 rounded-3xl flex items-center justify-center text-3xl mx-auto shadow-inner">
              <i className="fa-solid fa-check"></i>
            </div>
            <h3 className="text-xl font-black text-purple-950 dark:text-white uppercase tracking-tight">
              Reserva Confirmada!
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed font-bold">
              Obrigado, <strong className="text-purple-900 dark:text-amber-300">{successInfo.customer}</strong>! Seu pedido de <strong className="text-green-600 dark:text-green-400">R$ {successInfo.total.toFixed(2)}</strong> já foi enviado para a cozinha da cantina.
            </p>
            <div className="text-[10px] text-gray-500 dark:text-purple-300/80 bg-purple-50 dark:bg-purple-950/60 p-3 rounded-2xl border border-purple-100 dark:border-purple-900/40 font-bold">
              Seus dados foram memorizados neste aparelho. Na sua próxima reserva, seu nome será preenchido automaticamente!
            </div>
            <button 
              type="button"
              onClick={() => setSuccessInfo(null)}
              className="w-full bg-purple-900 dark:bg-purple-700 text-white py-4 rounded-2xl font-black uppercase tracking-wider text-xs shadow-lg hover:bg-black transition-all"
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
