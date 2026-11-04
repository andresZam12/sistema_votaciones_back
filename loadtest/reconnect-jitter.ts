import fs from 'node:fs';
import path from 'node:path';

const TOTAL_CLIENTES = 5000;
const BASE_MS = 1000;
const CAP_MS = 30000;
const INTENTO = 2; // Segundo intento de reconexión

console.log(`[SIMULADOR RECONEXIÓN] Generando comparativa para ${TOTAL_CLIENTES} clientes (Con Jitter vs Sin Jitter)...`);

const segConJitter: Record<number, number> = {};
const segSinJitter: Record<number, number> = {};

for (let s = 0; s <= 10; s++) {
  segConJitter[s] = 0;
  segSinJitter[s] = 0;
}

const maxDelay = Math.min(CAP_MS, BASE_MS * Math.pow(2, INTENTO)); // 4000 ms

for (let i = 0; i < TOTAL_CLIENTES; i++) {
  // 1. Con Full Jitter
  const delayCon = Math.floor(Math.random() * maxDelay);
  const sCon = Math.min(10, Math.floor(delayCon / 1000));
  segConJitter[sCon] = (segConJitter[sCon] || 0) + 1;

  // 2. Sin Jitter (con pequeño jitter de red de +-100ms)
  const delaySin = maxDelay + Math.floor((Math.random() - 0.5) * 200);
  const sSin = Math.min(10, Math.max(0, Math.floor(delaySin / 1000)));
  segSinJitter[sSin] = (segSinJitter[sSin] || 0) + 1;
}

const csvPath = path.join(process.cwd(), 'loadtest', 'reconexiones_comparativa.csv');
let csvContent = 'segundo,con_jitter_req_sec,sin_jitter_req_sec\n';
for (let s = 0; s <= 10; s++) {
  csvContent += `${s},${segConJitter[s]},${segSinJitter[s]}\n`;
}

fs.writeFileSync(csvPath, csvContent, 'utf-8');
console.log(`[SIMULADOR RECONEXIÓN] CSV comparativo exportado en: ${csvPath}`);
