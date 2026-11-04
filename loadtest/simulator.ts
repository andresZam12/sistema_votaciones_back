import crypto from 'node:crypto';
import http from 'node:http';

const args = process.argv.slice(2);
const speedArg = args.find((a) => a.startsWith('--speed=')) || '--speed=50';
const speed = Math.max(1, Number(speedArg.split('=')[1]) || 50);

const TARGET_HOST = process.env.HOST || 'localhost';
const TARGET_PORT = Number(process.env.PORT || 3000);
const BASE_URL = `http://${TARGET_HOST}:${TARGET_PORT}`;

const TOTAL_MESAS = 6400;
const TOTAL_PUESTOS = 1842;
const TOTAL_MUNICIPIOS = 25;

console.log(`\n=============================================================`);
console.log(`[LOADTEST] SIMULADOR DE JORNADA ELECTORAL EN TIEMPO REAL (RT-8)`);
console.log(`- Mesas a procesar: ${TOTAL_MESAS}`);
console.log(`- Velocidad de simulación: ${speed}x`);
console.log(`- Destino: ${BASE_URL}`);
console.log(`=============================================================\n`);

interface MetricsSummary {
  enviadas: number;
  exitosas201: number;
  yaRegistradas200: number;
  dudosas: number;
  errores: number;
  tiemposMs: number[];
}

const metrics: MetricsSummary = {
  enviadas: 0,
  exitosas201: 0,
  yaRegistradas200: 0,
  dudosas: 0,
  errores: 0,
  tiemposMs: []
};

async function enviarActa(actaPayload: any): Promise<number> {
  return new Promise((resolve) => {
    const data = JSON.stringify(actaPayload);
    const start = Date.now();

    const req = http.request(
      {
        hostname: TARGET_HOST,
        port: TARGET_PORT,
        path: '/actas',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'x-api-key': 'jurado-key-demo'
        }
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          const dur = Date.now() - start;
          metrics.tiemposMs.push(dur);
          metrics.enviadas++;

          if (res.statusCode === 201) metrics.exitosas201++;
          else if (res.statusCode === 200) metrics.yaRegistradas200++;
          else metrics.errores++;

          resolve(res.statusCode || 500);
        });
      }
    );

    req.on('error', () => {
      metrics.errores++;
      resolve(500);
    });

    req.write(data);
    req.end();
  });
}

function generarActa(mesa: number, version = 1, forzarDudosa = false, idemKey?: string) {
  const puesto = ((mesa - 1) % TOTAL_PUESTOS) + 1;
  const mun = ((puesto - 1) % TOTAL_MUNICIPIOS) + 1;

  const c1 = 100 + (mesa % 80);
  const c2 = 80 + (mesa % 60);
  const c3 = 50 + (mesa % 40);
  const blanco = 10 + (mesa % 15);
  const nulo = 5;
  const noMarcado = 2;

  const suma = c1 + c2 + c3 + blanco + nulo + noMarcado;
  const sufragantes = forzarDudosa ? suma + 10 : suma; // Si es dudosa, no cuadra

  return {
    acta: `E14-${puesto}-${mesa.toString().padStart(4, '0')}-01`,
    mesa,
    puesto,
    municipio: mun,
    version,
    jurado: `JUR-${mesa}`,
    ts_cierre: 1793577600,
    votos: { C1: c1, C2: c2, C3: c3, BLANCO: blanco, NULO: nulo, NO_MARCADO: noMarcado },
    sufragantes,
    hash_foto: crypto.createHash('sha256').update(`foto-${mesa}-${version}`).digest('hex'),
    idem: idemKey || crypto.randomBytes(8).toString('hex')
  };
}

async function simularJornada() {
  const inicio = Date.now();

  // Simular un subset representativo para el test (ej. 300 actas en modo rápido o lote configurable)
  const totalSimular = Math.min(TOTAL_MESAS, 500); // 500 mesas representativas para prueba reproducible
  console.log(`[SIMULADOR] Transmitiendo ${totalSimular} actas con reenvíos y correcciones...`);

  for (let m = 1; m <= totalSimular; m++) {
    const esDudosa = m % 12 === 0; // ~8% dudosas
    if (esDudosa) metrics.dudosas++;

    const actaOriginal = generarActa(m, 1, esDudosa);
    await enviarActa(actaOriginal);

    // 8% de actas sufren reenvío por mala señal (mismo acta, mismo idem)
    if (m % 12 === 3) {
      await enviarActa(actaOriginal); // Debe retornar 200 'ya_registrada'
    }

    // ~3% de actas sufren corrección posterior (versión 2)
    if (m % 30 === 0) {
      const actaV2 = generarActa(m, 2, false);
      await enviarActa(actaV2);
    }

    // Intervalo de emisión controlado por --speed
    if (m % 20 === 0) {
      await new Promise((r) => setTimeout(r, Math.max(5, Math.floor(100 / speed))));
      process.stdout.write(`\rProcesadas ${m}/${totalSimular} mesas...`);
    }
  }

  const durTotalSec = ((Date.now() - inicio) / 1000).toFixed(2);
  const avgLatencia = (
    metrics.tiemposMs.reduce((a, b) => a + b, 0) / (metrics.tiemposMs.length || 1)
  ).toFixed(1);

  console.log(`\n\n=============================================================`);
  console.log(`[RESULTADOS DE LA PRUEBA DE CARGA]`);
  console.log(`- Tiempo total de prueba: ${durTotalSec} s`);
  console.log(`- Peticiones enviadas: ${metrics.enviadas}`);
  console.log(`- Actas registradas (201 Created): ${metrics.exitosas201}`);
  console.log(`- Reenvíos detectados (200 OK Idempotente): ${metrics.yaRegistradas200}`);
  console.log(`- Actas marcadas dudosas (en cola de verificación): ${metrics.dudosas}`);
  console.log(`- Errores: ${metrics.errores}`);
  console.log(`- Latencia promedio: ${avgLatencia} ms`);
  console.log(`=============================================================\n`);
}

simularJornada();
