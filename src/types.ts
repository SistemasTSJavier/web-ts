export interface Reservation {
  id: string;
  fecha: string;
  hora: string;
  hora_fin?: string | null;
  responsable: string;
  asunto: string;
  /** Nombres de quienes asisten a la reunión */
  colaboradores?: string | null;
  participantes?: string | null;
  reservado_por?: string | null;
  nombre_contacto?: string | null;
  correo_notificacion?: string | null;
}

export interface ReservationInsert {
  fecha: string;
  hora: string;
  hora_fin?: string;
  responsable: string;
  asunto: string;
  colaboradores: string;
  participantes: string;
  reservado_por: string;
  nombre_contacto: string;
  correo_notificacion: string;
}

export const HOUR_START = 8;
export const HOUR_END = 18;
