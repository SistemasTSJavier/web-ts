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
  const formatDateKey = (d) => d.toISOString().slice(0, 10);
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

  function reservationAtHour(hour) {
    const prefix = hourToLabel(hour).slice(0, 2);
    const r = reservations.find((x) => {
      const h = x.hora.slice(0, 2);
      return h === prefix;
    });
    return r || null;
  }

  async function loadDay() {
    if (!supabase) return;
    const key = formatDateKey(currentDate);
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .eq('fecha', key)
      .order('hora');
    reservations = error ? [] : (data || []);
    renderTable();
  }

  function renderTable() {
    const tbody = $('schedule-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    for (let h = HOUR_START; h <= HOUR_END; h++) {
      const r = reservationAtHour(h);
      const tr = document.createElement('tr');
      if (r) tr.classList.add('clickable');
      tr.dataset.hour = h;
      tr.innerHTML =
        '<td class="hour">' + hourToLabel(h) + '</td>' +
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

  function openDetail(r) {
    const list = $('detail-list');
    const btnDelete = $('btn-delete');
    if (!list) return;
    list.innerHTML =
      '<dt>Fecha</dt><dd>' + formatDateLabel(new Date(r.fecha + 'T12:00:00')) + '</dd>' +
      '<dt>Hora</dt><dd>' + r.hora + '</dd>' +
      '<dt>Organizador</dt><dd>' + escapeHtml(r.responsable) + '</dd>' +
      '<dt>Asunto</dt><dd>' + escapeHtml(r.asunto) + '</dd>' +
      (r.participantes ? '<dt>Invitados</dt><dd>' + escapeHtml(r.participantes) + '</dd>' : '') +
      '<dt>Reservado por</dt><dd>' + escapeHtml(r.reservado_por || '') + '</dd>';
    if (btnDelete) {
      btnDelete.classList.toggle('hidden', r.reservado_por !== currentUserEmail);
      btnDelete.onclick = () => deleteReservation(r.id);
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

  function setupNewReservation() {
    const select = $('form-hora');
    if (select) {
      select.innerHTML = '';
      for (let h = HOUR_START; h <= HOUR_END; h++) {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = hourToLabel(h);
        select.appendChild(opt);
      }
    }
    $('form-fecha').value = formatDateKey(currentDate);
    $('form-organizador').value = currentUserEmail || '';
    $('form-organizador').placeholder = 'Correo (predeterminado: inicio de sesión)';
    $('form-asunto').value = '';
    $('form-invitados').value = '';
    $('form-error').textContent = '';
  }

  async function submitReservation(e) {
    e.preventDefault();
    if (!supabase) return;
    const hora = parseInt($('form-hora').value, 10);
    const fecha = $('form-fecha').value;
    const organizador = $('form-organizador').value.trim();
    const asunto = $('form-asunto').value.trim();
    const invitados = $('form-invitados').value.trim();
    if (!organizador || !asunto) {
      $('form-error').textContent = 'Organizador y asunto son obligatorios.';
      return;
    }
    const horaStr = hourToLabel(hora);
    const existing = reservations.filter((r) => r.fecha === fecha && r.hora && r.hora.startsWith(String(hora).padStart(2, '0')));
    if (existing.length > 0) {
      $('form-error').textContent = 'Ya hay una reserva a las ' + horaStr + ' ese día. Solo se permite una reserva por hora.';
      return;
    }
    $('form-error').textContent = '';
    const { error } = await supabase.from('reservations').insert({
      fecha,
      hora: horaStr,
      responsable: organizador,
      asunto,
      participantes: invitados,
      reservado_por: currentUserEmail || '',
      nombre_contacto: '',
      correo_notificacion: '',
    });
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

    $('reservation-form').addEventListener('submit', submitReservation);

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
