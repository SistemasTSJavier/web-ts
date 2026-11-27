import type { RealtimeChannel } from '@supabase/supabase-js';
import { bindRealtimeAuth, supabase, supabaseConfigured } from './supabaseClient';
import { HOUR_END, HOUR_START, type Reservation, type ReservationInsert } from './types';
import { dateFromKey, formatDateKeyLocal, formatDateLabel } from './lib/date';
import { $, escapeHtml } from './lib/html';
import {
  formatHoraDisplay,
  freeHoursList,
  hourToLabel,
  maxContiguousEndHour,
  parseHourFromHora,
  rangesOverlap,
  reservationCoversHour,
  reservationHourRange,
} from './lib/hours';
import { buildMailtoLink, parseEmailsFromParticipantes } from './lib/mailto';
import {
  extractFechaFromRealtimeRow,
  normalizeReservationList,
} from './lib/reservations';

let currentDate = new Date();
let reservations: Reservation[] = [];
/** Snapshot fresco del día del formulario (para ocultar horas ocupadas). */
let formDayReservations: Reservation[] = [];
let currentUserEmail: string | null = null;
let realtimeChannel: RealtimeChannel | null = null;
let loadError = false;
let loadingDay = false;
let lastFocusedBeforeModal: HTMLElement | null = null;
/** Evita que respuestas viejas de loadDay pisen datos nuevos. */
let loadSeq = 0;
let pollTimer: number | null = null;
let reconnectTimer: number | null = null;
let realtimeDebounceTimer: number | null = null;
let watchersReady = false;
let realtimeOk = false;
let formAvailabilityBound = false;
let appScreenActive = false;
const REALTIME_CHANNEL = 'sala-juntas-sync';
const POLL_MS = 5000;

function showScreen(id: string): void {
  document.querySelectorAll('.screen').forEach((el) => el.classList.add('hidden'));
  $(id)?.classList.remove('hidden');
}

function setStatus(message: string, isError = false): void {
  const el = $('schedule-status');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('is-error', isError);
  el.classList.toggle('hidden', !message);
}

function reservationAtHour(hour: number): Reservation | null {
  return reservations.find((r) => reservationCoversHour(r, hour)) ?? null;
}

function setRealtimeBadge(connected: boolean): void {
  realtimeOk = connected;
}

async function loadDay(opts?: { silent?: boolean }): Promise<void> {
  if (!supabase) return;
  const seq = ++loadSeq;
  const key = formatDateKeyLocal(currentDate);
  const silent = Boolean(opts?.silent);
  loadingDay = true;
  loadError = false;
  if (!silent) setStatus('Cargando horario…');

  try {
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .eq('fecha', key)
      .order('hora');

    // Respuesta obsoleta (hubo otra carga más reciente).
    if (seq !== loadSeq) return;

    if (error) {
      reservations = [];
      loadError = true;
      setStatus(`No se pudo cargar el horario: ${error.message}`, true);
    } else {
      reservations = normalizeReservationList(data);
      if (!silent) setStatus('');
      else if (!loadError) {
        const statusEl = $('schedule-status');
        if (statusEl?.classList.contains('is-error')) setStatus('');
      }
      // Si el formulario está abierto el mismo día, quitar horas recién ocupadas.
      syncOpenFormAvailability(key);
    }
    renderTable();
  } catch (err) {
    if (seq !== loadSeq) return;
    reservations = [];
    loadError = true;
    const msg = err instanceof Error ? err.message : 'Error inesperado al cargar.';
    setStatus(`No se pudo cargar el horario: ${msg}`, true);
    renderTable();
  } finally {
    if (seq === loadSeq) loadingDay = false;
  }
}

/** Agrupa eventos realtime/broadcast para no saturar. */
function requestScheduleRefresh(reason = 'sync'): void {
  if (!appScreenActive) return;
  if (realtimeDebounceTimer != null) window.clearTimeout(realtimeDebounceTimer);
  realtimeDebounceTimer = window.setTimeout(() => {
    realtimeDebounceTimer = null;
    void loadDay({ silent: true });
    if (reason) {
      // noop: reason útil para depurar en consola
      console.debug('[schedule-refresh]', reason);
    }
  }, 250);
}

