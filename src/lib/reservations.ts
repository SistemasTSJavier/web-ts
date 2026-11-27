import type { Reservation } from '../types';

/** Normaliza hora DB ("8:00:00", "08:00") → "HH:MM". */
export function normalizeTime(value: unknown): string {
  if (value == null) return '';
  const s = String(value).trim();
  const match = s.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return s;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

/** Extrae YYYY-MM-DD desde string o timestamp ISO. */
export function normalizeFecha(value: unknown): string {
  if (value == null) return '';
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

export function normalizeReservation(row: Record<string, unknown>): Reservation {
  const horaFinRaw = row.hora_fin;
  const horaFin =
    horaFinRaw == null || String(horaFinRaw).trim() === ''
      ? null
      : normalizeTime(horaFinRaw);

  return {
    id: String(row.id ?? ''),
    fecha: normalizeFecha(row.fecha),
    hora: normalizeTime(row.hora),
    hora_fin: horaFin,
    responsable: String(row.responsable ?? ''),
    asunto: String(row.asunto ?? ''),
    colaboradores:
      row.colaboradores == null ? null : String(row.colaboradores),
    participantes:
      row.participantes == null ? null : String(row.participantes),
    reservado_por:
      row.reservado_por == null ? null : String(row.reservado_por),
    nombre_contacto:
      row.nombre_contacto == null ? null : String(row.nombre_contacto),
    correo_notificacion:
      row.correo_notificacion == null ? null : String(row.correo_notificacion),
  };
}

export function normalizeReservationList(data: unknown): Reservation[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map(normalizeReservation);
}

export function extractFechaFromRealtimeRow(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const fecha = normalizeFecha((row as { fecha?: unknown }).fecha);
  return fecha || null;
}
