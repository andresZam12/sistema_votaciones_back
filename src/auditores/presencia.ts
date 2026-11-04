import { redis } from '../redis/client.js';
import { config } from '../config.js';

export interface AuditorPresence {
  auditorId: string;
  instancia: string;
  casoId: string | null;
  desde: number;
  ultimoLatido: number;
  actividad: boolean;
}

export class PresenceManager {
  private localAuditorTimestamps: Map<string, number> = new Map();

  async updatePresence(auditorId: string, casoId: string | null, actividad: boolean): Promise<void> {
    const key = `presence:${auditorId}`;
    const ahora = Date.now();
    const desde = this.localAuditorTimestamps.get(auditorId) || ahora;
    this.localAuditorTimestamps.set(auditorId, desde);

    const data: AuditorPresence = {
      auditorId,
      instancia: config.instanceId,
      casoId,
      desde,
      ultimoLatido: ahora,
      actividad
    };

    // TTL de 15 segundos: si el auditor pierde conexión, expira automáticamente (RF-8)
    await redis.set(key, JSON.stringify(data), 'EX', 15);
  }

  async removePresence(auditorId: string): Promise<void> {
    this.localAuditorTimestamps.delete(auditorId);
    await redis.del(`presence:${auditorId}`);
  }

  async getActiveAuditors(): Promise<AuditorPresence[]> {
    try {
      const keys = await redis.keys('presence:*');
      if (keys.length === 0) return [];

      const values = await redis.mget(keys);
      const list: AuditorPresence[] = [];

      for (const val of values) {
        if (val) {
          try {
            list.push(JSON.parse(val));
          } catch {}
        }
      }
      return list;
    } catch {
      return [];
    }
  }
}

export const presenceManager = new PresenceManager();
