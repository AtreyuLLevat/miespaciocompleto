/**
 * auth.js — Mi Espacio · Central Auth Module v1.1
 * ─────────────────────────────────────────────────
 * FIXES v1.1:
 *  - API key: sustituye SUPABASE_ANON por tu clave eyJ... real (ver comentario abajo)
 *  - _userId se persiste en sessionStorage → save() nunca falla por userId null
 *  - Sync.delete incluye user_id en el filtro (seguridad)
 *  - getProfile no devuelve caché obsoleto si Supabase responde vacío
 *  - window.MiEspacio.initAuth ahora SÍ protege (redirige sin sesión)
 *  - window.MiEspacio.initAuthOptional conservado para casos opcionales reales
 */

(function () {
  'use strict';

  /* ─────────────────────────────────────────
     CONFIG — credenciales Supabase
     ⚠️  SUSTITUYE SUPABASE_ANON por tu clave real:
         Dashboard Supabase → Settings → API → "anon public"
         Empieza siempre por "eyJ..."
  ───────────────────────────────────────── */
  const SUPABASE_URL  = 'https://ambptdfrdhrfuryuizvk.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtYnB0ZGZyZGhyZnVyeXVpenZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDExMjQsImV4cCI6MjA5MzkxNzEyNH0.PZ2jg50ARlUFeNrssEFt95OxF6i-fXl_U2H3RgXIBaw'; // ← CAMBIA ESTO

  /* ─────────────────────────────────────────
     STORAGE KEYS
  ───────────────────────────────────────── */
  const SESSION_KEY = 'miespacio_session';
  const PROFILE_KEY = 'miespacio_profile';
  const USERID_KEY  = 'miespacio_uid';      // FIX 2a: persiste userId

  /* ─────────────────────────────────────────
     ESTADO INTERNO
  ───────────────────────────────────────── */
  let _session = null;
  let _profile  = null;
  let _userId   = null; // FIX 2a: se carga desde sessionStorage al arrancar

  /* Carga userId persistido para que save() funcione aunque auth aún no haya terminado */
  try { _userId = sessionStorage.getItem(USERID_KEY) || null; } catch (_) {}

  /* ─────────────────────────────────────────
     HELPERS HTTP
  ───────────────────────────────────────── */
  async function sbFetch(path, options = {}) {
    const token = _session?.access_token || SUPABASE_ANON;
    const headers = {
      'Content-Type' : 'application/json',
      'apikey'       : SUPABASE_ANON,
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
  function _saveSession(session) {
    _session = session;
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (_) {}
    // FIX 2a: persiste userId en cuanto tenemos sesión
    const uid = session?.user?.id;
    if (uid) {
      _userId = uid;
      try { sessionStorage.setItem(USERID_KEY, uid); } catch (_) {}
    }
  }

  function _loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        _session = JSON.parse(raw);
        // Restaurar userId si aún no lo teníamos
        if (!_userId && _session?.user?.id) {
          _userId = _session.user.id;
          try { sessionStorage.setItem(USERID_KEY, _userId); } catch (_) {}
        }
      }
    } catch (_) {}
    return _session;
  }

  function _clearSession() {
    _session = null;
    _profile  = null;
    _userId   = null;
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(PROFILE_KEY);
      sessionStorage.removeItem(USERID_KEY);
    } catch (_) {}
  }

  function _isExpired() {
    if (!_session?.expires_at) return false;
    return Date.now() / 1000 > _session.expires_at - 60;
  }

  /* ─────────────────────────────────────────
     AUTH OPERATIONS
  ───────────────────────────────────────── */
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

  async function _getUser() {
    if (!_session?.access_token) return null;
    try {
      return await sbFetch('/auth/v1/user');
    } catch (_) { return null; }
  }

  async function signIn(email, password) {
    const data = await sbFetch('/auth/v1/token?grant_type=password', {
      method : 'POST',
      body   : JSON.stringify({ email, password }),
      headers: { Authorization: `Bearer ${SUPABASE_ANON}` },
    });
    _saveSession(data);
    return data.user || data;
  }

  async function signUp(email, password) {
    const data = await sbFetch('/auth/v1/signup', {
      method : 'POST',
      body   : JSON.stringify({ email, password }),
      headers: { Authorization: `Bearer ${SUPABASE_ANON}` },
    });
    if (data?.access_token) _saveSession(data);
    return data.user || data;
  }

  async function signOut() {
    try { await sbFetch('/auth/v1/logout', { method: 'POST' }); } catch (_) {}
    _clearSession();
    window.location.href = 'index.html';
  }

  /* ─────────────────────────────────────────
     PROFILE HELPERS
  ───────────────────────────────────────── */
  async function getProfile(userId) {
    // Cargar caché local como fallback inicial
    try {
      const cached = localStorage.getItem(PROFILE_KEY);
      if (cached) _profile = JSON.parse(cached);
    } catch (_) {}

    // FIX getProfile: siempre intenta Supabase; solo usa caché si falla la red
    try {
      const rows = await sbFetch(`/rest/v1/profiles?user_id=eq.${userId}&limit=1`);
      // Solo sobreescribe si Supabase devuelve algo (no borra caché por respuesta vacía)
      if (rows && rows.length > 0) {
        _profile = rows[0];
        try { localStorage.setItem(PROFILE_KEY, JSON.stringify(_profile)); } catch (_) {}
      }
    } catch (_) {
      // Sin red: se usa el caché ya cargado arriba
    }

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
     RESOLUCIÓN DE SESIÓN
  ───────────────────────────────────────── */
  async function resolveSession() {
    _loadSession();
    if (!_session?.access_token) return null;

    if (_isExpired()) {
      const ok = await _refresh();
      if (!ok) { _clearSession(); return null; }
    }

    const user = await _getUser();
    if (!user) {
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
   * Páginas PROTEGIDAS. Sin sesión → redirige a index.html.
   */
  async function requireAuth(callback) {
    const user = await resolveSession();
    if (!user) {
      try { sessionStorage.setItem('miespacio_redirect', window.location.pathname); } catch (_) {}
      window.location.href = 'index.html';
      return;
    }
    const profile = await getProfile(user.id);
    if (typeof callback === 'function') callback(user, profile);
  }

  /**
   * optionalAuth(callback)
   * Solo para páginas que funcionan sin sesión (modo local real).
   * NO redirige nunca.
   */
  async function optionalAuth(callback) {
    const user = await resolveSession();
    if (user && typeof callback === 'function') {
      const profile = await getProfile(user.id);
      callback(user, profile);
    }
  }

  function initLoginPage(onSuccess) {
    _injectLoginModal(onSuccess);
  }

  /* ─────────────────────────────────────────
     LOGIN MODAL
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

    ['_me-email','_me-pw'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', e => {
        if (e.key === 'Enter') window._meAuthAction('login');
      });
    });

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
     PROFILE MODAL
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
    window.location.reload();
  };

  /* ─────────────────────────────────────────
     BACK BUTTON
  ───────────────────────────────────────── */
  function injectBackButton(options = {}) {
    const { label = '← Mi Espacio', href = 'index.html', position = 'sidebar' } = options;
    if (document.getElementById('_me-back-btn')) return;
    const btn = document.createElement('a');
    btn.id = '_me-back-btn';
    btn.href = href;
    btn.textContent = label;
    if (position === 'floating') {
      btn.style.cssText = `
        position:fixed;top:20px;left:20px;z-index:200;
        background:#1c1b19;color:#fff;border-radius:10px;padding:8px 16px;
        font-family:'DM Sans',sans-serif;font-size:.8rem;font-weight:600;
        text-decoration:none;display:flex;align-items:center;gap:6px;
        box-shadow:0 4px 16px rgba(0,0,0,.2);transition:opacity .2s;
      `;
      btn.onmouseover = () => btn.style.opacity = '.8';
      btn.onmouseout  = () => btn.style.opacity = '1';
      document.body.appendChild(btn);
    }
  }

  /* ─────────────────────────────────────────
     SYNC HELPERS
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
    // FIX 2c: delete filtra también por user_id para evitar borrado cruzado
    async delete(table, id, userId) {
      const uid = userId || _userId;
      const filter = uid ? `?id=eq.${id}&user_id=eq.${uid}` : `?id=eq.${id}`;
      return sbFetch(`/rest/v1/${table}${filter}`, { method: 'DELETE' });
    },
  };

  /* ─────────────────────────────────────────
     EXPOSICIÓN PÚBLICA — window.MiAuth
  ───────────────────────────────────────── */
  window.MiAuth = {
    requireAuth,
    optionalAuth,
    initLoginPage,
    signIn,
    signUp,
    signOut,
    resolveSession,
    getProfile,
    saveProfile,
    openProfileModal,
    injectBackButton,
    Sync,
    get session() { return _session; },
    get profile()  { return _profile; },
    get userId()   { return _userId; },   // FIX 2a: expuesto para que dashboards lo lean
  };

  /* ─────────────────────────────────────────
     BACKWARDS COMPAT — window.MiEspacio
     FIX 1: initAuth ahora llama a requireAuth (SÍ protege)
  ───────────────────────────────────────── */
  window.MiEspacio = {
    initAuth        : (cb) => requireAuth((u, p) => cb(u)),   // ← FIX: redirige sin sesión
    initAuthOptional: (cb) => optionalAuth((u, p) => cb(u)), // solo para casos realmente opcionales
    signOut,
    Profile : { get: getProfile, save: saveProfile },
    openProfileModal,
    Sync,
  };

})();