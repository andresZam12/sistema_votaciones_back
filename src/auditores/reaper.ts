import { redis } from '../redis/client.js';

export class LockReaper {
  private timer: NodeJS.Timeout | null = null;
  public totalReapedCases = 0;

  start(): void {
    if (this.timer) return;

    this.timer = setInterval(async () => {
      try {
        const reaped = await redis.reapExpired();
        if (reaped && reaped.length > 0) {
          this.totalReapedCases += reaped.length;
          console.log(`[REAPER] Devueltos ${reaped.length} casos expirados a verif:queue:`, reaped);
        }
      } catch (err) {
        // En caso de que Redis no esté accesible temporalmente
      }
    }, 5000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const lockReaper = new LockReaper();
