export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return raw;
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    return '55' + digits;
  }
  return digits;
}

// Variantes de um telefone BR tolerantes ao 9º dígito do celular.
// O site guarda 13 dígitos (55+DDD+9XXXXXXXX) e o WhatsApp às vezes devolve 12
// (55+DDD+XXXXXXXX, sem o 9). Para casar os dois, geramos ambas as formas.
// Ex: '5534999861032' → ['5534999861032', '553499861032'] (e vice-versa).
export function phoneVariants(raw: string): string[] {
  const d = normalizePhone(raw);
  const out = new Set<string>([d]);
  if (d.startsWith('55')) {
    const ddd = d.slice(2, 4);
    const num = d.slice(4);
    if (num.length === 9 && num.startsWith('9')) out.add('55' + ddd + num.slice(1)); // remove 9
    if (num.length === 8) out.add('55' + ddd + '9' + num);                            // adiciona 9
  }
  return [...out];
}
