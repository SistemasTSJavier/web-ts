-- Realtime para reservations (tablet / sync en vivo).
-- Ejecutar en Supabase → SQL Editor.
-- Seguro de re-ejecutar (no falla si ya estaba publicado).

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reservations'
  ) then
    alter publication supabase_realtime add table public.reservations;
  end if;
end $$;

-- Replica identity completa (DELETE/UPDATE con todos los campos)
alter table public.reservations replica identity full;