async function notifyPeersReservationChanged(fecha: string): Promise<void> {
  if (!supabase) return;
  try {
    const channel = realtimeChannel ?? supabase.channel(REALTIME_CHANNEL);
    await channel.send({
      type: 'broadcast',
      event: 'reservations_changed',
      payload: { fecha, at: Date.now() },
    });
  } catch (err) {
    console.warn('[broadcast]', err);
  }
}

function syncOpenFormAvailability(viewedFecha: string): void {
  const modal = $('modal-form');
  if (!modal || modal.classList.contains('hidden')) return;
  const fecha = ($('form-fecha') as HTMLInputElement | null)?.value;
  if (!fecha || fecha !== viewedFecha) return;
  formDayReservations = reservations;
  const selInicio = $('form-hora-inicio') as HTMLSelectElement | null;
  const preferred = selInicio ? parseInt(selInicio.value, 10) : undefined;
  refreshFormHourSelects(Number.isFinite(preferred) ? preferred : undefined);
}

function openModal(modalId: string): void {
  const modal = $(modalId);
  if (!modal) return;
  lastFocusedBeforeModal = document.activeElement as HTMLElement | null;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  const focusTarget =
    modal.querySelector<HTMLElement>('[data-initial-focus]') ||
    modal.querySelector<HTMLElement>('button, [href], input, select, textarea');
  focusTarget?.focus();
}

function closeModal(modalId: string): void {
  const modal = $(modalId);
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  lastFocusedBeforeModal?.focus();
  lastFocusedBeforeModal = null;
}

function renderReservationsList(): void {
  const list = $('reservations-list');
  if (!list) return;
  list.innerHTML = '';

  if (reservations.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'reservations-empty';
    empty.textContent = 'No hay reservaciones este día.';
    list.appendChild(empty);
    return;
  }

  const sorted = [...reservations].sort((a, b) => {
    const ah = parseHourFromHora(a.hora) ?? 0;
    const bh = parseHourFromHora(b.hora) ?? 0;
    return ah - bh;
  });

  for (const r of sorted) {
    const li = document.createElement('li');
    li.className = 'reservation-item clickable';
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    const horario = formatHoraDisplay(r);
    const asunto = r.asunto?.trim() || '—';
    const colaboradoresLabel =
      (r.colaboradores && r.colaboradores.trim()) || 'Sin colaboradores';
    li.setAttribute(
      'aria-label',
      `Horario ${horario}. Asunto ${asunto}. Colaboradores ${colaboradoresLabel}. Abrir detalle.`,
    );
    li.innerHTML =
      `<div class="reservation-col reservation-col-time">` +
      `<span class="reservation-label">Horario</span>` +
      `<span class="reservation-value">${escapeHtml(horario)}</span>` +
      `</div>` +
      `<div class="reservation-col reservation-col-asunto">` +
      `<span class="reservation-label">Asunto</span>` +
      `<span class="reservation-value">${escapeHtml(asunto)}</span>` +
      `</div>` +
      `<div class="reservation-col reservation-col-collab">` +
      `<span class="reservation-label">Colaboradores</span>` +
      `<span class="reservation-value">${escapeHtml(colaboradoresLabel)}</span>` +
      `</div>`;
    const open = () => openDetail(r);
    li.addEventListener('click', open);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
    list.appendChild(li);
  }
}

