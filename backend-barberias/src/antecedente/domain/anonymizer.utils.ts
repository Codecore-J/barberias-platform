/**
 * Utilidades de privacidad y enmascaramiento estricto de datos personales (PII)
 * para el contexto de antecedentes compartidos entre distintas barberías (T7.2).
 */

export function maskName(name?: string | null): string {
  if (!name || name.trim().length === 0) return 'Anónimo';
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => (part.length > 1 ? `${part[0]}***` : part))
    .join(' ');
}

export function maskEmail(email?: string | null): string {
  if (!email || !email.includes('@')) return '***@***.***';
  const [user, domain] = email.split('@');
  const maskedUser = user.length > 2 ? `${user.slice(0, 2)}***` : `${user[0]}***`;
  return `${maskedUser}@${domain}`;
}

export function maskPhone(phone?: string | null): string {
  if (!phone || phone.trim().length === 0) return '***';
  if (phone.length <= 4) return '****';
  return `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}`;
}
