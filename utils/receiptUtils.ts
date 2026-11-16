import { Sale, SaleItem, AppSettings } from '../types';
import { normalizePhone } from './phoneUtils';
import { formatSafeDateTime } from './browserUtils';

const escapeHtml = (str: string): string =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const formatSaleReceiptText = (sale: Sale, settings: AppSettings): string => {
  const cantinaName = settings.cantinaName || 'Cantina TUSEMM';
  const saleDate = formatSafeDateTime(sale.created_at);

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

/**
 * Imprime recibo térmico usando Iframe oculto (funciona sem popups em Chrome, Safari, Firefox, Edge e Iframes)
 */
export const printSaleThermalReceipt = (sale: Sale, settings: AppSettings): void => {
  const rawText = formatSaleReceiptText(sale, settings).replace(/\*/g, '');
  const safeHtmlText = escapeHtml(rawText);
  const safeTitle = escapeHtml(settings.cantinaName || 'TUSEMM');

  const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <title>Comprovante - ${safeTitle}</title>
        <style>
          body { font-family: 'Courier New', Courier, monospace; font-size: 12px; margin: 12px; line-height: 1.4; color: #000; background: #fff; }
          pre { white-space: pre-wrap; word-break: break-word; font-family: inherit; margin: 0; }
          @media print {
            body { margin: 0; }
          }
        </style>
      </head>
      <body>
        <pre>${safeHtmlText}</pre>
      </body>
    </html>
  `;

  try {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    const frameDoc = iframe.contentWindow?.document || iframe.contentDocument;
    if (frameDoc) {
      frameDoc.open();
      frameDoc.write(html);
      frameDoc.close();

      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          window.print();
        }
        setTimeout(() => {
          try {
            if (iframe.parentNode) document.body.removeChild(iframe);
          } catch {}
        }, 2000);
      }, 250);
      return;
    }
  } catch {}

  window.print();
};