function renderTable(): void {
  const tbody = $('schedule-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  renderReservationsList();

  let freeCount = 0;
  for (let h = HOUR_START; h <= HOUR_END; h++) {
    if (reservationAtHour(h)) continue;

    freeCount += 1;
    const tr = document.createElement('tr');
    tr.classList.add('available');
    tr.innerHTML =
      `<td class="hour">${hourToLabel(h)}</td>` +
      `<td><span class="status-available">Disponible</span></td>`;
    tbody.appendChild(tr);
  }

  if (!loadError) {
    if (freeCount === 0) {
      setStatus('No hay horas disponibles este día.');
    } else {
      setStatus('');
    }
  }
}

function openMailtoFromForm(): void {
  const organizador = ($('form-organizador') as HTMLInputElement).value.trim();
  const asunto = ($('form-asunto') as HTMLInputElement).value.trim();
  const fecha = ($('form-fecha') as HTMLInputElement).value;
  const horaInicio = ($('form-hora-inicio') as HTMLSelectElement).value;
  const horaFin = ($('form-hora-fin') as HTMLSelectElement).value;
  const invitados = ($('form-invitados') as HTMLTextAreaElement).value.trim();
  const colaboradores = ($('form-colaboradores') as HTMLTextAreaElement).value.trim();
  const emails = parseEmailsFromParticipantes(invitados);
  const fechaLabel = fecha ? formatDateLabel(dateFromKey(fecha)) : '';
  const horaStr =
    horaInicio !== horaFin
      ? `${hourToLabel(parseInt(horaInicio, 10))} a ${hourToLabel(parseInt(horaFin, 10))}`
      : hourToLabel(parseInt(horaInicio, 10));
  const bodyLines = [
    'Invitación a reservación – Sala de Juntas',
    '',
    `Organizado por: ${organizador || '—'}`,
    `Asunto: ${asunto || '—'}`,
    `Colaboradores: ${colaboradores || '—'}`,
    `Fecha: ${fechaLabel}`,
    `Hora: ${horaStr}`,
    '',
    `Enlace a la agenda: ${window.location.origin}`,
  ];
  window.location.href = buildMailtoLink({
    toEmails: emails,
    subject: asunto ? `Reservación: ${asunto}` : 'Invitación Sala de Juntas',
    body: bodyLines.join('\r\n'),
  });
}

function openMailtoFromDetail(r: Reservation): void {
  const emails = parseEmailsFromParticipantes(r.participantes || '');
  const fechaLabel = r.fecha ? formatDateLabel(dateFromKey(r.fecha)) : '';
  const bodyLines = [
    'Invitación a reservación – Sala de Juntas',
    '',
    `Organizado por: ${r.responsable || '—'}`,
    `Asunto: ${r.asunto || '—'}`,
    `Colaboradores: ${r.colaboradores || '—'}`,
    `Fecha: ${fechaLabel}`,
    `Hora: ${formatHoraDisplay(r)}`,
    '',
    `Enlace a la agenda: ${window.location.origin}`,
  ];
  window.location.href = buildMailtoLink({
    toEmails: emails,
    subject: r.asunto ? `Reservación: ${r.asunto}` : 'Invitación Sala de Juntas',
    body: bodyLines.join('\r\n'),
  });
}

function openDetail(r: Reservation): void {
  const list = $('detail-list');
  const btnDelete = $('btn-delete') as HTMLButtonElement | null;
  const btnMailtoDetail = $('btn-mailto-detail') as HTMLButtonElement | null;
  if (!list) return;

  list.innerHTML =
    `<dt>Fecha</dt><dd>${formatDateLabel(dateFromKey(r.fecha))}</dd>` +
    `<dt>Hora</dt><dd>${formatHoraDisplay(r)}</dd>` +
    `<dt>Organizador</dt><dd>${escapeHtml(r.responsable)}</dd>` +
    `<dt>Asunto</dt><dd>${escapeHtml(r.asunto)}</dd>` +
    `<dt>Colaboradores</dt><dd>${escapeHtml(
      (r.colaboradores && r.colaboradores.trim()) || '—',
    )}</dd>` +
    (r.participantes
      ? `<dt>Invitados</dt><dd>${escapeHtml(r.participantes)}</dd>`
      : '') +
    `<dt>Reservado por</dt><dd>${escapeHtml(r.reservado_por || '')}</dd>`;

  if (btnDelete) {
    btnDelete.classList.toggle('hidden', r.reservado_por !== currentUserEmail);
    btnDelete.onclick = () => {
      void deleteReservation(r.id);
    };
  }
  if (btnMailtoDetail) {
    btnMailtoDetail.onclick = () => openMailtoFromDetail(r);
    btnMailtoDetail.classList.toggle(
      'hidden',
      !(r.participantes && r.participantes.trim()),
    );
  }
  openModal('modal-detail');
}

async function deleteReservation(id: string): Promise<void> {
  if (!supabase) return;
  if (!window.confirm('¿Eliminar esta reservación? Esta acción no se puede deshacer.')) {
    return;
  }
  const btnDelete = $('btn-delete') as HTMLButtonElement | null;
  if (btnDelete) btnDelete.disabled = true;
  const { error } = await supabase.from('reservations').delete().eq('id', id);
  if (btnDelete) btnDelete.disabled = false;
  if (error) {
    window.alert(`No se pudo eliminar: ${error.message}`);
    return;
  }
  closeModal('modal-detail');
  await notifyPeersReservationChanged(formatDateKeyLocal(currentDate));
  await loadDay({ silent: true });
}

function setupDateNav(): void {
  const label = $('date-label');
  if (label) label.textContent = formatDateLabel(currentDate);

  const prev = $('btn-prev');
  const next = $('btn-next');
  if (prev) {
    prev.onclick = () => {
      currentDate = new Date(currentDate);
      currentDate.setDate(currentDate.getDate() - 1);
      if (label) label.textContent = formatDateLabel(currentDate);
      void loadDay();
    };
  }
  if (next) {
    next.onclick = () => {
      currentDate = new Date(currentDate);
      currentDate.setDate(currentDate.getDate() + 1);
      if (label) label.textContent = formatDateLabel(currentDate);
      void loadDay();
    };
  }
}

function fillHourSelectFromList(
  selectId: string,
  hours: number[],
  preferred?: number,
): void {
  const select = $(selectId) as HTMLSelectElement | null;
  if (!select) return;
  select.innerHTML = '';
  if (hours.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Sin horas libres';
    select.appendChild(opt);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  for (const h of hours) {
    const opt = document.createElement('option');
    opt.value = String(h);
    opt.textContent = hourToLabel(h);
    select.appendChild(opt);
  }
  if (preferred != null && hours.includes(preferred)) {
    select.value = String(preferred);
  } else {
    select.value = String(hours[0]);
  }
}

function refreshFormHourSelects(preferredStart?: number): void {
  const freeStarts = freeHoursList(formDayReservations, HOUR_START, HOUR_END);
  fillHourSelectFromList('form-hora-inicio', freeStarts, preferredStart);

  const selInicio = $('form-hora-inicio') as HTMLSelectElement | null;
  const selFin = $('form-hora-fin') as HTMLSelectElement | null;
  const submitBtn = document.querySelector(
    '#reservation-form button[type="submit"]',
  ) as HTMLButtonElement | null;
  const formError = $('form-error');

  if (!selInicio || !selFin) return;

  if (freeStarts.length === 0) {
    fillHourSelectFromList('form-hora-fin', []);
    if (submitBtn) submitBtn.disabled = true;
    if (formError) {
      formError.textContent = 'No hay horas disponibles para esta fecha.';
    }
    return;
  }

  const inicio = parseInt(selInicio.value, 10);
  const maxFin = maxContiguousEndHour(inicio, formDayReservations, HOUR_END);
  const finHours: number[] = [];
  for (let h = inicio; h <= maxFin; h++) finHours.push(h);
  const prevFin = parseInt(selFin.value, 10);
  fillHourSelectFromList(
    'form-hora-fin',
    finHours,
    Number.isFinite(prevFin) ? prevFin : inicio,
  );
  if (submitBtn) submitBtn.disabled = false;
}

async function refreshFormAvailability(fecha: string): Promise<void> {
  formDayReservations = await fetchReservationsForDate(fecha, { force: true });
  const selInicio = $('form-hora-inicio') as HTMLSelectElement | null;
  const preferred = selInicio ? parseInt(selInicio.value, 10) : undefined;
  refreshFormHourSelects(Number.isFinite(preferred) ? preferred : undefined);
}

async function setupNewReservation(): Promise<void> {
  const selInicio = $('form-hora-inicio') as HTMLSelectElement | null;
  if (!selInicio) return;

  const fechaInput = $('form-fecha') as HTMLInputElement;
  fechaInput.value = formatDateKeyLocal(currentDate);
  ($('form-organizador') as HTMLInputElement).value = currentUserEmail || '';
  ($('form-organizador') as HTMLInputElement).placeholder =
    'Correo (predeterminado: inicio de sesión)';
  ($('form-asunto') as HTMLInputElement).value = '';
  ($('form-colaboradores') as HTMLTextAreaElement).value = '';
  ($('form-invitados') as HTMLTextAreaElement).value = '';
  const err = $('form-error');
  if (err) err.textContent = '';

  try {
    await refreshFormAvailability(fechaInput.value);
  } catch (e) {
    if (err) {
      err.textContent =
        e instanceof Error
          ? `No se pudo cargar disponibilidad: ${e.message}`
          : 'No se pudo cargar disponibilidad.';
    }
    // Fallback: no ofrecer horas hasta poder validar.
    formDayReservations = [];
    fillHourSelectFromList('form-hora-inicio', []);
    fillHourSelectFromList('form-hora-fin', []);
  }
}

async function fetchReservationsForDate(
  fecha: string,
  opts?: { force?: boolean },
): Promise<Reservation[]> {
  if (!supabase) return [];
  // Solo cache si no forzamos (el guardado siempre fuerza).
  if (
    !opts?.force &&
    fecha === formatDateKeyLocal(currentDate) &&
    !loadError &&
    !loadingDay
  ) {
    return reservations;
  }
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('fecha', fecha)
    .order('hora');
  if (error) throw new Error(error.message);
  return normalizeReservationList(data);
}

function overlapMessage(startStr: string, endStr: string, useRange: boolean): string {
  return `Ese horario ya fue reservado (de ${startStr}${
    useRange ? ` a ${endStr}` : ''
  }). Tiene prioridad quien guardó primero; elige otro horario.`;
}

async function insertReservationSafe(payload: ReservationInsert): Promise<{ errorMessage?: string }> {
  if (!supabase) return { errorMessage: 'Supabase no configurado.' };

  // Camino preferido: RPC atómica (lock por fecha en el servidor).
  const { error: rpcError } = await supabase.rpc('create_reservation_safe', {
    p_fecha: payload.fecha,
    p_hora: payload.hora,
    p_hora_fin: payload.hora_fin ?? '',
    p_responsable: payload.responsable,
    p_asunto: payload.asunto,
    p_colaboradores: payload.colaboradores,
    p_participantes: payload.participantes,
    p_reservado_por: payload.reservado_por,
  });

  if (!rpcError) return {};

  // Si la función aún no existe, fallback a insert + chequeo fresco.
  const missingFn =
    /could not find the function|function .* does not exist|PGRST202/i.test(
      rpcError.message,
    );
  if (!missingFn) {
    if (/HORARIO_OCUPADO/i.test(rpcError.message)) {
      return { errorMessage: 'HORARIO_OCUPADO' };
    }
    return { errorMessage: rpcError.message };
  }

  const { error } = await supabase.from('reservations').insert(payload);
  if (!error) return {};
  return { errorMessage: error.message };
}

async function submitReservation(e: Event): Promise<void> {
  e.preventDefault();
  if (!supabase) return;

  const horaInicio = parseInt(($('form-hora-inicio') as HTMLSelectElement).value, 10);
  const horaFin = parseInt(($('form-hora-fin') as HTMLSelectElement).value, 10);
  const fecha = ($('form-fecha') as HTMLInputElement).value;
  const organizador = ($('form-organizador') as HTMLInputElement).value.trim();
  const asunto = ($('form-asunto') as HTMLInputElement).value.trim();
  const colaboradores = ($('form-colaboradores') as HTMLTextAreaElement).value.trim();
  const invitados = ($('form-invitados') as HTMLTextAreaElement).value.trim();
  const formError = $('form-error');
  const submitBtn = document.querySelector(
    '#reservation-form button[type="submit"]',
  ) as HTMLButtonElement | null;

  if (!organizador || !asunto) {
    if (formError) formError.textContent = 'Organizador y asunto son obligatorios.';
    return;
  }
  if (!colaboradores) {
    if (formError) formError.textContent = 'Indica los colaboradores de la reunión.';
    return;
  }
  if (!Number.isFinite(horaInicio) || !Number.isFinite(horaFin)) {
    if (formError) formError.textContent = 'No hay horas disponibles para reservar.';
    return;
  }

  const startStr = hourToLabel(horaInicio);
  const endStr = hourToLabel(horaFin);
  const useRange = horaFin > horaInicio;
  const newStart = horaInicio;
  const newEnd = useRange ? horaFin + 1 : horaInicio + 1;

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando…';
  }
  if (formError) formError.textContent = '';

  try {
    // Siempre fresco desde DB (nunca cache) para reducir duplicados.
    const dayReservations = await fetchReservationsForDate(fecha, { force: true });
    formDayReservations = dayReservations;

    const overlapping = dayReservations.filter((r) => {
      const range = reservationHourRange(r);
      if (!range) return false;
      return rangesOverlap(newStart, newEnd, range.start, range.end);
    });
    if (overlapping.length > 0) {
      if (formError) formError.textContent = overlapMessage(startStr, endStr, useRange);
      refreshFormHourSelects();
      return;
    }

    // Validar que el rango elegido no atraviese huecos ocupados.
    const maxFin = maxContiguousEndHour(horaInicio, dayReservations, HOUR_END);
    if (horaFin > maxFin) {
      if (formError) {
        formError.textContent =
          'Ese rango cruza horas ya reservadas. Ajusta hora de fin.';
      }
      refreshFormHourSelects(horaInicio);
      return;
    }

    const payload: ReservationInsert = {
      fecha,
      hora: startStr,
      responsable: organizador,
      asunto,
      colaboradores,
      participantes: invitados,
      reservado_por: currentUserEmail || '',
      nombre_contacto: '',
      correo_notificacion: '',
    };
    if (useRange) payload.hora_fin = endStr;

    const { errorMessage } = await insertReservationSafe(payload);
    if (errorMessage) {
      if (errorMessage === 'HORARIO_OCUPADO' || /HORARIO_OCUPADO/i.test(errorMessage)) {
        if (formError) formError.textContent = overlapMessage(startStr, endStr, useRange);
        await refreshFormAvailability(fecha);
        return;
      }
      if (formError) formError.textContent = errorMessage;
      return;
    }

    closeModal('modal-form');
    if (fecha !== formatDateKeyLocal(currentDate)) {
      currentDate = dateFromKey(fecha);
      const label = $('date-label');
      if (label) label.textContent = formatDateLabel(currentDate);
    }
    await notifyPeersReservationChanged(fecha);
    await loadDay({ silent: true });
  } catch (err) {
    if (formError) {
      formError.textContent =
        err instanceof Error ? err.message : 'Error al validar o guardar la reservación.';
    }
  } finally {
    if (submitBtn) {
      const free = freeHoursList(formDayReservations, HOUR_START, HOUR_END);
      submitBtn.disabled = free.length === 0;
      submitBtn.textContent = 'Guardar reservación';
    }
  }
}

function scheduleRealtimeReconnect(delayMs = 2500): void {
  if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (appScreenActive && document.visibilityState === 'visible') {
      void subscribeRealtime(true);
    }
  }, delayMs);
}

