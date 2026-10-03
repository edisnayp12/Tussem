
import React, { useState, useMemo, useEffect } from 'react';
import { Sale, PaymentMethod, AppSettings } from '../types';
import { QRCodeSVG } from 'qrcode.react';
import { generateStaticPix } from '../services/pix';

interface FiadoViewProps {
  fiados: Sale[];
  settings: AppSettings;
  onPayDebt: (pedidoId: string, method: PaymentMethod) => Promise<void>;
}

interface FiadoGroup {
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

const FiadoView: React.FC<FiadoViewProps> = ({ fiados, settings, onPayDebt }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<FiadoGroup | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pixQrCode, setPixQrCode] = useState<string | null>(null);

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
      const nome = f.cliente_nome?.trim() || 'Sem Nome';
      
      // Métrica de agrupamento:
      // Se houver telefone cadastrado (mínimo 8 dígitos), agrupa estritamente pelo número de telefone.
      // Desta forma, vendas do PDV e Reservas com o mesmo telefone caem no mesmo grupo do cliente.
      const groupKey = normPhone.length >= 8 
        ? `tel_${normPhone}` 
        : `nome_${nome.toLowerCase()}`;

      if (!grouped[groupKey]) {
        grouped[groupKey] = {
          key: groupKey,
          nome: nome,
          total: 0,
          sales: [],
          telefone: f.telefone_comprador || ''
        };
      } else {
        // Se o nome desta venda for mais completo/longo, atualiza para exibir o melhor nome
        if (nome && nome !== 'Sem Nome' && (grouped[groupKey].nome === 'Sem Nome' || nome.length > grouped[groupKey].nome.length)) {
          grouped[groupKey].nome = nome;
        }
        // Se o grupo ainda não tiver o telefone formatado, preenche
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

  // Handle Pix Generation
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

  const generateWhatsAppLink = (group: FiadoGroup) => {
    const phone = group.telefone?.replace(/\D/g, '') || '';
    if (!phone) return '#';
    
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

    const message = `Olá ${group.nome}! Aqui é da Cantina.\n\nVocê possui um total de R$ ${total} pendente em fiados.\n\n*Detalhes das compras:*${detalhesText}${pixInfo}\n\nPor favor, realize o pagamento para darmos baixa no sistema. Obrigado!`;
    
    return `https://wa.me/55${phone}?text=${encodeURIComponent(message)}`;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="bg-purple-900 text-white p-8 rounded-[40px] shadow-xl">
        <h2 className="text-2xl font-black uppercase tracking-tight">Fiados Pendentes</h2>
        <p className="opacity-60 text-[10px] font-bold uppercase mt-1">Vendas agrupadas por cliente e número de telefone</p>
      </div>

      <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center gap-4 justify-between">
        <input
          type="text"
          placeholder="Pesquisar por nome ou telefone..."
          className="flex-1 bg-gray-50 border-none rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:ring-2 focus:ring-purple-500"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm.trim() && (
          <div className="bg-red-50 text-red-600 px-6 py-4 rounded-2xl flex flex-col items-end whitespace-nowrap">
            <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Total Devido (Pesquisa)</span>
            <span className="text-xl font-black">R$ {totalFiltered.toFixed(2)}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {groupedFiados.map(group => (
          <button 
            key={group.key}
            onClick={() => { setSelectedGroup(group); setPaymentMethod(PaymentMethod.CASH); }}
            className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 text-left hover:border-purple-200 transition-all active:scale-95 group relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 bg-red-50 text-red-600 px-4 py-2 rounded-bl-3xl rounded-tr-3xl font-black text-xs">
              R$ {group.total.toFixed(2)}
            </div>
            <h3 className="font-black text-purple-950 uppercase text-lg mb-1 pr-16">{group.nome}</h3>
            <p className="text-[10px] font-bold text-gray-400 uppercase">{group.sales.length} vendas pendentes</p>
            {group.telefone ? (
              <p className="text-[11px] font-bold text-green-700 flex items-center gap-1.5 mt-1">
                <i className="fa-brands fa-whatsapp text-green-600"></i>
                {group.telefone}
              </p>
            ) : (
              <p className="text-[10px] font-bold text-gray-400 mt-1 italic">
                Sem telefone cadastrado
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <span className="bg-green-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase shadow-sm">
                Quitar Tudo
              </span>
              {group.telefone && (
                <a 
                  href={generateWhatsAppLink(group)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="bg-gray-100 text-gray-600 hover:bg-gray-200 px-4 py-2 rounded-xl text-[10px] font-black uppercase shadow-sm flex items-center gap-2 transition-all"
                >
                  <i className="fa-brands fa-whatsapp text-green-500 text-sm"></i> Cobrar
                </a>
              )}
            </div>
          </button>
        ))}
        {groupedFiados.length === 0 && (
          <div className="col-span-full text-center py-12 bg-gray-50 rounded-3xl opacity-60">
             <i className="fa-solid fa-check-circle text-4xl mb-3 text-gray-400"></i>
             <p className="text-sm font-bold uppercase tracking-widest text-gray-500">Nenhum fiado pendente</p>
          </div>
        )}
      </div>

      {selectedGroup && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm overflow-y-auto" onClick={() => setSelectedGroup(null)}>
          <div className="bg-white rounded-[40px] p-8 w-full max-w-sm shadow-2xl my-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-2xl font-black text-purple-950 uppercase text-center mb-1">Receber Fiado</h3>
            <p className="text-center text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">{selectedGroup.nome}</p>
            {selectedGroup.telefone && (
              <p className="text-center text-xs font-bold text-green-700 flex items-center justify-center gap-1.5 mb-6">
                <i className="fa-brands fa-whatsapp text-green-600"></i>
                {selectedGroup.telefone}
              </p>
            )}
            {!selectedGroup.telefone && <div className="mb-6"></div>}
            
            <div className="bg-gray-50 rounded-3xl p-4 mb-6 max-h-40 overflow-y-auto border border-gray-100">
              {selectedGroup.sales.map((sale, idx) => (
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

            <div className="bg-red-50 p-6 rounded-3xl text-center mb-6 relative">
              <p className="text-[9px] font-black text-red-400 uppercase">Total a Pagar ({selectedGroup.sales.length} vendas)</p>
              <p className="text-4xl font-black text-red-600">R$ {selectedGroup.total.toFixed(2)}</p>
              {selectedGroup.telefone && (
                <div className="mt-4 flex justify-center">
                  <a 
                    href={generateWhatsAppLink(selectedGroup)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-white text-gray-700 hover:bg-gray-50 border border-gray-200 px-4 py-2 rounded-xl text-[10px] font-black uppercase shadow-sm flex items-center gap-2 transition-all"
                  >
                    <i className="fa-brands fa-whatsapp text-green-500 text-sm"></i> Enviar Cobrança via WhatsApp
                  </a>
                </div>
              )}
            </div>
            
            {paymentMethod === PaymentMethod.PIX && pixQrCode && (
              <div className="bg-gray-100 p-4 rounded-xl mb-6 flex flex-col items-center justify-center fade-in animate-in slide-in-from-top-2">
                <p className="text-[10px] font-black uppercase text-purple-900 mb-2">QR Code PIX</p>
                <QRCodeSVG value={pixQrCode} size={180} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 mb-6">
               {[PaymentMethod.PIX, PaymentMethod.CASH, PaymentMethod.DEBIT, PaymentMethod.CREDIT].map(m => (
                 <button 
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={`py-3 rounded-2xl text-[10px] font-black uppercase border-2 transition-all ${paymentMethod === m ? 'bg-purple-900 border-purple-900 text-white shadow-lg' : 'bg-white text-gray-400 border-gray-50'}`}
                 >
                   {m}
                 </button>
               ))}
            </div>
            <button 
              onClick={handlePayment}
              disabled={isProcessing || (paymentMethod === PaymentMethod.PIX && !pixQrCode)}
              className="w-full bg-green-600 text-white py-5 rounded-2xl font-black uppercase shadow-xl hover:bg-green-700 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? 'Processando...' : `Confirmar Baixa (${paymentMethod})`}
            </button>
            <button onClick={() => setSelectedGroup(null)} className="w-full mt-4 text-[10px] font-bold text-gray-400 uppercase">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FiadoView;
