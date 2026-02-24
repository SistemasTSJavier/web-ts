(function () {
  'use strict';

  const HOUR_START = 8;
  const HOUR_END = 18;

  const supabase = window.SUPABASE_URL && window.SUPABASE_ANON_KEY
    ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
    : null;

  let currentDate = new Date();
  let reservations = [];
  let currentUserEmail = null;
  let realtimeChannel = null;

  const $ = (id) => document.getElementById(id);
  // Fecha en zona local (YYYY-MM-DD) para que no cambie al día anterior por UTC
  const formatDateKeyLocal = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  };
  const formatDateLabel = (d) => {
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
    const screen = $(id);
    if (screen) screen.classList.remove('hidden');
  }

  function hourToLabel(h) {
    return String(h).padStart(2, '0') + ':00';
  }

  function parseHourFromHora(horaStr) {
    if (!horaStr) return null;
    const match = horaStr.match(/^(\d{1,2})/);
    return match ? parseInt(match[1], 10) : null;
  }

  function reservationStartingAtHour(hour) {
    const prefix = hourToLabel(hour).slice(0, 2);
    return reservations.find((x) => {
      const h = (x.hora || '').slice(0, 2);
      return h === prefix;
    }) || null;
  }

  async function loadDay() {
    if (!supabase) return;
    const key = formatDateKeyLocal(currentDate);
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .eq('fecha', key)
      .order('hora');
    reservations = error ? [] : (data || []);
    renderTable();
  }

  function formatHoraDisplay(r) {
    if (!r || !r.hora) return '—';
    return r.hora_fin && r.hora_fin.trim() !== '' && r.hora_fin !== r.hora
      ? r.hora + ' - ' + r.hora_fin
      : r.hora;
  }

  function renderTable() {
    const tbody = $('schedule-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    for (let h = HOUR_START; h <= HOUR_END; h++) {
      const r = reservationStartingAtHour(h);
      const tr = document.createElement('tr');
      if (r) tr.classList.add('clickable');
      tr.dataset.hour = h;
      tr.innerHTML =
        '<td class="hour">' + (r ? formatHoraDisplay(r) : hourToLabel(h)) + '</td>' +
        '<td>' + (r ? escapeHtml(r.responsable) : '—') + '</td>' +
        '<td>' + (r ? escapeHtml(r.asunto) : '—') + '</td>' +
        '<td>' + (r && r.participantes ? escapeHtml(r.participantes) : '—') + '</td>';
      if (r) {
        tr.addEventListener('click', () => openDetail(r));
      }
      tbody.appendChild(tr);
    }
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function parseEmailsFromParticipantes(text) {
    if (!text || !text.trim()) return [];
    return text.split(/[\s,;\n]+/).map((s) => s.trim()).filter((s) => s && s.includes('@'));
  }

  function buildMailtoLink(options) {
    const { toEmails, subject, body } = options;
    const to = Array.isArray(toEmails) ? toEmails.filter(Boolean).join(', ') : '';
    const params = new URLSearchParams();
    if (to) params.set('to', to);
    if (subject) params.set('subject', subject);
    if (body) params.set('body', body);
    const q = params.toString();
    return 'mailto:' + (q ? '?' + q : '');
  }

  function openMailtoFromForm() {
    const organizador = $('form-organizador').value.trim();
    const asunto = $('form-asunto').value.trim();
    const fecha = $('form-fecha').value;
    const horaInicio = $('form-hora-inicio').value;
    const horaFin = $('form-hora-fin').value;
    const invitados = $('form-invitados').value.trim();
    const emails = parseEmailsFromParticipantes(invitados);
    const fechaLabel = fecha ? formatDateLabel(new Date(fecha + 'T12:00:00')) : '';
    const horaStr = horaInicio !== horaFin
      ? hourToLabel(parseInt(horaInicio, 10)) + ' a ' + hourToLabel(parseInt(horaFin, 10))
      : hourToLabel(parseInt(horaInicio, 10));
    const appUrl = window.location.origin;
    const bodyLines = [
      'Invitación a reservación – Sala de Juntas',
      '',
      'Organizado por: ' + (organizador || '—'),
      'Asunto: ' + (asunto || '—'),
      'Fecha: ' + fechaLabel,
      'Hora: ' + horaStr,
      '',
      'Enlace a la agenda: ' + appUrl,
    ];
    const mailto = buildMailtoLink({
      toEmails: emails,
      subject: asunto ? 'Reservación: ' + asunto : 'Invitación Sala de Juntas',
      body: bodyLines.join('\r\n'),
    });
    window.location.href = mailto;
  }

  function openMailtoFromDetail(r) {
    const emails = parseEmailsFromParticipantes(r.participantes || '');
    const fechaLabel = r.fecha ? formatDateLabel(new Date(r.fecha + 'T12:00:00')) : '';
    const horaStr = formatHoraDisplay(r);
    const appUrl = window.location.origin;
    const bodyLines = [
      'Invitación a reservación – Sala de Juntas',
      '',
      'Organizado por: ' + (r.responsable || '—'),
      'Asunto: ' + (r.asunto || '—'),
      'Fecha: ' + fechaLabel,
      'Hora: ' + horaStr,
      '',
      'Enlace a la agenda: ' + appUrl,
    ];
    const mailto = buildMailtoLink({
      toEmails: emails,
      subject: r.asunto ? 'Reservación: ' + r.asunto : 'Invitación Sala de Juntas',
      body: bodyLines.join('\r\n'),
    });
    window.location.href = mailto;
  }

  function openDetail(r) {
    const list = $('detail-list');
    const btnDelete = $('btn-delete');
    const btnMailtoDetail = $('btn-mailto-detail');
    if (!list) return;
    list.innerHTML =
      '<dt>Fecha</dt><dd>' + formatDateLabel(new Date(r.fecha + 'T12:00:00')) + '</dd>' +
      '<dt>Hora</dt><dd>' + formatHoraDisplay(r) + '</dd>' +
      '<dt>Organizador</dt><dd>' + escapeHtml(r.responsable) + '</dd>' +
      '<dt>Asunto</dt><dd>' + escapeHtml(r.asunto) + '</dd>' +
      (r.participantes ? '<dt>Invitados</dt><dd>' + escapeHtml(r.participantes) + '</dd>' : '') +
      '<dt>Reservado por</dt><dd>' + escapeHtml(r.reservado_por || '') + '</dd>';
    if (btnDelete) {
      btnDelete.classList.toggle('hidden', r.reservado_por !== currentUserEmail);
      btnDelete.onclick = () => deleteReservation(r.id);
    }
    if (btnMailtoDetail) {
      btnMailtoDetail.onclick = () => openMailtoFromDetail(r);
      btnMailtoDetail.classList.toggle('hidden', !(r.participantes && r.participantes.trim()));
    }
    $('modal-detail').classList.remove('hidden');
  }

  async function deleteReservation(id) {
    if (!supabase) return;
    await supabase.from('reservations').delete().eq('id', id);
    $('modal-detail').classList.add('hidden');
    loadDay();
  }

  function setupDateNav() {
    $('date-label').textContent = formatDateLabel(currentDate);
    $('btn-prev').onclick = () => {
      currentDate.setDate(currentDate.getDate() - 1);
      currentDate = new Date(currentDate);
      $('date-label').textContent = formatDateLabel(currentDate);
      loadDay();
    };
    $('btn-next').onclick = () => {
      currentDate.setDate(currentDate.getDate() + 1);
      currentDate = new Date(currentDate);
      $('date-label').textContent = formatDateLabel(currentDate);
      loadDay();
    };
  }

  function fillHourSelect(selectId, startHour, endHour) {
    const select = $(selectId);
    if (!select) return;
    select.innerHTML = '';
    for (let h = startHour; h <= endHour; h++) {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = hourToLabel(h);
      select.appendChild(opt);
    }
  }

  function setupNewReservation() {
    const selInicio = $('form-hora-inicio');
    if (!selInicio) return;
    fillHourSelect('form-hora-inicio', HOUR_START, HOUR_END);
    const inicioVal = selInicio.value;
    fillHourSelect('form-hora-fin', parseInt(inicioVal, 10), HOUR_END);
    $('form-hora-fin').value = inicioVal;
    $('form-fecha').value = formatDateKeyLocal(currentDate);
    $('form-organizador').value = currentUserEmail || '';
    $('form-organizador').placeholder = 'Correo (predeterminado: inicio de sesión)';
    $('form-asunto').value = '';
    $('form-invitados').value = '';
    $('form-error').textContent = '';
  }

  function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
  }

  async function submitReservation(e) {
    e.preventDefault();
    if (!supabase) return;
    const horaInicio = parseInt($('form-hora-inicio').value, 10);
    const horaFin = parseInt($('form-hora-fin').value, 10);
    const fecha = $('form-fecha').value;
    const organizador = $('form-organizador').value.trim();
    const asunto = $('form-asunto').value.trim();
    const invitados = $('form-invitados').value.trim();
    if (!organizador || !asunto) {
      $('form-error').textContent = 'Organizador y asunto son obligatorios.';
      return;
    }
    const startStr = hourToLabel(horaInicio);
    const endStr = hourToLabel(horaFin);
    const useRange = horaFin > horaInicio;
    const newStart = horaInicio;
    const newEnd = useRange ? horaFin + 1 : horaInicio + 1;
    const overlapping = reservations.filter((r) => {
      if (r.fecha !== fecha) return false;
      const rStart = parseHourFromHora(r.hora);
      const rEnd = r.hora_fin ? parseHourFromHora(r.hora_fin) + 1 : (rStart + 1);
      return rangesOverlap(newStart, newEnd, rStart, rEnd);
    });
    if (overlapping.length > 0) {
      $('form-error').textContent = 'Ya hay una reserva que coincide con ese horario (de ' + startStr + (useRange ? ' a ' + endStr : '') + ').';
      return;
    }
    $('form-error').textContent = '';
    const payload = {
      fecha,
      hora: startStr,
      responsable: organizador,
      asunto,
      participantes: invitados,
      reservado_por: currentUserEmail || '',
      nombre_contacto: '',
      correo_notificacion: '',
    };
    if (useRange) payload.hora_fin = endStr;
    const { error } = await supabase.from('reservations').insert(payload);
    if (error) {
      $('form-error').textContent = error.message;
      return;
    }
    $('modal-form').classList.add('hidden');
    loadDay();
  }

  function subscribeRealtime() {
    if (!supabase || realtimeChannel) return;
    realtimeChannel = supabase
      .channel('reservations-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => {
        loadDay();
      })
      .subscribe();
  }

  function initAuth() {
    if (!supabase) {
      showScreen('login-screen');
      $('login-error').textContent = 'Falta configurar SUPABASE_URL y SUPABASE_ANON_KEY en js/config.js';
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        currentUserEmail = session.user?.email || null;
        showScreen('app-screen');
        $('date-label').textContent = formatDateLabel(currentDate);
        loadDay();
        setupDateNav();
        subscribeRealtime();
      } else {
        showScreen('login-screen');
      }
    });
    supabase.auth.onAuthStateChange((event, session) => {
      currentUserEmail = session?.user?.email || null;
      if (session) {
        showScreen('app-screen');
        $('date-label').textContent = formatDateLabel(currentDate);
        loadDay();
        setupDateNav();
        subscribeRealtime();
      } else {
        showScreen('login-screen');
        if (realtimeChannel) {
          supabase.removeChannel(realtimeChannel);
          realtimeChannel = null;
        }
      }
    });
  }

  function initLogin() {
    $('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('login-btn');
      const err = $('login-error');
      err.textContent = '';
      btn.disabled = true;
      const email = $('email').value.trim();
      const password = $('password').value;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      btn.disabled = false;
      if (error) {
        err.textContent = error.message || 'Correo o contraseña incorrectos.';
        return;
      }
    });
  }

  function initApp() {
    $('btn-logout').onclick = () => supabase && supabase.auth.signOut();

    $('btn-new-reservation').onclick = () => {
      setupNewReservation();
      $('modal-form').classList.remove('hidden');
    };

    $('btn-cancel-form').onclick = () => $('modal-form').classList.add('hidden');
    $('btn-close-detail').onclick = () => $('modal-detail').classList.add('hidden');
    if ($('btn-mailto-form')) $('btn-mailto-form').onclick = openMailtoFromForm;

    const formHoraInicio = $('form-hora-inicio');
    if (formHoraInicio) {
      formHoraInicio.addEventListener('change', () => {
        const inicio = parseInt($('form-hora-inicio').value, 10);
        fillHourSelect('form-hora-fin', inicio, HOUR_END);
        const finVal = parseInt($('form-hora-fin').value, 10);
        if (finVal < inicio) $('form-hora-fin').value = inicio;
      });
    }

    const reservationForm = $('reservation-form');
    if (reservationForm) reservationForm.addEventListener('submit', submitReservation);

    $('modal-form').onclick = (e) => {
      if (e.target.id === 'modal-form') e.target.classList.add('hidden');
    };
    $('modal-detail').onclick = (e) => {
      if (e.target.id === 'modal-detail') e.target.classList.add('hidden');
    };
  }

  initAuth();
  initLogin();
  initApp();
})();
