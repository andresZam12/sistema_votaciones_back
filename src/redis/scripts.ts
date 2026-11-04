import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redis } from './client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Rutas de scripts
const SCRIPTS_DIR = path.join(__dirname, 'scripts');

function loadScript(name: string): string {
  const filePath = path.join(SCRIPTS_DIR, name);
  return fs.readFileSync(filePath, 'utf-8');
}

// Cargar contenidos de Lua
export const applyActaLua = loadScript('applyActa.lua');
export const rateLimitLua = loadScript('rateLimit.lua');
export const snapshotLua = loadScript('snapshot.lua');

// Registrar comandos personalizados en ioredis para usar EVALSHA automáticamente
export function registerLuaScripts(): void {
  redis.defineCommand('applyActa', {
    numberOfKeys: 0,
    lua: applyActaLua
  });

  redis.defineCommand('rateLimit', {
    numberOfKeys: 1,
    lua: rateLimitLua
  });

  redis.defineCommand('getSnapshot', {
    numberOfKeys: 0,
    lua: snapshotLua
  });
}

// Interfaz TypeScript extendida para los comandos de Redis
declare module 'ioredis' {
  interface RedisCommander<Context> {
    applyActa(
      actaId: string,
      version: string | number,
      mesa: string | number,
      puesto: string | number,
      mun: string | number,
      votosJson: string,
      sufragantes: string | number,
      dudosa: string | number,
      jurado: string,
      hashFoto: string,
      tsCierre: string | number,
      tsIngest: string | number,
      instancia: string
    ): Promise<[string, string, string, string, string]>;

    rateLimit(
      key: string,
      ttl: string | number,
      maxAllowed: string | number
    ): Promise<[number, number]>;

    getSnapshot(
      tipo: string,
      entidadId: string
    ): Promise<string>;
  }
}
