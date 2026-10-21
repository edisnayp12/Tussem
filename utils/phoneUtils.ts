/**
 * Utilitários centralizados para identificação, normalização e agrupamento
 * de números de telefone em todo o sistema (Reserva, PDV, Fiados, Painel Admin).
 */

export const normalizePhone = (phone: string | null | undefined): string => {
  if (!phone) return '';
  // Extrai somente os números, removendo espaços, parênteses, traços, pontos e símbolos
  let digits = phone.toString().replace(/\D/g, '');

  // Se o número começar com 0 (ex: 011987654321), remove o 0 inicial
  if (digits.startsWith('0') && (digits.length === 11 || digits.length === 12)) {
    digits = digits.slice(1);
  }

  // Se começar com código de país do Brasil 55 e tiver 12 ou 13 dígitos (+55 11 9...), remove o 55
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2);
  }

  return digits;
};

export const formatPhone = (phone: string | null | undefined): string => {
  const digits = normalizePhone(phone);
  if (!digits) return '';

  if (digits.length === 11) {
    // Celular: (11) 98765-4321
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    // Fixo: (11) 3456-7890
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 9) {
    // 98765-4321 (sem DDD)
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }
  if (digits.length === 8) {
    // 3456-7890 (sem DDD)
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }
  if (digits.length > 2 && digits.length <= 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }
  if (digits.length > 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return digits;
};

export const phonesMatch = (phoneA: string | null | undefined, phoneB: string | null | undefined): boolean => {
  const a = normalizePhone(phoneA);
  const b = normalizePhone(phoneB);
  if (!a || !b) return false;
  if (a === b) return true;
  // Se um deles foi digitado sem DDD (ex: 987654321 vs 11987654321)
  if (a.length >= 8 && b.length >= 8) {
    if (a.endsWith(b) || b.endsWith(a)) return true;
  }
  return false;
};

export const getWhatsAppLink = (phone: string | null | undefined, message?: string): string => {
  let digits = normalizePhone(phone);
  if (!digits) return '#';
  // Garante DDI 55 se tiver 10 ou 11 dígitos
  if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`;
  }
  const baseUrl = `https://wa.me/${digits}`;
  if (message) {
    return `${baseUrl}?text=${encodeURIComponent(message)}`;
  }
  return baseUrl;
};
