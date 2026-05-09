/**
 * auth.js — Mi Espacio · Central Auth Module v1.0
 * ─────────────────────────────────────────────────
 * Centraliza toda la lógica de autenticación Supabase.
 * Usado por TODAS las páginas del proyecto.
 *
 * Uso en páginas secundarias (dashboards):
 *   <script src="auth.js"></script>
 *   <script>
 *     MiAuth.requireAuth(user => { ... });   // redirige si no hay sesión
 *     MiAuth.optionalAuth(user => { ... });  // no redirige, modo local
 *   </script>
 *
 * Uso en index.html (login):
 *   MiAuth.initLoginPage(onSuccess);
 */

(function () {
  'use strict';

  /* ─────────────────────────────────────────
     CONFIG — credenciales Supabase
  ───────────────────────────────────────── */
  const SUPABASE_URL  = 'https://ambptdfrdhrfuryuizvk.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_tDg7frxML2LiHoZnmo2-9Q_ZxOMlxgZ';

  /* ─────────────────────────────────────────
     STORAGE KEYS
  ───────────────────────────────────────── */
  const SESSION_KEY = 'miespacio_session';  // sesión Supabase completa
  const PROFILE_KEY = 'miespacio_profile'; // caché del perfil de usuario

  /* ─────────────────────────────────────────
     ESTADO INTERNO
  ───────────────────────────────────────── */
  let _session = null;  // { access_token, refresh_token, user, expires_at }
  let _profile  = null; // { name, avatar_color }

  /* ─────────────────────────────────────────
     HELPERS HTTP — REST client mínimo
  ───────────────────────────────────────── */
  async function sbFetch(path, options = {}) {
    const token = _session?.access_token || SUPABASE_ANON;
    const headers = {
      'Content-Type': 'application/json',
      'apikey'      : SUPABASE_ANON,
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {}),
    };
    const res = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText);
      throw new Error(`Supabase ${res.status}: ${msg}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  /* ─────────────────────────────────────────
     SESSION HELPERS
  ───────────────────────────────────────── */

  /** Persiste la sesión en localStorage */
  function _saveSession(session) {
    _session = session;
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (_) {}
  }

  /** Carga sesión desde localStorage */
  function _loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) _session = JSON.parse(raw);
    } catch (_) {}
    return _session;
  }

  /** Elimina sesión del almacenamiento */
  function _clearSession() {
    _session = null;
    _profile  = null;
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(PROFILE_KEY);
    } catch (_) {}
  }

  /** Comprueba si el access_token ha expirado (margen de 60s) */
  function _isExpired() {
    if (!_session?.expires_at) return false;
    return Date.now() / 1000 > _session.expires_at - 60;
  }

  /* ─────────────────────────────────────────
     AUTH OPERATIONS
  ───────────────────────────────────────── */

  /** Refresca el token usando refresh_token */
  async function _refresh() {
    if (!_session?.refresh_token) return false;
    try {
      const data = await sbFetch('/auth/v1/token?grant_type=refresh_token', {
        method : 'POST',
        body   : JSON.stringify({ refresh_token: _session.refresh_token }),
        headers: { Authorization: `Bearer ${SUPABASE_ANON}` },
      });
      if (data?.access_token) { _saveSession(data); return true; }
    } catch (_) {}
    return false;
  }

  /** Devuelve el usuario actual desde Supabase /auth/v1/user */
  async function _getUser() {
    if (!_session?.access_token) return null;
    try {
      return await sbFetch('/auth/v1/user');
    } catch (_) { return null; }
  }

  /** Login con email + contraseña */
  async function signIn(email, password) {
    const data = await sbFetch('/auth/v1/token?grant_type=password', {
      method : 'POST',
      body   : JSON.stringify({ email, password }),
      headers: { Authorization: `Bearer ${SUPABASE_ANON}` },
    });
    _saveSession(data);
    return data.user || data;
  }

  /** Registro con email + contraseña */
  async function signUp(email, password) {
    const data = await sbFetch('/auth/v1/signup', {
      method : 'POST',
      body   : JSON.stringify({ email, password }),
      headers: { Authorization: `Bearer ${SUPABASE_ANON}` },
    });
    if (data?.access_token) _saveSession(data);
    return data.user || data;
  }

  /** Cierra sesión y limpia estado */
  async function signOut() {
    try { await sbFetch('/auth/v1/logout', { method: 'POST' }); } catch (_) {}
    _clearSession();
    window.location.href = 'index.html';
  }

  /* ─────────────────────────────────────────
     PROFILE HELPERS
  ───────────────────────────────────────── */

  async function getProfile(userId) {
    // intentar desde caché
    try {
      const cached = localStorage.getItem(PROFILE_KEY);
      if (cached) { _profile = JSON.parse(cached); }
    } catch (_) {}

    // siempre refresca desde Supabase en background
    try {
      const rows = await sbFetch(`/rest/v1/profiles?user_id=eq.${userId}&limit=1`);
      if (rows?.[0]) {
        _profile = rows[0];
        localStorage.setItem(PROFILE_KEY, JSON.stringify(_profile));
      }
    } catch (_) {}

    return _profile;
  }

  async function saveProfile(userId, { name, avatar_color }) {
    const data = { user_id: userId, name, avatar_color, updated_at: new Date().toISOString() };
    await sbFetch(`/rest/v1/profiles?on_conflict=user_id`, {
      method : 'POST',
      body   : JSON.stringify(data),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    _profile = { ..._profile, name, avatar_color };
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(_profile)); } catch (_) {}
  }

  /* ─────────────────────────────────────────
     RESOLUCIÓN DE SESIÓN — flujo central
  ───────────────────────────────────────── */

  /**
   * Resuelve la sesión actual.
   * Devuelve el usuario si hay sesión válida, null si no.
   */
  async function resolveSession() {
    _loadSession();
    if (!_session?.access_token) return null;

    // Si el token está por expirar, intentar refresh
    if (_isExpired()) {
      const ok = await _refresh();
      if (!ok) { _clearSession(); return null; }
    }

    const user = await _getUser();
    if (!user) {
      // Último intento con refresh
      const ok = await _refresh();
      if (!ok) { _clearSession(); return null; }
      return await _getUser();
    }
    return user;
  }

  /* ─────────────────────────────────────────
     API PÚBLICA
  ───────────────────────────────────────── */

  /**
   * requireAuth(callback)
   * Úsalo en páginas PROTEGIDAS (dashboards).
   * Si no hay sesión → redirige a index.html
   * Si hay sesión → llama callback(user, profile)
   */
  async function requireAuth(callback) {
    const user = await resolveSession();
    if (!user) {
      // Guardar la página actual para redirect tras login
      try { sessionStorage.setItem('miespacio_redirect', window.location.pathname); } catch (_) {}
      window.location.href = 'index.html';
      return;
    }
    const profile = await getProfile(user.id);
    if (typeof callback === 'function') callback(user, profile);
  }

  /**
   * optionalAuth(callback)
   * Úsalo cuando la página funciona también sin sesión (modo local).
   * No redirige. Si hay sesión → llama callback(user, profile).
   */
  async function optionalAuth(callback) {
    const user = await resolveSession();
    if (user && typeof callback === 'function') {
      const profile = await getProfile(user.id);
      callback(user, profile);
    }
  }

  /**
   * initLoginPage(onSuccess)
   * Inyecta y gestiona el modal de login en index.html.
   * Llama onSuccess(user, profile) tras login exitoso.
   */
  function initLoginPage(onSuccess) {
    _injectLoginModal(onSuccess);
  }

  /* ─────────────────────────────────────────
     LOGIN MODAL — inyectado en index.html
  ───────────────────────────────────────── */
  function _injectLoginModal(onSuccess) {
    if (document.getElementById('_me-auth-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = '_me-auth-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;
      background:rgba(28,27,25,.88);
      backdrop-filter:blur(8px);
      display:flex;align-items:center;justify-content:center;
      z-index:99999;font-family:'DM Sans',sans-serif;
    `;
    overlay.innerHTML = `
      <div style="
        background:#fff;border-radius:24px;
        padding:40px 36px;width:360px;max-width:92vw;
        box-shadow:0 32px 80px rgba(0,0,0,.22);
        animation:_meSlideUp .3s cubic-bezier(.4,0,.2,1);
      ">
        <style>
          @keyframes _meSlideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
          #_me-auth-overlay input{transition:border-color .15s,box-shadow .15s;}
          #_me-auth-overlay input:focus{border-color:#1c1b19!important;box-shadow:0 0 0 3px rgba(28,27,25,.08)!important;outline:none;}
        </style>
        <div style="margin-bottom:28px">
          <div style="font-family:'Playfair Display',serif;font-size:1.8rem;letter-spacing:-.03em;color:#1c1b19;margin-bottom:4px">
            Mi Espacio
          </div>
          <p style="font-size:.82rem;color:#8c8a83;line-height:1.4">
            Tu espacio personal. Inicia sesión para sincronizar todos tus datos en la nube.
          </p>
        </div>

        <div id="_me-err" style="display:none;background:#fdf0e8;border:1px solid #f4c4a0;border-radius:10px;padding:10px 14px;font-size:.78rem;color:#c4622d;margin-bottom:14px;"></div>

        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:18px">
          <input id="_me-email" type="email" placeholder="tu@correo.com" style="
            border:1.5px solid #e5e3db;border-radius:12px;padding:11px 14px;
            font-size:.9rem;font-family:'DM Sans',sans-serif;background:#f8f7f4;
            color:#1c1b19;width:100%;
          "/>
          <input id="_me-pw" type="password" placeholder="Contraseña" style="
            border:1.5px solid #e5e3db;border-radius:12px;padding:11px 14px;
            font-size:.9rem;font-family:'DM Sans',sans-serif;background:#f8f7f4;
            color:#1c1b19;width:100%;
          "/>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px">
          <button id="_me-login-btn" onclick="window._meAuthAction('login')" style="
            background:#1c1b19;color:#fff;border:none;border-radius:12px;
            padding:13px;font-size:.9rem;font-weight:600;
            font-family:'DM Sans',sans-serif;cursor:pointer;
            transition:opacity .2s;width:100%;
          " onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
            Iniciar sesión
          </button>
          <button onclick="window._meAuthAction('signup')" style="
            background:transparent;color:#8c8a83;
            border:1.5px solid #e5e3db;border-radius:12px;
            padding:12px;font-size:.85rem;font-weight:500;
            font-family:'DM Sans',sans-serif;cursor:pointer;
            transition:border-color .15s,color .15s;width:100%;
          " onmouseover="this.style.borderColor='#1c1b19';this.style.color='#1c1b19'"
             onmouseout="this.style.borderColor='#e5e3db';this.style.color='#8c8a83'">
            Crear cuenta nueva
          </button>
        </div>

        <p style="text-align:center;font-size:.7rem;color:#ccc;margin-top:18px;">
          🔒 Datos cifrados · Sincronización automática
        </p>
      </div>`;

    document.body.appendChild(overlay);

    // Enter key support
    ['_me-email','_me-pw'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', e => {
        if (e.key === 'Enter') window._meAuthAction('login');
      });
    });

    // Acción de auth (expuesta globalmente para los onclick inline)
    window._meAuthAction = async function (type) {
      const email  = document.getElementById('_me-email')?.value.trim();
      const pw     = document.getElementById('_me-pw')?.value;
      const errEl  = document.getElementById('_me-err');
      const btn    = document.getElementById('_me-login-btn');
      if (errEl) errEl.style.display = 'none';

      if (!email || !pw) {
        if (errEl) { errEl.textContent = 'Por favor, completa email y contraseña.'; errEl.style.display = 'block'; }
        return;
      }

      if (btn) { btn.disabled = true; btn.textContent = 'Entrando…'; }

      try {
        const user = type === 'signup' ? await signUp(email, pw) : await signIn(email, pw);
        if (!user?.id && !user?.email) throw new Error('Respuesta inesperada del servidor.');

        overlay.remove();

        const profile = await getProfile(user.id);

        // Redirect si venía de una página protegida
        const redirect = sessionStorage.getItem('miespacio_redirect');
        sessionStorage.removeItem('miespacio_redirect');

        if (typeof onSuccess === 'function') onSuccess(user, profile, redirect);

      } catch (err) {
        const msg = err.message.includes('Invalid login')
          ? 'Email o contraseña incorrectos.'
          : err.message.includes('already registered')
          ? 'Este email ya tiene cuenta. Inicia sesión.'
          : err.message;
        if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
        if (btn) { btn.disabled = false; btn.textContent = 'Iniciar sesión'; }
      }
    };
  }

  /* ─────────────────────────────────────────
     PROFILE MODAL — accesible desde cualquier página
  ───────────────────────────────────────── */
  const AVATAR_COLORS = [
    '#2c5f8a','#3d6b4f','#c4622d','#9a6f1e',
    '#6b4a8a','#1c1b19','#b5424e','#2a7a7a',
  ];
  let _selectedColor = AVATAR_COLORS[0];

  function openProfileModal(userId, email) {
    document.getElementById('_me-profile-modal')?.remove();

    const m = document.createElement('div');
    m.id = '_me-profile-modal';
    m.style.cssText = `
      position:fixed;inset:0;background:rgba(28,27,25,.7);
      backdrop-filter:blur(6px);display:flex;align-items:center;
      justify-content:center;z-index:99999;font-family:'DM Sans',sans-serif;
    `;

    const name = _profile?.name || '';
    const color = _profile?.avatar_color || AVATAR_COLORS[0];
    _selectedColor = color;

    m.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:32px 28px;width:320px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.18);animation:_meSlideUp .2s ease;">
        <h3 style="font-family:'Playfair Display',serif;font-size:1.3rem;margin-bottom:4px;">Mi Perfil</h3>
        <p style="font-size:.75rem;color:#8c8a83;margin-bottom:22px">${email || ''}</p>

        <label style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#8c8a83;display:block;margin-bottom:6px">Nombre</label>
        <input id="_me-prof-name" value="${name}" placeholder="Tu nombre" style="
          width:100%;border:1.5px solid #e5e3db;border-radius:10px;
          padding:10px 12px;font-size:.9rem;font-family:'DM Sans',sans-serif;
          margin-bottom:18px;outline:none;
        "/>

        <label style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#8c8a83;display:block;margin-bottom:8px">Color de avatar</label>
        <div style="display:flex;gap:8px;margin-bottom:22px;flex-wrap:wrap">
          ${AVATAR_COLORS.map(c => `
            <div onclick="window._mePickColor('${c}')" data-me-color="${c}" style="
              width:30px;height:30px;border-radius:50%;background:${c};cursor:pointer;
              border:2.5px solid ${c===color?'#1c1b19':'transparent'};
              transition:transform .15s;
            " onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='none'"></div>
          `).join('')}
        </div>

        <button onclick="window._meSaveProfile('${userId}')" style="
          width:100%;background:#1c1b19;color:#fff;border:none;border-radius:10px;
          padding:12px;font-size:.88rem;font-weight:600;font-family:'DM Sans',sans-serif;
          cursor:pointer;margin-bottom:8px;
        ">Guardar cambios</button>

        <button onclick="window.MiAuth.signOut()" style="
          width:100%;background:transparent;color:#c4622d;
          border:1.5px solid #f4c4a0;border-radius:10px;
          padding:11px;font-size:.85rem;font-weight:500;
          font-family:'DM Sans',sans-serif;cursor:pointer;margin-bottom:8px;
        ">Cerrar sesión</button>

        <button onclick="document.getElementById('_me-profile-modal').remove()" style="
          width:100%;background:transparent;color:#8c8a83;
          border:1.5px solid #e5e3db;border-radius:10px;
          padding:11px;font-size:.85rem;font-family:'DM Sans',sans-serif;cursor:pointer;
        ">Cancelar</button>
      </div>`;

    document.body.appendChild(m);

    // Cerrar al hacer click fuera
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  }

  window._mePickColor = function (c) {
    _selectedColor = c;
    document.querySelectorAll('[data-me-color]').forEach(el => {
      el.style.border = `2.5px solid ${el.dataset.meColor === c ? '#1c1b19' : 'transparent'}`;
    });
  };

  window._meSaveProfile = async function (userId) {
    const name = document.getElementById('_me-prof-name')?.value.trim();
    await saveProfile(userId, { name, avatar_color: _selectedColor });
    document.getElementById('_me-profile-modal')?.remove();
    // Recargar para reflejar cambios
    window.location.reload();
  };

  /* ─────────────────────────────────────────
     "BACK TO SPACE" COMPONENT
     Inyecta automáticamente el botón en páginas secundarias
  ───────────────────────────────────────── */

  /**
   * injectBackButton(options?)
   * options = { label, href, position }
   * Inyecta el botón "Volver a Mi Espacio" en la página actual.
   * Llamar desde páginas secundarias si no usan sidebar propio.
   */
  function injectBackButton(options = {}) {
    const {
      label    = '← Mi Espacio',
      href     = 'index.html',
      position = 'sidebar', // 'sidebar' | 'floating' | 'topbar'
    } = options;

    if (document.getElementById('_me-back-btn')) return;

    const btn = document.createElement('a');
    btn.id   = '_me-back-btn';
    btn.href = href;
    btn.textContent = label;

    if (position === 'floating') {
      btn.style.cssText = `
        position:fixed;top:20px;left:20px;z-index:200;
        background:#1c1b19;color:#fff;
        border-radius:10px;padding:8px 16px;
        font-family:'DM Sans',sans-serif;font-size:.8rem;font-weight:600;
        text-decoration:none;display:flex;align-items:center;gap:6px;
        box-shadow:0 4px 16px rgba(0,0,0,.2);
        transition:opacity .2s;
      `;
      btn.onmouseover = () => btn.style.opacity = '.8';
      btn.onmouseout  = () => btn.style.opacity = '1';
      document.body.appendChild(btn);
    }
    // Para posición 'sidebar', los sidebars ya incluyen el enlace manualmente.
  }

  /* ─────────────────────────────────────────
     SYNC HELPERS — reexporta funciones de Supabase
     Para compatibilidad con código existente
  ───────────────────────────────────────── */
  const Sync = {
    async upsert(table, id, data, userId) {
      return sbFetch(`/rest/v1/${table}?on_conflict=id`, {
        method : 'POST',
        body   : JSON.stringify({ id, user_id: userId, data, updated_at: new Date().toISOString() }),
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      });
    },
    async upsertStartup(data, userId) {
      return sbFetch(`/rest/v1/startup_data?on_conflict=user_id`, {
        method : 'POST',
        body   : JSON.stringify({ user_id: userId, data, updated_at: new Date().toISOString() }),
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      });
    },
    async fetchAll(table, userId) {
      const rows = await sbFetch(`/rest/v1/${table}?user_id=eq.${userId}&order=updated_at.asc`);
      return rows || [];
    },
    async fetchStartup(userId) {
      const rows = await sbFetch(`/rest/v1/startup_data?user_id=eq.${userId}&limit=1`);
      return rows?.[0] || null;
    },
    async delete(table, id) {
      return sbFetch(`/rest/v1/${table}?id=eq.${id}`, { method: 'DELETE' });
    },
  };

  /* ─────────────────────────────────────────
     EXPOSICIÓN PÚBLICA — window.MiAuth
  ───────────────────────────────────────── */
  window.MiAuth = {
    // Auth
    requireAuth,
    optionalAuth,
    initLoginPage,
    signIn,
    signUp,
    signOut,
    resolveSession,
    // Profile
    getProfile,
    saveProfile,
    openProfileModal,
    // UI helpers
    injectBackButton,
    // Sync (compatibilidad)
    Sync,
    // Getters
    get session() { return _session; },
    get profile()  { return _profile; },
  };

  /* ─────────────────────────────────────────
     BACKWARDS COMPAT — window.MiEspacio alias
     Para no romper código existente en los dashboards
  ───────────────────────────────────────── */
  window.MiEspacio = {
    initAuth        : (cb) => requireAuth((u, p) => cb(u)),
    initAuthOptional: (cb) => optionalAuth((u, p) => cb(u)),
    signOut,
    Profile : { get: getProfile, save: saveProfile },
    openProfileModal,
    Sync,
  };

})();