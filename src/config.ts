import os from 'node:os';
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  instanceId: os.hostname(),
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/votaciones',
  fanoutWindowMs: Number(process.env.FANOUT_WINDOW_MS || 2000),
  fanoutBatch: Number(process.env.FANOUT_BATCH || 500),
  maxBufferedBytes: Number(process.env.MAX_BUFFERED_BYTES || 262144), // 256 KB
  juradoKeys: (process.env.JURADO_KEYS || 'jurado-key-demo,JUR-88134').split(',').map((k) => k.trim()),
  auditorKeys: (process.env.AUDITOR_KEYS || 'auditor-key-demo,AUD-01').split(',').map((k) => k.trim())
};
