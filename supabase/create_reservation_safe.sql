-- Reserva atómica: el primero que guarda gana; el segundo recibe HORARIO_OCUPADO.
-- Ejecutar en Supabase → SQL Editor.

create or replace function public.create_reservation_safe(
  p_fecha text,
  p_hora text,
  p_hora_fin text,
  p_responsable text,
  p_asunto text,
  p_colaboradores text,
  p_participantes text,
  p_reservado_por text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_start int;
  v_new_end int;
  v_r record;
  v_r_start int;
  v_r_end int;
  v_fin text;
  v_row public.reservations;
begin
  if p_fecha is null or btrim(p_fecha) = '' then
    raise exception 'FECHA_INVALIDA' using errcode = 'P0001';
  end if;

  -- Serializa reservas del mismo día (prioridad: quien confirma primero)
  perform pg_advisory_xact_lock(hashtext('reservations:' || p_fecha));

  v_new_start := split_part(p_hora, ':', 1)::int;
  v_fin := nullif(btrim(coalesce(p_hora_fin, '')), '');

  if v_fin is null or v_fin = p_hora then
    v_new_end := v_new_start + 1;
    v_fin := null;
  else
    v_new_end := split_part(v_fin, ':', 1)::int + 1;
  end if;

  for v_r in
    select hora, hora_fin
    from public.reservations
    where fecha = p_fecha
  loop
    v_r_start := split_part(v_r.hora::text, ':', 1)::int;
    if v_r.hora_fin is null
       or btrim(v_r.hora_fin::text) = ''
       or v_r.hora_fin::text = v_r.hora::text then
      v_r_end := v_r_start + 1;
    else
      v_r_end := split_part(v_r.hora_fin::text, ':', 1)::int + 1;
    end if;

    if v_new_start < v_r_end and v_r_start < v_new_end then
      raise exception 'HORARIO_OCUPADO'
        using errcode = 'P0001',
              hint = 'Otra persona reservó este horario antes.';
    end if;
  end loop;

  insert into public.reservations (
    fecha,
    hora,
    hora_fin,
    responsable,
    asunto,
    colaboradores,
    participantes,
    reservado_por,
    nombre_contacto,
    correo_notificacion
  ) values (
    p_fecha,
    p_hora,
    v_fin,
    p_responsable,
    p_asunto,
    coalesce(p_colaboradores, ''),
    coalesce(p_participantes, ''),
    coalesce(p_reservado_por, ''),
    '',
    ''
  )
  returning * into v_row;

  return to_json(v_row);
end;
$$;

revoke all on function public.create_reservation_safe(
  text, text, text, text, text, text, text, text
) from public;

grant execute on function public.create_reservation_safe(
  text, text, text, text, text, text, text, text
) to authenticated;
