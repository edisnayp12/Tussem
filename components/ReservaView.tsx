import React, { useState } from 'react';
import { Product, AppSettings, PaymentMethod } from '../types';
import { PWAInstallButton } from './PWAInstallButton';

interface ReservaViewProps {
  products: Product[];
  settings: AppSettings;
  onReserve: (data: any) => Promise<void>;
}

const ReservaView: React.FC<ReservaViewProps> = ({ products, settings, onReserve }) => {
  const [cart, setCart] = useState<any[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [isFinishing, setIsFinishing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('Todos');

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
          alert("Estoque insuficiente!");
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
           alert("Estoque insuficiente!");
           return item;
        }
        return { ...item, quantidade: newQ, subtotal: newQ * item.preco_unitario };
      }
      return item;
    }));
  };

  const total = cart.reduce((acc, item) => acc + item.subtotal, 0);

  const handleFinish = async () => {
    if (cart.length === 0) return alert("Adicione produtos!");
    if (!paymentMethod) return alert("Selecione uma forma de pagamento!");
    if (!customerName.trim()) return alert("Digite o seu nome!");
    if (!customerPhone.trim()) return alert("Digite o seu telefone para contato!");

    setIsProcessing(true);
    try {
      await onReserve({
        items: cart,
        paymentMethod,
        total,
        customerName: customerName.trim(),
        telefone_comprador: customerPhone.trim(),
        tipo_pedido: 'reserva'
      });
      alert("Reserva realizada com sucesso!");
      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setPaymentMethod(null);
      setIsFinishing(false);
    } catch (e: any) {
      alert("Erro: " + e.message);
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
      <div className={`fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity ${isFinishing ? 'opacity-100 visible' : 'opacity-0 invisible'} md:relative md:opacity-100 md:visible md:w-[400px] md:bg-white md:border-l md:border-gray-100 md:shadow-2xl flex flex-col h-screen`}>
         <div className={`absolute bottom-0 w-full h-[85vh] bg-white rounded-t-[40px] p-6 flex flex-col md:relative md:h-full md:rounded-none md:p-8 transition-transform duration-500 ${isFinishing ? 'translate-y-0' : 'translate-y-full md:translate-y-0'}`}>
            <div className="flex justify-between items-center mb-6 md:hidden">
              <h2 className="text-xl font-black text-purple-950 uppercase">Sua Reserva</h2>
              <button onClick={() => setIsFinishing(false)} className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-500">
                <i className="fa-solid fa-times"></i>
              </button>
            </div>

            <div className="hidden md:block mb-6">
              <h2 className="text-xl font-black text-purple-950 uppercase">Sua Reserva</h2>
              <p className="text-[10px] text-gray-400 font-bold uppercase mt-1 tracking-widest">{cart.length} itens</p>
            </div>

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
                <div className="h-full flex flex-col items-center justify-center text-gray-300 gap-4 opacity-50">
                  <i className="fa-solid fa-basket-shopping text-5xl"></i>
                  <p className="text-xs font-black uppercase tracking-widest">Nenhum item selecionado</p>
                </div>
              )}
            </div>

            {cart.length > 0 && (
              <div className="mt-6 pt-6 border-t border-gray-100 space-y-4">
                <input 
                  type="text" 
                  placeholder="SEU NOME COMPLETO" 
                  value={customerName} 
                  onChange={e => setCustomerName(e.target.value)} 
                  className="w-full bg-gray-50 border-none rounded-2xl px-5 py-4 font-black uppercase text-xs text-purple-950 placeholder-gray-400" 
                />
                <input 
                  type="tel" 
                  placeholder="SEU TELEFONE (WHATSAPP)" 
                  value={customerPhone} 
                  onChange={e => setCustomerPhone(e.target.value)} 
                  className="w-full bg-gray-50 border-none rounded-2xl px-5 py-4 font-black uppercase text-xs text-purple-950 placeholder-gray-400" 
                />

                <div className="grid grid-cols-2 gap-2">
                   <button 
                     onClick={() => setPaymentMethod(PaymentMethod.PIX)}
                     className={`py-3 rounded-xl text-[10px] font-black uppercase transition-all ${paymentMethod === PaymentMethod.PIX ? 'bg-purple-900 text-white shadow-lg' : 'bg-gray-100 text-gray-500'}`}
                   >
                     PIX
                   </button>
                   <button 
                     onClick={() => setPaymentMethod(PaymentMethod.FIADO)}
                     className={`py-3 rounded-xl text-[10px] font-black uppercase transition-all ${paymentMethod === PaymentMethod.FIADO ? 'bg-purple-900 text-white shadow-lg' : 'bg-gray-100 text-gray-500'}`}
                   >
                     Fiado
                   </button>
                </div>

                <div className="bg-purple-50 p-5 rounded-3xl flex justify-between items-center mb-4 border border-purple-100">
                  <span className="text-[10px] font-black uppercase tracking-widest text-purple-900">Total</span>
                  <span className="text-3xl font-black text-purple-950">R$ {total.toFixed(2)}</span>
                </div>
                <button 
                  onClick={handleFinish} 
                  disabled={isProcessing}
                  className="w-full bg-green-500 hover:bg-green-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-green-500/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {isProcessing ? 'Processando...' : 'Confirmar Reserva'}
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
    </div>
  );
};

export default ReservaView;