async function subscribeRealtime(force = false): Promise<void> {
  if (!supabase || !appScreenActive) return;
  if (realtimeChannel && !force && realtimeOk) return;

  await bindRealtimeAuth();

  if (realtimeChannel) {
    void supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  setRealtimeBadge(false);

  const channel = supabase
    .channel(REALTIME_CHANNEL, {
      config: {
        broadcast: { self: true },
      },
    })
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'reservations' },
      (payload) => {
        // Cualquier cambio → refrescar (tablet no depende del filtro de fecha).
        const fecha =
          extractFechaFromRealtimeRow(payload.new) ||
          extractFechaFromRealtimeRow(payload.old);
        requestScheduleRefresh(`postgres:${payload.eventType}:${fecha || 'all'}`);
      },
    )
    .on('broadcast', { event: 'reservations_changed' }, (msg) => {
      const fecha = extractFechaFromRealtimeRow(msg?.payload) || '';
      const viewed = formatDateKeyLocal(currentDate);
      if (!fecha || fecha === viewed) {
        requestScheduleRefresh('broadcast');
      } else {
        // Otro día: igual refrescar por seguridad en tablet fija.
        requestScheduleRefresh('broadcast-other-day');
      }
    });

  realtimeChannel = channel;
  channel.subscribe((status: string, err?: Error) => {
    if (status === 'SUBSCRIBED') {
      setRealtimeBadge(true);
      // Al conectar, traer estado actual por si se perdió un evento.
      requestScheduleRefresh('subscribed');
      return;
    }

    if (
      status === 'CHANNEL_ERROR' ||
      status === 'TIMED_OUT' ||
      status === 'CLOSED'
    ) {
      setRealtimeBadge(false);
      if (err) console.warn('[realtime]', status, err.message);
      else console.warn('[realtime]', status);
      scheduleRealtimeReconnect(status === 'TIMED_OUT' ? 4000 : 2000);
    }
  });
}

