/**
 * Utilitários de compatibilidade entre navegadores (Chrome, Safari/iOS, Firefox, Edge, Samsung Internet, PWAs e Iframes).
 */

/**
 * Retorna a data local no formato YYYY-MM-DD sem sofrer deslocamento de fuso horário UTC.
 */
export function getLocalDateString(dateInput: Date | string | number = new Date()): string {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Retorna o mês local no formato YYYY-MM sem deslocamento UTC.
 */
export function getLocalMonthString(dateInput: Date | string | number = new Date()): string {
  return getLocalDateString(dateInput).slice(0, 7);
}

/**
 * Formata uma data com fallback seguro caso algum navegador antigo ou string inválida seja passada.
 */
export function formatSafeDateTime(dateStr?: string | number | Date): string {
  if (!dateStr) return '-';
  try {
    const d = dateStr instanceof Date ? dateStr : new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return String(dateStr);
  }
}

export function formatSafeDate(dateStr?: string | number | Date): string {
  if (!dateStr) return '-';
  try {
    const d = dateStr instanceof Date ? dateStr : new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleDateString('pt-BR');
  } catch {
    return String(dateStr);
  }
}

export function formatSafeTime(dateStr?: string | number | Date): string {
  if (!dateStr) return '-';
  try {
    const d = dateStr instanceof Date ? dateStr : new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * Faz parsing seguro de números decimais aceitando vírgula (padrão BR no Safari/Android) ou ponto.
 */
export function parseLocaleNumber(value: string | number | undefined | null): number {
  if (typeof value === 'number') return isNaN(value) ? 0 : value;
  if (!value) return 0;
  const cleaned = String(value).trim().replace(/\s+/g, '');
  // Se tiver vírgula e ponto (ex: 1.234,56), remove pontos de milhar e troca vírgula por ponto
  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    normalized = cleaned.replace(',', '.');
  }
  const num = parseFloat(normalized);
  return isNaN(num) ? 0 : num;
}

/**
 * Copia texto para a área de transferência com fallback para Safari antigo, HTTP e Iframes restritos.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Continua para o fallback
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);

    const isIOS = /ipad|iphone|ipod/i.test(navigator.userAgent);
    if (isIOS) {
      const range = document.createRange();
      range.selectNodeContents(textarea);
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      textarea.setSelectionRange(0, text.length);
    } else {
      textarea.select();
    }

    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Baixa um arquivo (CSV ou JSON) de forma 100% compatível com Firefox, Safari iOS, Android e Chrome.
 */
export function downloadBlobFile(content: string, filename: string, mimeType: string = 'text/csv;charset=utf-8;'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    try {
      if (link.parentNode) document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {}
  }, 1500);
}

/**
 * Escapa valores de células CSV corretamente para Excel/LibreOffice/Google Sheets.
 */
export function escapeCsvCell(val: string | number | undefined | null): string {
  const str = String(val ?? '');
  if (str.includes(';') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Abre URL externa de forma segura em qualquer navegador/PWA/iframe.
 */
export function openExternalUrl(url: string): void {
  if (!url || url === '#') return;
  try {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        if (a.parentNode) document.body.removeChild(a);
      } catch {}
    }, 300);
  } catch {
    window.location.href = url;
  }
}
