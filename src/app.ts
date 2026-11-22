import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from './supabaseClient';
import { HOUR_END, HOUR_START, type Reservation, type ReservationInsert } from './types';
import { dateFromKey, formatDateKeyLocal, formatDateLabel } from './lib/date';
import { $, escapeHtml } from './lib/html';
import {
  formatHoraDisplay,
  hourToLabel,
  parseHourFromHora,
  rangesOverlap,
  reservationCoversHour,
  reservationHourRange,
} from './lib/hours';
import { buildMailtoLink, parseEmailsFromParticipantes } from './lib/mailto';

let currentDate = new Date();
let reservations: Reservation[] = [];
let currentUserEmail: string | null = null;
let realtimeChannel: RealtimeChannel | null = null;
let loadError = false;
let loadingDay = false;
let lastFocusedBeforeModal: HTMLElement | null = null;

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

async function loadDay(): Promise<void> {
  if (!supabase) return;
  const key = formatDateKeyLocal(currentDate);
  loadingDay = true;
  loadError = false;
  setStatus('Cargando horario…');
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('fecha', key)
    .order('hora');
  loadingDay = false;
  if (error) {
    reservations = [];
    loadError = true;
    setStatus(`No se pudo cargar el horario: ${error.message}`, true);
  } else {
    reservations = (data as Reservation[]) || [];
    setStatus('');
  }
  renderTable();
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
    li.setAttribute(
      'aria-label',
      `Reservación ${formatHoraDisplay(r)}: ${r.asunto}. Abrir detalle.`,
    );
    const colaboradoresLabel =
      (r.colaboradores && r.colaboradores.trim()) || 'Sin colaboradores';
    li.innerHTML =
      `<span class="reservation-time">${escapeHtml(formatHoraDisplay(r))}</span>` +
      `<span class="reservation-meta">` +
      `<strong>${escapeHtml(r.asunto)}</strong>` +
      `<span class="reservation-org">${escapeHtml(colaboradoresLabel)}</span>` +
      `</span>`;
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
  await loadDay();
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

function fillHourSelect(selectId: string, startHour: number, endHour: number): void {
  const select = $(selectId) as HTMLSelectElement | null;
  if (!select) return;
  select.innerHTML = '';
  for (let h = startHour; h <= endHour; h++) {
    const opt = document.createElement('option');
    opt.value = String(h);
    opt.textContent = hourToLabel(h);
    select.appendChild(opt);
  }
}

function setupNewReservation(): void {
  const selInicio = $('form-hora-inicio') as HTMLSelectElement | null;
  if (!selInicio) return;
  fillHourSelect('form-hora-inicio', HOUR_START, HOUR_END);
  const inicioVal = selInicio.value;
  fillHourSelect('form-hora-fin', parseInt(inicioVal, 10), HOUR_END);
  ($('form-hora-fin') as HTMLSelectElement).value = inicioVal;
  ($('form-fecha') as HTMLInputElement).value = formatDateKeyLocal(currentDate);
  ($('form-organizador') as HTMLInputElement).value = currentUserEmail || '';
  ($('form-organizador') as HTMLInputElement).placeholder =
    'Correo (predeterminado: inicio de sesión)';
  ($('form-asunto') as HTMLInputElement).value = '';
  ($('form-colaboradores') as HTMLTextAreaElement).value = '';
  ($('form-invitados') as HTMLTextAreaElement).value = '';
  const err = $('form-error');
  if (err) err.textContent = '';
}

async function fetchReservationsForDate(fecha: string): Promise<Reservation[]> {
  if (!supabase) return [];
  // Si ya estamos viendo ese día y no hubo error, reutilizar cache.
  if (fecha === formatDateKeyLocal(currentDate) && !loadError && !loadingDay) {
    return reservations;
  }
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('fecha', fecha)
    .order('hora');
  if (error) throw new Error(error.message);
  return (data as Reservation[]) || [];
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
    const dayReservations = await fetchReservationsForDate(fecha);
    const overlapping = dayReservations.filter((r) => {
      const range = reservationHourRange(r);
      if (!range) return false;
      return rangesOverlap(newStart, newEnd, range.start, range.end);
    });
    if (overlapping.length > 0) {
      if (formError) {
        formError.textContent = `Ya hay una reserva que coincide con ese horario (de ${startStr}${
          useRange ? ` a ${endStr}` : ''
        }).`;
      }
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

    const { error } = await supabase.from('reservations').insert(payload);
    if (error) {
      if (formError) formError.textContent = error.message;
      return;
    }

    closeModal('modal-form');
    // Si se guardó en otro día, navegar a esa fecha.
    if (fecha !== formatDateKeyLocal(currentDate)) {
      currentDate = dateFromKey(fecha);
      const label = $('date-label');
      if (label) label.textContent = formatDateLabel(currentDate);
    }
    await loadDay();
  } catch (err) {
    if (formError) {
      formError.textContent =
        err instanceof Error ? err.message : 'Error al validar o guardar la reservación.';
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Guardar reservación';
    }
  }
}

function subscribeRealtime(): void {
  if (!supabase || realtimeChannel) return;
  realtimeChannel = supabase
    .channel('reservations-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'reservations' },
      (payload) => {
        const row = (payload.new || payload.old) as { fecha?: string } | null;
        const viewed = formatDateKeyLocal(currentDate);
        if (!row?.fecha || row.fecha === viewed) {
          void loadDay();
        }
      },
    )
    .subscribe();
}

function enterApp(): void {
  showScreen('app-screen');
  const label = $('date-label');
  if (label) label.textContent = formatDateLabel(currentDate);
  setupDateNav();
  subscribeRealtime();
  void loadDay();
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

    if (session) {
      const shouldEnter =
        !appReady || event === 'SIGNED_IN' || event === 'INITIAL_SESSION';
      if (shouldEnter) {
        appReady = true;
        enterApp();
      }
      return;
    }

    appReady = false;
    showScreen('login-screen');
    if (realtimeChannel) {
      void client.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
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

function initApp(): void {
  const logout = $('btn-logout');
  if (logout) {
    logout.onclick = () => {
      void supabase?.auth.signOut();
    };
  }

  $('btn-new-reservation')!.onclick = () => {
    setupNewReservation();
    openModal('modal-form');
  };

  $('btn-cancel-form')!.onclick = () => closeModal('modal-form');
  $('btn-close-detail')!.onclick = () => closeModal('modal-detail');
  $('btn-mailto-form')!.onclick = openMailtoFromForm;

  const formHoraInicio = $('form-hora-inicio') as HTMLSelectElement | null;
  formHoraInicio?.addEventListener('change', () => {
    const inicio = parseInt(($('form-hora-inicio') as HTMLSelectElement).value, 10);
    fillHourSelect('form-hora-fin', inicio, HOUR_END);
    const finSelect = $('form-hora-fin') as HTMLSelectElement;
    const finVal = parseInt(finSelect.value, 10);
    if (Number.isNaN(finVal) || finVal < inicio) finSelect.value = String(inicio);
  });

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