function startScheduleWatchers(): void {
  if (watchersReady) return;
  watchersReady = true;

  // Respaldo fuerte para tablet: refresco silencioso cada 5s.
  pollTimer = window.setInterval(() => {
    if (!appScreenActive) return;
    // En tablet a veces visibilityState falla; siempre intentamos.
    void loadDay({ silent: true });
    if (!realtimeOk) void subscribeRealtime(true);
  }, POLL_MS);

  document.addEventListener('visibilitychange', () => {
    if (!appScreenActive) return;
    if (document.visibilityState === 'visible') {
      void subscribeRealtime(true);
      requestScheduleRefresh('visible');
    }
  });

  window.addEventListener('online', () => {
    if (!appScreenActive) return;
    void subscribeRealtime(true);
    requestScheduleRefresh('online');
  });

  window.addEventListener('focus', () => {
    if (!appScreenActive) return;
    requestScheduleRefresh('focus');
  });
}

function enterApp(): void {
  appScreenActive = true;
  showScreen('app-screen');
  const label = $('date-label');
  if (label) label.textContent = formatDateLabel(currentDate);
  setupDateNav();
  startScheduleWatchers();
  void (async () => {
    await bindRealtimeAuth();
    await subscribeRealtime(true);
    await loadDay();
  })();
}

