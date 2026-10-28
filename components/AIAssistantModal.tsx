import React, { useState, useRef, useEffect } from 'react';
import { Sale, Product, AppSettings, Customer } from '../types';

interface AIAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  sales: Sale[];
  products: Product[];
  fiados: Sale[];
  customers: Customer[];
  settings: AppSettings;
}

interface Message {
  sender: 'user' | 'ai';
  text: string;
  time: string;
}

export const AIAssistantModal: React.FC<AIAssistantModalProps> = ({
  isOpen,
  onClose,
  sales,
  products,
  fiados,
  customers,
  settings
}) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: 'ai',
      text: 'Olá! Sou a Inteligência Artificial da Cantina TUSEMM. Como posso te ajudar hoje com a gestão de vendas, estoque, fiados ou estratégias de lucro?',
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  if (!isOpen) return null;

  // Montar contexto atual em tempo real
  const today = new Date().toLocaleDateString('en-CA');
  const todaySales = sales.filter(s => new Date(s.created_at).toLocaleDateString('en-CA') === today);
  const totalFaturamento = todaySales.filter(s => s.status === 'pago').reduce((a, b) => a + (Number(b.valor_total) || 0), 0);
  const totalFiados = fiados.reduce((a, b) => a + (Number(b.valor_total) || 0), 0);
  const lowStock = products.filter(p => (Number(p.estoque) || 0) <= (Number(p.estoque_minimo) || 5));

  // Produtos mais vendidos
  const prodCounts: Record<string, number> = {};
  sales.forEach(s => {
    (s.itens || []).forEach(it => {
      const name = it.nome || 'Item';
      prodCounts[name] = (prodCounts[name] || 0) + (Number(it.quantidade) || 1);
    });
  });
  const topProducts = Object.entries(prodCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, qtd]) => `${name} (${qtd} un)`);

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text || isLoading) return;

    const userMsg: Message = {
      sender: 'user',
      text,
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: text,
          context: {
            cantinaName: settings.cantinaName,
            salesCount: todaySales.length,
            totalFaturamento,
            fiadosCount: fiados.length,
            totalFiados,
            lowStockCount: lowStock.length,
            lowStockNames: lowStock.map(p => p.nome),
            topProducts,
            customersCount: customers.length
          }
        })
      });

      const data = await response.json();
      const aiMsg: Message = {
        sender: 'ai',
        text: data.answer || 'Desculpe, não consegui processar a resposta no momento.',
        time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          sender: 'ai',
          text: `Erro ao conectar com a IA: ${err.message || 'Verifique a conexão com a internet.'}`,
          time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const quickPrompts = [
    { label: '📊 Diagnóstico do Dia', prompt: 'Faça um diagnóstico rápido das vendas e faturamento de hoje com sugestões práticas.' },
    { label: '⚠️ Cobrança de Fiados', prompt: 'Qual a situação atual dos fiados e como você recomenda agir com quem está com débitos em aberto?' },
    { label: '📦 Sugestão de Estoque', prompt: 'Quais itens estão com estoque crítico ou merecem reposição urgente antes do próximo pico?' },
    { label: '💡 Ideias de Promoções', prompt: 'Sugira 3 ideias de combos ou ações promocionais para aumentar o ticket médio da cantina esta semana.' }
  ];

  return (
    <div className="fixed inset-0 bg-black/80 z-[120] flex items-center justify-center p-3 sm:p-4 backdrop-blur-md animate-in fade-in">
      <div className="bg-white dark:bg-[#160e2b] rounded-[32px] sm:rounded-[40px] w-full max-w-2xl h-[85vh] max-h-[700px] shadow-2xl flex flex-col border border-purple-200 dark:border-purple-900/50 overflow-hidden">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-950 via-purple-900 to-indigo-950 p-4 sm:p-5 text-white flex justify-between items-center border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-400 to-purple-400 p-0.5 shadow-lg flex items-center justify-center">
              <div className="w-full h-full bg-[#180d33] rounded-[14px] flex items-center justify-center text-amber-300 text-lg">
                <i className="fa-solid fa-wand-magic-sparkles"></i>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-sm uppercase tracking-wider">Super IA TUSEMM</h3>
                <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">Online</span>
              </div>
              <p className="text-[9px] text-purple-200/70 font-semibold uppercase tracking-wider">Co-piloto Estratégico & Cloud</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all active:scale-95"
          >
            <i className="fa-solid fa-xmark text-sm"></i>
          </button>
        </div>

        {/* Quick Action Chips */}
        <div className="p-3 bg-purple-50/70 dark:bg-[#120a22] border-b border-purple-100 dark:border-purple-900/30 flex gap-2 overflow-x-auto scrollbar-none flex-shrink-0">
          {quickPrompts.map((qp, idx) => (
            <button
              key={idx}
              onClick={() => handleSendMessage(qp.prompt)}
              disabled={isLoading}
              className="text-[10px] font-black uppercase whitespace-nowrap px-3 py-1.5 rounded-xl bg-white dark:bg-[#1f133d] text-purple-900 dark:text-purple-200 border border-purple-200 dark:border-purple-800 hover:border-purple-400 transition-all active:scale-95 shadow-sm disabled:opacity-50"
            >
              {qp.label}
            </button>
          ))}
        </div>

        {/* Messages Container */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-gray-50/50 dark:bg-[#0e071c]">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl p-4 shadow-sm text-xs sm:text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.sender === 'user'
                    ? 'bg-purple-900 text-white rounded-br-none'
                    : 'bg-white dark:bg-[#1c1236] text-gray-800 dark:text-purple-100 border border-gray-100 dark:border-purple-900/50 rounded-bl-none'
                }`}
              >
                {msg.text}
              </div>
              <span className="text-[8px] text-gray-400 font-bold uppercase mt-1 px-1">
                {msg.sender === 'user' ? 'Você' : 'Super IA'} • {msg.time}
              </span>
            </div>
          ))}

          {isLoading && (
            <div className="flex items-center gap-2 text-purple-600 dark:text-purple-300 p-3 bg-white dark:bg-[#1c1236] rounded-2xl w-fit border border-purple-100 dark:border-purple-900/40">
              <i className="fa-solid fa-spinner animate-spin text-sm"></i>
              <span className="text-xs font-bold">Analisando dados do negócio...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-3 sm:p-4 bg-white dark:bg-[#160e2b] border-t border-gray-100 dark:border-purple-900/40 flex items-center gap-2 flex-shrink-0">
          <input
            type="text"
            placeholder="Pergunte sobre vendas, estoque, fiados ou estratégias..."
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
            disabled={isLoading}
            className="flex-1 bg-gray-50 dark:bg-[#1f133d] border border-gray-200 dark:border-purple-900/60 rounded-2xl px-4 py-3 text-xs sm:text-sm font-semibold text-gray-800 dark:text-white outline-none focus:border-purple-600"
          />
          <button
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || isLoading}
            className="bg-purple-900 hover:bg-black text-white px-5 py-3 rounded-2xl font-black text-xs uppercase shadow-md transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2"
          >
            <span>Enviar</span>
            <i className="fa-solid fa-paper-plane text-xs"></i>
          </button>
        </div>

      </div>
    </div>
  );
};

export default AIAssistantModal;
