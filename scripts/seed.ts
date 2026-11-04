import { redis } from '../src/redis/client.js';
import pg from 'pg';
import { config } from '../src/config.js';

const TOTAL_MESAS = 6400;
const TOTAL_PUESTOS = 1842;
const TOTAL_MUNICIPIOS = 25;

export interface MesaTopology {
  mesa: number;
  puesto: number;
  municipio: number;
}

export function generateTopology(): MesaTopology[] {
  const topology: MesaTopology[] = [];

  for (let m = 1; m <= TOTAL_MESAS; m++) {
    const puesto = ((m - 1) % TOTAL_PUESTOS) + 1;
    const municipio = ((puesto - 1) % TOTAL_MUNICIPIOS) + 1;
    topology.push({ mesa: m, puesto, municipio });
  }

  return topology;
}

export async function seed() {
  console.log(`[SEED] Generando topología de ${TOTAL_MESAS} mesas en ${TOTAL_PUESTOS} puestos y ${TOTAL_MUNICIPIOS} municipios...`);
  const topology = generateTopology();

  // 1. Cargar en Redis
  try {
    const pipeline = redis.pipeline();
    pipeline.set('meta:mesas:dep', TOTAL_MESAS);

    const munCount: Record<number, number> = {};
    const puestoCount: Record<number, number> = {};

    for (const item of topology) {
      munCount[item.municipio] = (munCount[item.municipio] || 0) + 1;
      puestoCount[item.puesto] = (puestoCount[item.puesto] || 0) + 1;
    }

    for (const [mun, count] of Object.entries(munCount)) {
      pipeline.set(`meta:mesas:mun:${mun}`, count);
    }

    for (const [puesto, count] of Object.entries(puestoCount)) {
      pipeline.set(`meta:mesas:puesto:${puesto}`, count);
    }

    await pipeline.exec();
    console.log('[SEED] Topología cargada exitosamente en Redis.');
  } catch (err) {
    console.warn('[SEED] No se pudo cargar en Redis (posiblemente offline):', (err as Error).message);
  }

  // 2. Cargar en PostgreSQL si está disponible
  const client = new pg.Client({ connectionString: config.databaseUrl });
  try {
    await client.connect();
    console.log('[SEED] Conectado a Postgres, insertando mesas...');

    await client.query('BEGIN');
    for (const item of topology) {
      await client.query(
        'INSERT INTO mesas (mesa, puesto, municipio) VALUES ($1, $2, $3) ON CONFLICT (mesa) DO NOTHING',
        [item.mesa, item.puesto, item.municipio]
      );
    }
    await client.query('COMMIT');
    console.log('[SEED] Topología cargada exitosamente en PostgreSQL.');
  } catch (err) {
    console.warn('[SEED] Postgres no disponible o no accesible:', (err as Error).message);
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seed().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