function initAuth(): void {
  const client = supabase;
  if (!supabaseConfigured || !client) {
    showScreen('login-screen');
    const err = $('login-error');
    if (err) {
      err.textContent =
        'Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en el archivo .env';
    }
    return;
  }

  let appReady = false;

  client.auth.onAuthStateChange((event, session) => {
    currentUserEmail = session?.user?.email ?? null;

    if (session?.access_token) {
      void client.realtime.setAuth(session.access_token);
    }

    if (session) {
      const shouldEnter =
        !appReady || event === 'SIGNED_IN' || event === 'INITIAL_SESSION';
      if (shouldEnter) {
        appReady = true;
        enterApp();
      } else if (event === 'TOKEN_REFRESHED') {
        void subscribeRealtime(true);
      }
      return;
    }

    appReady = false;
    appScreenActive = false;
    showScreen('login-screen');
    if (realtimeChannel) {
      void client.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    if (pollTimer != null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
    if (reconnectTimer != null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (realtimeDebounceTimer != null) {
      window.clearTimeout(realtimeDebounceTimer);
      realtimeDebounceTimer = null;
    }
    watchersReady = false;
    realtimeOk = false;
  });
}

function initLogin(): void {
  const form = $('login-form') as HTMLFormElement | null;
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!supabase) return;
    const btn = $('login-btn') as HTMLButtonElement;
    const err = $('login-error');
    if (err) err.textContent = '';
    btn.disabled = true;
    const email = ($('email') as HTMLInputElement).value.trim();
    const password = ($('password') as HTMLInputElement).value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    if (error && err) {
      err.textContent = error.message || 'Correo o contraseña incorrectos.';
    }
  });
}

