importScripts('./db-helper.js');

const CACHE_STATIC_NAME = 'static-outbox-v2';
const STATIC_FILES = [
  './',
  './index.html',
  './styles.css',
  './db-helper.js',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC_NAME)
      .then((cache) => cache.addAll(STATIC_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(
        nombres.filter((nombre) => nombre !== CACHE_STATIC_NAME)
          .map((nombre) => caches.delete(nombre))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((respuesta) => {
          event.waitUntil(
            caches.open(CACHE_STATIC_NAME).then((cache) => cache.put(event.request, respuesta.clone()))
          );
          return respuesta;
        })
        .catch(() => caches.match(event.request)
          .then((respuesta) => respuesta || caches.match('./index.html'))
          .then((respuesta) => respuesta || caches.match('./')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((respuesta) => {
      if (respuesta) {
        return respuesta;
      }

      return fetch(event.request).then((fresca) => {
        if (fresca && fresca.ok) {
          event.waitUntil(
            caches.open(CACHE_STATIC_NAME).then((cache) => cache.put(event.request, fresca.clone()))
          );
        }

        return fresca;
      });
    })
  );
});

function notificarClientesActualizacion() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clientes) => {
      clientes.forEach((cliente) => {
        cliente.postMessage({
          tipo: 'OUTBOX_SINCRONIZADO',
          timestamp: Date.now()
        });
      });
    });
}

function sincronizarPendientesSW() {
  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        return [];
      }

      return Promise.all(pendientes.map((item) => {
        return fetch('https://jsonplaceholder.typicode.com/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        }).then((respuesta) => {
          if (!respuesta.ok) {
            throw new Error('HTTP ' + respuesta.status + ' al sincronizar ID ' + item.id);
          }

          return actualizarEstadoRegistro(item.id, 'sincronizado');
        });
      })).then(() => notificarClientesActualizacion());
    });
}

self.addEventListener('sync', (event) => {
  if (event.tag !== 'sync-reportes') {
    return;
  }

  event.waitUntil(
    sincronizarPendientesSW().catch((error) => {
      console.error('[SW-Sync] Fallo en la sincronización:', error);
      throw error;
    })
  );
});
