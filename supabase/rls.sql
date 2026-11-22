-- Políticas recomendadas para la tabla public.reservations
-- Ejecutar en Supabase → SQL Editor.
-- Ajusta nombres de columnas si tu esquema difiere.

-- 1) Activar RLS
alter table public.reservations enable row level security;

-- 2) Lectura: cualquier usuario autenticado puede ver reservas
drop policy if exists "reservations_select_authenticated" on public.reservations;
create policy "reservations_select_authenticated"
  on public.reservations
  for select
  to authenticated
  using (true);

-- 3) Insertar: solo autenticados; reservado_por = email del usuario
drop policy if exists "reservations_insert_own" on public.reservations;
create policy "reservations_insert_own"
  on public.reservations
  for insert
  to authenticated
  with check (
    reservado_por = (auth.jwt() ->> 'email')
  );

-- 4) Actualizar / eliminar: solo el dueño
drop policy if exists "reservations_update_own" on public.reservations;
create policy "reservations_update_own"
  on public.reservations
  for update
  to authenticated
  using (reservado_por = (auth.jwt() ->> 'email'))
  with check (reservado_por = (auth.jwt() ->> 'email'));

drop policy if exists "reservations_delete_own" on public.reservations;
create policy "reservations_delete_own"
  on public.reservations
  for delete
  to authenticated
  using (reservado_por = (auth.jwt() ->> 'email'));

-- 5) (Opcional) Evitar solapes a nivel DB con exclusion constraint.
-- Requiere extensión btree_gist y columnas tipadas como time/date.
-- Descomenta y adapta si quieres integridad fuerte en servidor:
--
-- create extension if not exists btree_gist;
--
-- alter table public.reservations
--   add column if not exists hora_inicio time generated always as (hora::time) stored,
--   add column if not exists hora_fin_calc time generated always as (
--     coalesce(nullif(hora_fin, '')::time, (hora::time + interval '1 hour')::time)
--   ) stored;
--
-- alter table public.reservations
--   add constraint reservations_no_overlap
--   exclude using gist (
--     fecha with =,
--     tsrange(
--       (fecha + hora_inicio)::timestamp,
--       (fecha + hora_fin_calc)::timestamp,
--       '[)'
--     ) with &&
--   );
