import pg from 'pg';
import { redis } from '../src/redis/client.js';
import { config } from '../src/config.js';
import { registerLuaScripts } from '../src/redis/scripts.js';
import { seed } from './seed.js';

export async function rebuildRedisFromPostgres(): Promise<{ actasProcesadas: number }> {
  console.log('[REBUILD] Iniciando proceso de recuperación ante desastre desde PostgreSQL...');
  registerLuaScripts();

  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();

  try {
    // 1. Obtener todas las versiones de actas registradas en PostgreSQL en orden cronológico
    const result = await client.query(`
      SELECT acta, version, mesa, puesto, municipio, votos, sufragantes, dudosa, jurado, hash_foto,
             extract(epoch from ts_cierre)::bigint as ts_cierre_epoch
      FROM actas_versiones
      ORDER BY recibida_en ASC, version ASC
    `);

    console.log(`[REBUILD] ${result.rows.length} versiones de actas encontradas en PostgreSQL.`);

    // 2. Limpiar acumulados y estado en caliente en Redis
    const keys = await redis.keys('tot:*');
    const rankKeys = await redis.keys('rank:*');
    const actaKeys = await redis.keys('acta:*');
    const allToClean = [...keys, ...rankKeys, ...actaKeys];

    if (allToClean.length > 0) {
      await redis.del(allToClean);
      console.log(`[REBUILD] Eliminadas ${allToClean.length} claves de acumulados previas en Redis.`);
    }

    // 3. Restaurar metadatos de topología
    await seed();

    // 4. Reaplicar cada acta mediante applyActa.lua
    let count = 0;
    for (const row of result.rows) {
      const tsIngest = Date.now().toString();
      await redis.applyActa(
        row.acta,
        row.version,
        row.mesa,
        row.puesto,
        row.municipio,
        JSON.stringify(row.votos),
        row.sufragantes,
        row.dudosa ? 1 : 0,
        row.jurado,
        row.hash_foto,
        row.ts_cierre_epoch,
        tsIngest,
        'rebuild-script'
      );
      count++;
    }

    console.log(`[REBUILD] Reconstrucción finalizada con éxito. ${count} actas reaplicadas.`);
    return { actasProcesadas: count };
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith('rebuild-redis.ts') || process.argv[1]?.endsWith('rebuild-redis.js')) {
  rebuildRedisFromPostgres().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

