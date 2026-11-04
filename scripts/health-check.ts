import http from 'node:http';

const URL = process.env.URL || 'http://localhost/health';

console.log(`[HEALTH-CHECK] Consultando salud en ${URL}...`);

http.get(URL, (res) => {
  let body = '';
  res.on('data', (c) => (body += c));
  res.on('end', () => {
    console.log(`[HEALTH-CHECK] Código HTTP recibido: ${res.statusCode}`);
    console.log(`[HEALTH-CHECK] Respuesta: ${body}`);

    if (res.statusCode === 200) {
      console.log('✅ Servicio en estado SALUDABLE (OK).');
      process.exit(0);
    } else {
      console.warn(`⚠️ Servicio en estado DEGRADADO (${res.statusCode}). Retry-After: ${res.headers['retry-after'] || 'N/A'}`);
      process.exit(1);
    }
  });
}).on('error', (err) => {
  console.error('❌ Error conectando al servicio:', err.message);
  process.exit(1);
});

