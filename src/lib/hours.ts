import type { Reservation } from '../types';

export function hourToLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

export function parseHourFromHora(horaStr: string | null | undefined): number | null {
  if (!horaStr) return null;
  const match = horaStr.match(/^(\d{1,2})/);
  return match ? parseInt(match[1], 10) : null;
}

/** Intervalo half-open [start, end) en horas enteras. */
export function reservationHourRange(r: Reservation): { start: number; end: number } | null {
  const start = parseHourFromHora(r.hora);
  if (start === null) return null;
  const endHour = r.hora_fin ? parseHourFromHora(r.hora_fin) : null;
  const end = endHour !== null && endHour > start ? endHour + 1 : start + 1;
  return { start, end };
}

export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function reservationCoversHour(r: Reservation, hour: number): boolean {
  const range = reservationHourRange(r);
  if (!range) return false;
  return hour >= range.start && hour < range.end;
}

export function formatHoraDisplay(r: Reservation): string {
  if (!r.hora) return '—';
  const fin = r.hora_fin == null ? '' : String(r.hora_fin).trim();
  return fin !== '' && fin !== r.hora ? `${r.hora} - ${fin}` : r.hora;
}
