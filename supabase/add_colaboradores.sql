-- Añade la columna de colaboradores (nombres de asistentes).
-- Ejecutar en Supabase → SQL Editor.

alter table public.reservations
  add column if not exists colaboradores text;

comment on column public.reservations.colaboradores is
  'Nombres de las personas que estarán en la reunión';
