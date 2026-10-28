import { Sale, SaleItem, AppSettings } from '../types';
import { normalizePhone } from './phoneUtils';

export const formatSaleReceiptText = (sale: Sale, settings: AppSettings): string => {
  const cantinaName = settings.cantinaName || 'Cantina TUSEMM';
  const saleDate = new Date(sale.created_at).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const formaMap: Record<string, string> = {
    pix: 'PIX',
    dinheiro: 'Dinheiro',
    debito: 'Cartão de Débito',
    credito: 'Cartão de Crédito',
    fiado: 'Fiado (A Pagar)'
  };
  const formaLabel = formaMap[sale.forma_pagamento] || (sale.forma_pagamento || '').toUpperCase();

  let text = `🟣 *COMPROVANTE DE COMPRA* 🟣\n`;
  text += `*${cantinaName.toUpperCase()}*\n`;
  text += `--------------------------------\n`;
  text += `📅 Data/Hora: ${saleDate}\n`;
  text += `🧾 Pedido: #${(sale.id || '').slice(-6).toUpperCase()}\n`;
  if (sale.cliente_nome && sale.cliente_nome !== 'Sem Nome' && sale.cliente_nome !== 'Cliente Balcão') {
    text += `👤 Cliente: ${sale.cliente_nome}\n`;
  }
  if (sale.tipo_pedido === 'reserva') {
    text += `🏷️ Tipo: Reserva Antecipada\n`;
  }
  text += `--------------------------------\n`;
  text += `*ITENS DO PEDIDO:*\n`;

  if (sale.itens && sale.itens.length > 0) {
    sale.itens.forEach((item: SaleItem, idx: number) => {
      const sub = Number(item.subtotal || item.quantidade * item.preco_unitario || 0);
      text += `${idx + 1}. ${item.nome || 'Item'} (${item.quantidade}x R$ ${(Number(item.preco_unitario) || 0).toFixed(2)}) = R$ ${sub.toFixed(2)}\n`;
    });
  } else {
    text += `Total de itens = R$ ${(Number(sale.valor_total) || 0).toFixed(2)}\n`;
  }

  text += `--------------------------------\n`;
  text += `💰 *TOTAL: R$ ${(Number(sale.valor_total) || 0).toFixed(2)}*\n`;
  text += `💳 Forma de Pagamento: ${formaLabel}\n`;
  text += `Status: ${sale.status === 'pago' ? '✅ PAGO' : '⏳ PENDENTE'}\n`;

  if (sale.forma_pagamento === 'fiado' && settings.pixChave) {
    text += `\n*Chave PIX para quitação:* ${settings.pixChave}`;
    if (settings.pixTitular) text += ` (${settings.pixTitular})`;
    text += `\n`;
  }

  text += `--------------------------------\n`;
  text += `Agradecemos a preferência! Axé! 🙏`;

  return text;
};

export const getSaleWhatsAppReceiptLink = (sale: Sale, settings: AppSettings, customPhone?: string): string => {
  const text = formatSaleReceiptText(sale, settings);
  const targetPhone = customPhone || sale.telefone_comprador || '';
  const cleanDigits = normalizePhone(targetPhone);
  const encoded = encodeURIComponent(text);

  if (cleanDigits && cleanDigits.length >= 10) {
    const fullNumber = cleanDigits.startsWith('55') ? cleanDigits : `55${cleanDigits}`;
    return `https://wa.me/${fullNumber}?text=${encoded}`;
  }
  return `https://wa.me/?text=${encoded}`;
};

export const printSaleThermalReceipt = (sale: Sale, settings: AppSettings): void => {
  const text = formatSaleReceiptText(sale, settings).replace(/\*/g, '');
  const printWindow = window.open('', '_blank', 'width=350,height=500');
  if (printWindow) {
    printWindow.document.write(`
      <html>
        <head>
          <title>Comprovante - ${settings.cantinaName || 'TUSEMM'}</title>
          <style>
            body { font-family: 'Courier New', monospace; font-size: 12px; margin: 10px; line-height: 1.4; color: #000; }
            pre { white-space: pre-wrap; font-family: inherit; margin: 0; }
            @media print {
              body { margin: 0; }
            }
          </style>
        </head>
        <body>
          <pre>${text}</pre>
          <script>
            window.onload = function() { window.print(); window.close(); }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }
};
