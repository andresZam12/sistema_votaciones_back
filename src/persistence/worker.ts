import { Redis } from 'ioredis';
import { config } from '../config.js';
import { pgPool } from './postgres.js';

export class PersistenceWorker {
  private redisClient: Redis | null = null;
  private isRunning = false;
  private consumerName = `worker-${config.instanceId}`;
  private groupName = 'persistidor';

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    this.redisClient = new Redis(config.redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      lazyConnect: true
    });

    try {
      await this.redisClient.connect();
      await this.ensureConsumerGroups();
      console.log(`[PERSISTIDOR] Conectado a Redis Consumer Group '${this.groupName}'`);
      this.loop();
    } catch (err) {
      console.warn(`[PERSISTIDOR] No se pudo inicializar worker de persistencia:`, (err as Error).message);
      setTimeout(() => {
        if (this.isRunning) this.start();
      }, 5000);
    }
  }

  private async ensureConsumerGroups(): Promise<void> {
    if (!this.redisClient) return;

    for (const stream of ['ev:actas', 'ev:audit']) {
      try {
        await this.redisClient.xgroup('CREATE', stream, this.groupName, '0', 'MKSTREAM');
      } catch (err: any) {
        if (!err.message?.includes('BUSYGROUP')) {
          console.warn(`[PERSISTIDOR] Advertencia al crear consumer group para ${stream}:`, err.message);
        }
      }
    }
  }

  private async loop(): Promise<void> {
    while (this.isRunning && this.redisClient) {
      try {
        // XREADGROUP GROUP persistidor <consumer> BLOCK 2000 STREAMS ev:actas ev:audit > >
        const results = await this.redisClient.xreadgroup(
          'GROUP',
          this.groupName,
          this.consumerName,
          'BLOCK',
          2000,
          'STREAMS',
          'ev:actas',
          'ev:audit',
          '>',
          '>'
        );

        if (results && Array.isArray(results) && results.length > 0) {
          for (const item of results as [string, [string, string[]][]][]) {
            const [streamKey, messages] = item;
            for (const [id, fields] of messages) {
              await this.handleMessage(streamKey, id, fields);
            }
          }
        }
      } catch (err) {
        if (!this.isRunning) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  private async handleMessage(stream: string, id: string, fields: string[]): Promise<void> {
    const data: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      data[fields[i]] = fields[i + 1];
    }

    try {
      if (stream === 'ev:actas') {
        const query = `
          INSERT INTO actas_versiones (
            acta, version, mesa, puesto, municipio, votos, sufragantes, dudosa,
            jurado, hash_foto, ts_cierre, instancia
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, to_timestamp($11), $12)
          ON CONFLICT (acta, version) DO NOTHING
        `;

        const values = [
          data.acta,
          Number(data.version || 1),
          Number(data.mesa),
          Number(data.puesto),
          Number(data.mun),
          data.votos ? JSON.parse(data.votos) : {},
          Number(data.sufragantes || 0),
          data.dudosa === '1',
          data.jurado || '',
          data.hash_foto || '',
          Number(data.ts_cierre || Math.floor(Date.now() / 1000)),
          data.instancia || config.instanceId
        ];

        await pgPool.query(query, values);
      } else if (stream === 'ev:audit') {
        const query = `
          INSERT INTO auditoria_verificacion (acta, auditor, evento, detalle)
          VALUES ($1, $2, $3, $4)
        `;

        const values = [
          data.acta,
          data.auditor,
          data.evento,
          data.detalle ? JSON.parse(data.detalle) : {}
        ];

        await pgPool.query(query, values);
      }

      // XACK solo después de confirmar inserción en PostgreSQL
      if (this.redisClient) {
        await this.redisClient.xack(stream, this.groupName, id);
      }
    } catch (err) {
      console.error(`[PERSISTIDOR] Error persistiendo evento ${id} de ${stream} en Postgres:`, (err as Error).message);
      // El mensaje queda en el PEL de Redis para ser reintentado automáticamente
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.redisClient) {
      await this.redisClient.quit().catch(() => {});
      this.redisClient = null;
    }
  }
}

export const persistenceWorker = new PersistenceWorker();
