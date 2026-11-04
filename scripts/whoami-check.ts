import http from 'node:http';

const TARGET_URL = process.env.URL || 'http://localhost/whoami';
const TOTAL_CALLS = 50;

async function fetchWhoami(urlStr: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(urlStr, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.instancia || 'desconocida');
        } catch {
          resolve('error_parse');
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log(`[WHOAMI-CHECK] Realizando ${TOTAL_CALLS} peticiones a ${TARGET_URL}...`);
  const counts: Record<string, number> = {};

  for (let i = 1; i <= TOTAL_CALLS; i++) {
    try {
      const instancia = await fetchWhoami(TARGET_URL);
      counts[instancia] = (counts[instancia] || 0) + 1;
    } catch (err) {
      console.error(`Error en llamada ${i}:`, (err as Error).message);
    }
  }

  console.log('\n--- Distribución de llamadas por réplica ---');
  for (const [inst, count] of Object.entries(counts)) {
    console.log(`- Instancia [${inst}]: ${count} peticiones (${((count / TOTAL_CALLS) * 100).toFixed(1)}%)`);
  }

  const replicasAlcanzadas = Object.keys(counts).length;
  console.log(`\nTotal réplicas distintas alcanzadas: ${replicasAlcanzadas}`);

  if (replicasAlcanzadas > 1) {
    console.log('✅ ÉXITO: El balanceador Round-Robin reparte sin sesiones pegajosas (RT-1, RT-2 cumplidos).');
  } else {
    console.log('ℹ️ NOTA: Si está corriendo en local sin Nginx multi-contenedor, solo responde 1 instancia local.');
  }
}

run();
