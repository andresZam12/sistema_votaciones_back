import http from 'node:http';

const TARGET_HOST = process.env.HOST || 'localhost';
const TARGET_PORT = Number(process.env.PORT || 3000);

console.log(`[SLOW-CLIENT] Iniciando cliente deliberadamente lento contra http://${TARGET_HOST}:${TARGET_PORT}/stream?topic=dep`);

const req = http.request(
  {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: '/stream?topic=dep',
    method: 'GET',
    headers: {
      Accept: 'text/event-stream'
    }
  },
  (res) => {
    console.log(`[SLOW-CLIENT] Conectado con estado ${res.statusCode}.`);

    let bytesReceived = 0;

    res.on('data', (chunk) => {
      bytesReceived += chunk.length;
      console.log(`[SLOW-CLIENT] Recibidos ${chunk.length} bytes (Total: ${bytesReceived}). Simulando bloqueo TCP...`);

      // RF-9: Pausar intencionalmente el socket para saturar el buffer de salida del servidor
      res.pause();

      setTimeout(() => {
        console.log('[SLOW-CLIENT] Reanudando lectura brevemente...');
        res.resume();
      }, 5000);
    });

    res.on('end', () => {
      console.log('[SLOW-CLIENT] Conexión finalizada por el servidor (política de contrapresión aplicada).');
      process.exit(0);
    });

    res.on('error', (err) => {
      console.log('[SLOW-CLIENT] Error en conexión:', err.message);
    });
  }
);

req.on('error', (err) => {
  console.error('[SLOW-CLIENT] Error al conectar:', err.message);
  process.exit(1);
});

req.end();

