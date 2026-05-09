/**
 * mi-espacio-sync.js  — v2.0
 * Biblioteca central de autenticación y sincronización con Supabase.
 * Expone window.MiEspacio con:
 *   - initAuth(onUserReady)
 *   - Profile.get(userId) / Profile.save(userId, data)
 *   - Sync.upsert(table, id, data, userId)
 *   - Sync.delete(table, id)
 *   - Sync.fetchAll(table, userId)
 *   - openProfileModal(userId, email)
 *
 * Tablas Supabase soportadas:
 *   habits · startup_data · subjects · assignments · grades · study_log · profiles
 */

(function () {
  /* ─────────────────────────────────────────
     CONFIGURACIÓN  —  pon tus credenciales aquí
  ───────────────────────────────────────── */
  const SUPABASE_URL  = 'https://ambptdfrdhrfuryuizvk.supabase.co';   // ← cambia esto
  const SUPABASE_ANON = 'sb_publishable_tDg7frxML2LiHoZnmo2-9Q_ZxOMlxgZ';                       // ← cambia esto

  /* ─────────────────────────────────────────
     CLIENTE SUPABASE (REST + Auth)
  ───────────────────────────────────────── */
  let _session = null;   // { access_token, user }

  async function sbFetch(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${_session?.access_token || SUPABASE_ANON}`,
      ...options.headers,
    };
    const res = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Supabase error ${res.status}: ${err}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  /* ─────────────────────────────────────────
     AUTH
  ───────────────────────────────────────── */
  const TOKEN_KEY = 'misespacio_session';

  function saveSession(session) {
    _session = session;
    try { localStorage.setItem(TOKEN_KEY, JSON.stringify(session)); } catch (_) {}
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (raw) _session = JSON.parse(raw);
    } catch (_) {}
    return _session;
  }

  async function refreshSession() {
    if (!_session?.refresh_token) return null;
    try {
      const data = await sbFetch('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: _session.refresh_token }),
        headers: { 'Authorization': `Bearer ${SUPABASE_ANON}` },
      });
      if (data?.access_token) { saveSession(data); return data; }
    } catch (_) {}
    return null;
  }

  async function signInWithEmail(email, password) {
    const data = await sbFetch('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      headers: { 'Authorization': `Bearer ${SUPABASE_ANON}` },
    });
    saveSession(data);
    return data;
  }

  async function signUpWithEmail(email, password) {
    const data = await sbFetch('/auth/v1/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      headers: { 'Authorization': `Bearer ${SUPABASE_ANON}` },
    });
    if (data?.access_token) saveSession(data);
    return data;
  }

  async function signOut() {
    try {
      await sbFetch('/auth/v1/logout', { method: 'POST' });
    } catch (_) {}
    _session = null;
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
  }

  async function getUser() {
    if (!_session?.access_token) return null;
    try {
      const data = await sbFetch('/auth/v1/user');
      return data;
    } catch (_) { return null; }
  }

  /* ─────────────────────────────────────────
     SYNC — operaciones CRUD genéricas
     Esquema: cada fila tiene (id, user_id, data, updated_at)
     Excepciones:
       · startup_data usa (user_id, data) sin id separado
       · profiles usa (user_id, name, avatar_color)
  ───────────────────────────────────────── */
  const Sync = {
    /** Upsert para tablas con id propio: habits, subjects, assignments, grades, study_log */
    async upsert(table, id, data, userId) {
      return sbFetch(`/rest/v1/${table}?on_conflict=id`, {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ id, user_id: userId, data, updated_at: new Date().toISOString() }),
      });
    },

    /** Upsert para startup_data (clave primaria: user_id) */
    async upsertStartup(data, userId) {
      return sbFetch(`/rest/v1/startup_data?on_conflict=user_id`, {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ user_id: userId, data, updated_at: new Date().toISOString() }),
      });
    },

    /** Fetch todas las filas de un usuario en una tabla con id */
    async fetchAll(table, userId) {
      const rows = await sbFetch(
        `/rest/v1/${table}?user_id=eq.${userId}&order=updated_at.asc`,
      );
      return rows || [];
    },

    /** Fetch startup_data (fila única por usuario) */
    async fetchStartup(userId) {
      const rows = await sbFetch(`/rest/v1/startup_data?user_id=eq.${userId}&limit=1`);
      return rows?.[0] || null;
    },

    /** Eliminar fila por id */
    async delete(table, id) {
      return sbFetch(`/rest/v1/${table}?id=eq.${id}`, { method: 'DELETE' });
    },
  };

  /* ─────────────────────────────────────────
     PROFILE
  ───────────────────────────────────────── */
  const Profile = {
    async get(userId) {
      try {
        const rows = await sbFetch(`/rest/v1/profiles?user_id=eq.${userId}&limit=1`);
        return rows?.[0] || null;
      } catch (_) { return null; }
    },
    async save(userId, { name, avatar_color }) {
      return sbFetch(`/rest/v1/profiles?on_conflict=user_id`, {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ user_id: userId, name, avatar_color, updated_at: new Date().toISOString() }),
      });
    },
  };

  /* ─────────────────────────────────────────
     MODAL DE AUTENTICACIÓN (se inyecta en el DOM)
  ───────────────────────────────────────── */
  function injectAuthModal() {
    if (document.getElementById('_auth-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = '_auth-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(28,27,25,.82);backdrop-filter:blur(6px);
      display:flex;align-items:center;justify-content:center;z-index:99999;
      font-family:'DM Sans',sans-serif;
    `;
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:36px 32px;width:340px;max-width:92vw;box-shadow:0 24px 60px rgba(0,0,0,.18);">
        <h2 style="font-family:'Playfair Display',serif;font-size:1.6rem;letter-spacing:-.02em;margin-bottom:4px;">Mi Espacio</h2>
        <p style="font-size:.8rem;color:#8c8a83;margin-bottom:24px;">Inicia sesión para sincronizar tus datos</p>
        <div id="_auth-err" style="display:none;background:#fdf0e8;border:1px solid #f4c4a0;border-radius:8px;padding:10px 12px;font-size:.78rem;color:#c4622d;margin-bottom:14px;"></div>
        <input id="_auth-email" type="email" placeholder="correo@ejemplo.com"
          style="width:100%;border:1.5px solid #e5e3db;border-radius:10px;padding:10px 13px;font-size:.9rem;font-family:inherit;margin-bottom:10px;outline:none;"/>
        <input id="_auth-pw" type="password" placeholder="Contraseña"
          style="width:100%;border:1.5px solid #e5e3db;border-radius:10px;padding:10px 13px;font-size:.9rem;font-family:inherit;margin-bottom:18px;outline:none;"/>
        <button id="_auth-login-btn" onclick="_authAction('login')"
          style="width:100%;background:#1c1b19;color:#fff;border:none;border-radius:10px;padding:12px;font-size:.92rem;font-weight:600;cursor:pointer;margin-bottom:8px;">
          Iniciar sesión
        </button>
        <button onclick="_authAction('signup')"
          style="width:100%;background:transparent;color:#8c8a83;border:1.5px solid #e5e3db;border-radius:10px;padding:11px;font-size:.88rem;font-weight:500;cursor:pointer;">
          Crear cuenta nueva
        </button>
        <p style="text-align:center;font-size:.72rem;color:#ccc;margin-top:16px;">
          Tus datos se cifran y sincronizan en la nube
        </p>
      </div>`;
    document.body.appendChild(overlay);

    // Enter key
    overlay.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') _authAction('login'); });
    });
  }

  window._authAction = async function (type) {
    const email = document.getElementById('_auth-email').value.trim();
    const pw    = document.getElementById('_auth-pw').value;
    const errEl = document.getElementById('_auth-err');
    errEl.style.display = 'none';

    if (!email || !pw) { errEl.textContent = 'Completa email y contraseña.'; errEl.style.display = 'block'; return; }

    const btn = document.getElementById('_auth-login-btn');
    btn.disabled = true; btn.textContent = 'Cargando…';

    try {
      const fn = type === 'signup' ? signUpWithEmail : signInWithEmail;
      const data = await fn(email, pw);
      if (!data?.user && !data?.id) throw new Error('Respuesta inesperada de Supabase');
      document.getElementById('_auth-overlay').remove();
      const user = data.user || data;
      _onUserReady && _onUserReady(user);
    } catch (err) {
      errEl.textContent = err.message.includes('Invalid login') ? 'Email o contraseña incorrectos.' : err.message;
      errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Iniciar sesión';
    }
  };

  /* ─────────────────────────────────────────
     MODAL DE PERFIL
  ───────────────────────────────────────── */
  function openProfileModal(userId, email) {
    let m = document.getElementById('_profile-modal');
    if (m) m.remove();

    const COLORS = ['#2c5f8a','#3d6b4f','#c4622d','#9a6f1e','#6b4a8a','#1c1b19'];

    m = document.createElement('div');
    m.id = '_profile-modal';
    m.style.cssText = `position:fixed;inset:0;background:rgba(28,27,25,.7);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:'DM Sans',sans-serif;`;
    m.innerHTML = `
      <div style="background:#fff;border-radius:18px;padding:28px 26px;width:300px;max-width:90vw;box-shadow:0 16px 40px rgba(0,0,0,.15);">
        <h3 style="font-family:'Playfair Display',serif;font-size:1.3rem;margin-bottom:4px;">Perfil</h3>
        <p style="font-size:.75rem;color:#8c8a83;margin-bottom:20px;">${email}</p>
        <label style="font-size:.75rem;font-weight:600;color:#8c8a83;letter-spacing:.06em;text-transform:uppercase;">Nombre</label>
        <input id="_prof-name" type="text" placeholder="Tu nombre"
          style="width:100%;border:1.5px solid #e5e3db;border-radius:8px;padding:9px 12px;font-size:.9rem;font-family:inherit;margin:6px 0 16px;outline:none;"/>
        <label style="font-size:.75rem;font-weight:600;color:#8c8a83;letter-spacing:.06em;text-transform:uppercase;">Color de avatar</label>
        <div style="display:flex;gap:8px;margin:8px 0 20px;flex-wrap:wrap;">
          ${COLORS.map(c => `<div onclick="_pickColor('${c}')" data-color="${c}"
            style="width:28px;height:28px;border-radius:50%;background:${c};cursor:pointer;border:2px solid transparent;transition:transform .15s;"></div>`).join('')}
        </div>
        <button onclick="_saveProfile('${userId}')"
          style="width:100%;background:#1c1b19;color:#fff;border:none;border-radius:9px;padding:11px;font-size:.88rem;font-weight:600;cursor:pointer;margin-bottom:8px;">
          Guardar
        </button>
        <button onclick="window.MiEspacio.signOut()"
          style="width:100%;background:transparent;color:#c4622d;border:1.5px solid #f4c4a0;border-radius:9px;padding:10px;font-size:.85rem;font-weight:500;cursor:pointer;margin-bottom:8px;">
          Cerrar sesión
        </button>
        <button onclick="document.getElementById('_profile-modal').remove()"
          style="width:100%;background:transparent;color:#8c8a83;border:1.5px solid #e5e3db;border-radius:9px;padding:10px;font-size:.85rem;cursor:pointer;">
          Cancelar
        </button>
      </div>`;
    document.body.appendChild(m);

    Profile.get(userId).then(p => {
      if (p?.name) document.getElementById('_prof-name').value = p.name;
      if (p?.avatar_color) _pickColor(p.avatar_color);
    });
  }

  let _selectedColor = '#2c5f8a';
  window._pickColor = function (c) {
    _selectedColor = c;
    document.querySelectorAll('#_profile-modal [data-color]').forEach(el => {
      el.style.border = el.dataset.color === c ? '2.5px solid #1c1b19' : '2px solid transparent';
    });
  };

  window._saveProfile = async function (userId) {
    const name = document.getElementById('_prof-name').value.trim();
    await Profile.save(userId, { name, avatar_color: _selectedColor });
    document.getElementById('_profile-modal').remove();
    location.reload();
  };

  /* ─────────────────────────────────────────
     initAuth — punto de entrada principal
  ───────────────────────────────────────── */
  let _onUserReady = null;

  async function initAuth(onUserReady) {
    _onUserReady = onUserReady;

    // 1. Intentar sesión guardada
    loadSession();

    if (_session?.access_token) {
      let user = await getUser();

      // Si el token expiró, intentar refresh
      if (!user && _session.refresh_token) {
        const refreshed = await refreshSession();
        if (refreshed) user = await getUser();
      }

      if (user) {
        onUserReady(user);
        return;
      }
    }

    // 2. No hay sesión válida → mostrar modal de login
    injectAuthModal();
  }

  /* ─────────────────────────────────────────
     EXPOSICIÓN PÚBLICA
  ───────────────────────────────────────── */
  window.MiEspacio = {
    initAuth,
    signOut,
    Sync,
    Profile,
    openProfileModal,
  };

})();
