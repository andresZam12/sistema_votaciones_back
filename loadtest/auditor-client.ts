import WebSocket from 'ws';

const TARGET_HOST = process.env.HOST || 'localhost';
const TARGET_PORT = Number(process.env.PORT || 3000);
const AUDITOR_ID = process.env.ID || 'AUD-TEST-99';
const WS_URL = `ws://${TARGET_HOST}:${TARGET_PORT}/auditores?key=auditor-key-demo&id=${AUDITOR_ID}`;

console.log(`[AUDITOR-CLIENT] Conectando a ${WS_URL}...`);

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log(`[AUDITOR-CLIENT] Conectado exitosamente como ${AUDITOR_ID}.`);

  // 1. Solicitar tomar caso
  console.log('[AUDITOR-CLIENT] Enviando solicitud: tomar caso...');
  ws.send(JSON.stringify({ accion: 'tomar' }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('[AUDITOR-CLIENT] Mensaje recibido del servidor:', msg);

  if (msg.evento === 'caso_asignado') {
    console.log(`[AUDITOR-CLIENT] Caso asignado: ${msg.acta} con token ${msg.token}.`);

    // Iniciar latido con actividad real
    setInterval(() => {
      console.log('[AUDITOR-CLIENT] Enviando latido con actividad: true...');
      ws.send(JSON.stringify({ accion: 'latido', actividad: true }));
    }, 5000);

    // Simular resolución tras 15 segundos
    setTimeout(() => {
      console.log(`[AUDITOR-CLIENT] Finalizando caso ${msg.acta}: cerrar_caso...`);
      ws.send(JSON.stringify({ accion: 'cerrar_caso', acta: msg.acta, token: msg.token, resolucion: 'aprobada' }));

      setTimeout(() => {
        console.log('[AUDITOR-CLIENT] Cerrando sesión...');
        ws.close();
        process.exit(0);
      }, 2000);
    }, 15000);
  } else if (msg.evento === 'cola_vacia') {
    console.log('[AUDITOR-CLIENT] No hay actas dudosas pendientes en la cola actualmente.');
    setTimeout(() => {
      ws.close();
      process.exit(0);
    }, 2000);
  }
});

ws.on('error', (err) => {
  console.error('[AUDITOR-CLIENT] Error en WebSocket:', err.message);
  process.exit(1);
});

