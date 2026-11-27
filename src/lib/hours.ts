import { HOUR_END, HOUR_START, type Reservation } from '../types';

export function hourToLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

export function parseHourFromHora(horaStr: string | null | undefined): number | null {
  if (!horaStr) return null;
  const match = String(horaStr).match(/^(\d{1,2})/);
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

/** Todas las horas ocupadas (incluye rangos multi-hora). */
export function occupiedHoursSet(
  dayReservations: Reservation[],
  from = HOUR_START,
  to = HOUR_END,
): Set<number> {
  const occupied = new Set<number>();
  for (const r of dayReservations) {
    const range = reservationHourRange(r);
    if (!range) continue;
    for (let h = range.start; h < range.end; h++) {
      if (h >= from && h <= to) occupied.add(h);
    }
  }
  return occupied;
}

export function freeHoursList(
  dayReservations: Reservation[],
  from = HOUR_START,
  to = HOUR_END,
): number[] {
  const occupied = occupiedHoursSet(dayReservations, from, to);
  const free: number[] = [];
  for (let h = from; h <= to; h++) {
    if (!occupied.has(h)) free.push(h);
  }
  return free;
}

/**
 * Hora de fin máxima (inclusive) desde `start` sin atravesar horas ocupadas.
 * Ej. libres 11,12,13 y ocupada 14 → max fin desde 11 = 13.
 */
export function maxContiguousEndHour(
  start: number,
  dayReservations: Reservation[],
  to = HOUR_END,
): number {
  const occupied = occupiedHoursSet(dayReservations, start, to);
  let end = start;
  for (let h = start; h <= to; h++) {
    if (occupied.has(h)) break;
    end = h;
  }
  return end;
}

export function formatHoraDisplay(r: Reservation): string {
  if (!r.hora) return '—';
  const fin = r.hora_fin == null ? '' : String(r.hora_fin).trim();
  return fin !== '' && fin !== r.hora ? `${r.hora} - ${fin}` : r.hora;
}
