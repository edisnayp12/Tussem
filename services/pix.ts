export function generateStaticPix(key: string, name: string, city: string, amount: number, transactionId: string = '***'): string {
  const sanitize = (str: string) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 25).trim();
  const format = (id: string, value: string) => {
    const len = value.length.toString().padStart(2, '0');
    return `${id}${len}${value}`;
  };

  name = sanitize(name) || 'Cantina';
  city = sanitize(city) || 'Cidade';
  key = key.trim();

  // EMV QR Code Payload Build
  const merchantAccountInfo = format('00', 'br.gov.bcb.pix') + format('01', key);
  
  const payload = [
    format('00', '01'), // Payload Format Indicator
    format('26', merchantAccountInfo), // Merchant Account Information GUI + KEY
    format('52', '0000'), // Merchant Category Code
    format('53', '986'), // Transaction Currency
    amount > 0 ? format('54', amount.toFixed(2)) : '', // Transaction Amount
    format('58', 'BR'), // Country Code
    format('59', name), // Merchant Name
    format('60', city), // Merchant City
    format('62', format('05', transactionId)), // Additional Data Field Template
  ].join('') + '6304';

  return payload + crc16(payload);
}

function crc16(payload: string): string {
  let polinomio = 0x1021;
  let resultado = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    resultado ^= payload.charCodeAt(i) << 8;
    for (let bitwise = 0; bitwise < 8; bitwise++) {
      if ((resultado <<= 1) & 0x10000) resultado ^= polinomio;
      resultado &= 0xFFFF;
    }
  }
  return resultado.toString(16).toUpperCase().padStart(4, '0');
}
