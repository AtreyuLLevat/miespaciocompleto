/**
 * mi-espacio-sync.js — Compatibility Shim v3.0
 * ─────────────────────────────────────────────
 * Este archivo ya NO contiene la lógica de auth/sync.
 * Toda la lógica está centralizada en auth.js.
 *
 * Este shim existe únicamente para compatibilidad retroactiva
 * con código antiguo que importa este archivo.
 *
 * Si ves este archivo en un dashboard, asegúrate de que
 * auth.js se carga ANTES que este archivo.
 *
 * ORDEN CORRECTO en los dashboards:
 *   <script src="auth.js"></script>         ← PRIMERO
 *   <script src="mi-espacio-sync.js"></script>  ← compatibilidad (opcional)
 */

(function () {
  // Si auth.js ya se cargó, window.MiEspacio ya existe (definido en auth.js).
  // No hacemos nada — evitamos sobrescribir.
  if (window.MiEspacio && window.MiAuth) {
    console.info('[mi-espacio-sync] auth.js detectado. Usando MiAuth centralizado.');
    return;
  }

  // Si auth.js NO se cargó (carga aislada del shim), mostrar advertencia.
  console.warn(
    '[mi-espacio-sync] auth.js no encontrado. ' +
    'Asegúrate de cargar auth.js antes de mi-espacio-sync.js. ' +
    'Consulta la documentación del proyecto.'
  );

  // Stub mínimo para que la página no crashee si falta auth.js
  window.MiEspacio = window.MiEspacio || {
    initAuth        : (cb) => cb({ id: 'local', email: 'local@offline.mode' }),
    initAuthOptional: (_) => {},
    signOut         : () => { window.location.href = 'index.html'; },
    Profile         : { get: async () => null, save: async () => {} },
    openProfileModal: () => {},
    Sync            : {
      upsert        : async () => null,
      upsertStartup : async () => null,
      fetchAll      : async () => [],
      fetchStartup  : async () => null,
      delete        : async () => null,
    },
  };
})();