function setupModalA11y(): void {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('modal-form')?.classList.contains('hidden')) {
      closeModal('modal-form');
      return;
    }
    if (!$('modal-detail')?.classList.contains('hidden')) {
      closeModal('modal-detail');
    }
  });
}

function isFullscreenActive(): boolean {
  return Boolean(
    document.fullscreenElement ||
      (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement,
  );
}

function updateFullscreenButton(): void {
  const btn = $('btn-fullscreen') as HTMLButtonElement | null;
  if (!btn) return;
  const active = isFullscreenActive();
  btn.textContent = active ? 'Salir pantalla completa' : 'Pantalla completa';
  btn.title = active ? 'Salir de pantalla completa' : 'Pantalla completa';
  btn.setAttribute(
    'aria-label',
    active ? 'Salir de pantalla completa' : 'Pantalla completa',
  );
}

async function toggleFullscreen(): Promise<void> {
  const doc = document as Document & {
    webkitExitFullscreen?: () => Promise<void> | void;
    webkitFullscreenElement?: Element;
  };
  const root = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };

  try {
    if (isFullscreenActive()) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
    } else if (root.requestFullscreen) {
      await root.requestFullscreen();
    } else if (root.webkitRequestFullscreen) {
      await root.webkitRequestFullscreen();
    }
  } catch (err) {
    console.warn('[fullscreen]', err);
  } finally {
    updateFullscreenButton();
  }
}

