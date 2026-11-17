const ENDPOINT_REPORTES = 'https://jsonplaceholder.typicode.com/posts';
const ETIQUETA_SYNC = 'sync-reportes';

function actualizarIndicadorRed() {
  const badge = document.getElementById('badge-red');
  const enLinea = navigator.onLine;

  badge.textContent = enLinea ? 'En Línea' : 'Sin Conexión';
  badge.classList.toggle('online', enLinea);
  badge.classList.toggle('offline', !enLinea);
}

function mostrarEstado(mensaje, esError) {
  const estado = document.getElementById('estado-app');
  estado.textContent = mensaje;
  estado.classList.toggle('error', Boolean(esError));
}

function formatearFecha(marcaTiempo) {
  if (!marcaTiempo) {
    return 'sin fecha';
  }

  return new Date(marcaTiempo).toLocaleString('es', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function renderizarColaOutbox() {
  return obtenerTodosLosRegistros().then((registros) => {
    const lista = document.getElementById('lista-outbox');
    document.getElementById('total-registros').textContent = String(registros.length);
    lista.textContent = '';

    if (registros.length === 0) {
      const vacio = document.createElement('li');
      vacio.className = 'vacio';
      vacio.textContent = 'No hay incidencias registradas.';
      lista.appendChild(vacio);
      return;
    }

    registros.slice().sort((a, b) => b.fechaCreacion - a.fechaCreacion).forEach((registro) => {
      const item = document.createElement('li');
      item.className = 'item-' + registro.estado;

      const titulo = document.createElement('span');
      titulo.className = 'titulo';
      titulo.textContent = registro.titulo;

      const detalle = document.createElement('span');
      detalle.className = 'detalle';
      detalle.textContent = registro.descripcion;

      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = registro.estado + ' · ' + formatearFecha(registro.fechaCreacion);

      item.appendChild(titulo);
      item.appendChild(detalle);
      item.appendChild(meta);
      lista.appendChild(item);
    });
  });
}

function registrarEtiquetaSync() {
  if (!('SyncManager' in window) || !('serviceWorker' in navigator)) {
    return Promise.resolve(false);
  }

  return navigator.serviceWorker.ready.then((registro) => {
    if (!registro.sync) {
      return false;
    }

    return registro.sync.register(ETIQUETA_SYNC).then(() => true);
  });
}

function enviarAlServidor(datosFormulario) {
  return fetch(ENDPOINT_REPORTES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datosFormulario)
  }).then((respuesta) => {
    if (!respuesta.ok) {
      throw new Error('Error HTTP ' + respuesta.status);
    }

    return respuesta.json();
  });
}

function procesarEnvioReporte(datosFormulario) {
  const registro = {
    titulo: datosFormulario.titulo,
    descripcion: datosFormulario.descripcion,
    fechaCreacion: Date.now()
  };

  return enviarAlServidor(datosFormulario)
    .then(
      () => guardarRegistro(Object.assign({}, registro, {
        estado: 'sincronizado',
        fechaSincronizacion: Date.now()
      })),
      () => guardarRegistro(Object.assign({}, registro, { estado: 'pendiente' }))
        .then(registrarEtiquetaSync)
        .catch((error) => console.warn('[Outbox] No se pudo registrar la etiqueta sync:', error))
    )
    .then(() => renderizarColaOutbox());
}

function sincronizarPendientesFallback() {
  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        return [];
      }

      mostrarEstado('Reenviando ' + pendientes.length + ' reporte(s) pendiente(s)...');

      return Promise.all(pendientes.map((item) => {
        return enviarAlServidor({ title: item.titulo, body: item.descripcion })
          .then(() => actualizarEstadoRegistro(item.id, 'sincronizado'));
      }));
    })
    .then(() => renderizarColaOutbox())
    .then(() => mostrarEstado('Sincronización completada.'))
    .catch((error) => {
      console.error('[Outbox] Error durante la sincronización:', error);
      mostrarEstado('No se pudo completar la sincronización.', true);
      return renderizarColaOutbox();
    });
}

document.getElementById('form-incidencia').addEventListener('submit', (event) => {
  event.preventDefault();

  const titulo = document.getElementById('titulo').value.trim();
  const descripcion = document.getElementById('descripcion').value.trim();

  if (!titulo || !descripcion) {
    return;
  }

  mostrarEstado('Procesando reporte...');

  procesarEnvioReporte({ titulo, descripcion })
    .then(() => {
      event.target.reset();
      mostrarEstado('Reporte registrado correctamente.');
    })
    .catch((error) => {
      console.error('[Outbox] Error al guardar el reporte:', error);
      mostrarEstado('No se pudo guardar el reporte.', true);
    });
});

document.getElementById('btn-purgar').addEventListener('click', () => {
  obtenerTodosLosRegistros()
    .then((registros) => {
      const enviados = registros.filter((item) => item.estado === 'sincronizado');

      if (enviados.length === 0) {
        mostrarEstado('No hay registros sincronizados para purgar.');
        return [];
      }

      return Promise.all(enviados.map((item) => eliminarRegistro(item.id)));
    })
    .then(() => renderizarColaOutbox())
    .then(() => mostrarEstado('Registros sincronizados eliminados.'))
    .catch((error) => {
      console.error('[Outbox] Error al purgar la bandeja:', error);
      mostrarEstado('No se pudo purgar la bandeja.', true);
    });
});

window.addEventListener('online', () => {
  actualizarIndicadorRed();

  if (!('SyncManager' in window) || !('serviceWorker' in navigator)) {
    console.log('[Outbox] Navegador sin SyncManager. Usando fallback por evento online.');
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', actualizarIndicadorRed);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then((registro) => console.log('[App] Service Worker activo en:', registro.scope))
    .catch((error) => console.error('[App] Error al registrar el Service Worker:', error));

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      mostrarEstado('Sincronización en segundo plano completada.');
      renderizarColaOutbox();
    }
  });
}

actualizarIndicadorRed();
renderizarColaOutbox().catch((error) => {
  console.error('[App] Error al cargar la bandeja:', error);
});
