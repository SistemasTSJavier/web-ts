/** Fecha en zona local (YYYY-MM-DD) para evitar desfase UTC. */
export function formatDateKeyLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDateLabel(d: Date): string {
  return d.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function dateFromKey(key: string): Date {
  return new Date(`${key}T12:00:00`);
}