function initApp(): void {
  const logout = $('btn-logout');
  if (logout) {
    logout.onclick = () => {
      void supabase?.auth.signOut();
    };
  }

  const fullscreenBtn = $('btn-fullscreen');
  if (fullscreenBtn) {
    fullscreenBtn.onclick = () => {
      void toggleFullscreen();
    };
  }
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
  updateFullscreenButton();

  $('btn-new-reservation')!.onclick = () => {
    openModal('modal-form');
    void setupNewReservation();
  };

  $('btn-cancel-form')!.onclick = () => closeModal('modal-form');
  $('btn-close-detail')!.onclick = () => closeModal('modal-detail');
  $('btn-mailto-form')!.onclick = openMailtoFromForm;

  if (!formAvailabilityBound) {
    formAvailabilityBound = true;

    const formHoraInicio = $('form-hora-inicio') as HTMLSelectElement | null;
    formHoraInicio?.addEventListener('change', () => {
      const inicio = parseInt(($('form-hora-inicio') as HTMLSelectElement).value, 10);
      if (!Number.isFinite(inicio)) return;
      refreshFormHourSelects(inicio);
    });

    const formFecha = $('form-fecha') as HTMLInputElement | null;
    formFecha?.addEventListener('change', () => {
      const fecha = ($('form-fecha') as HTMLInputElement).value;
      if (!fecha) return;
      void refreshFormAvailability(fecha).catch((err) => {
        const formError = $('form-error');
        if (formError) {
          formError.textContent =
            err instanceof Error
              ? `No se pudo cargar disponibilidad: ${err.message}`
              : 'No se pudo cargar disponibilidad.';
        }
      });
    });
  }

  ($('reservation-form') as HTMLFormElement).addEventListener('submit', (e) => {
    void submitReservation(e);
  });

  $('modal-form')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'modal-form') closeModal('modal-form');
  });
  $('modal-detail')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'modal-detail') closeModal('modal-detail');
  });

  setupModalA11y();
}

export function startApp(): void {
  initAuth();
  initLogin();
  initApp();
}
