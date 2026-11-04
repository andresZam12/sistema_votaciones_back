-- applyActa.lua: Ingestión atómica de actas con idempotencia por versión, acumulados jerárquicos y stream backplane
-- KEYS: ninguno requerido (todo corre en la misma instancia de Redis)
-- ARGV:
-- 1: actaId
-- 2: version
-- 3: mesa
-- 4: puesto
-- 5: mun
-- 6: votosJson
-- 7: sufragantes
-- 8: dudosa ("1" o "0")
-- 9: jurado
-- 10: hash_foto
-- 11: ts_cierre
-- 12: ts_ingest
-- 13: instancia

local actaId = ARGV[1]
local version = tonumber(ARGV[2])
local mesa = ARGV[3]
local puesto = ARGV[4]
local mun = ARGV[5]
local votosJson = ARGV[6]
local sufragantes = tonumber(ARGV[7])
local dudosa = tonumber(ARGV[8])
local jurado = ARGV[9]
local hashFoto = ARGV[10]
local tsCierre = ARGV[11]
local tsIngest = ARGV[12]
local instancia = ARGV[13]

local actaKey = "acta:" .. actaId

-- 1. Verificar versión previa
local versionGuardadaStr = redis.call("HGET", actaKey, "version")
if versionGuardadaStr then
  local versionGuardada = tonumber(versionGuardadaStr)
  if version <= versionGuardada then
    -- Rechazo idempotente: acta ya registrada o versión más reciente ya procesada
    return {"STALE", tostring(versionGuardada)}
  end
end

-- 2. Obtener votos anteriores para calcular deltas
local votosAnt = {}
if versionGuardadaStr then
  local votosAntJson = redis.call("HGET", actaKey, "votos")
  if votosAntJson then
    votosAnt = cjson.decode(votosAntJson)
  end
end

local votosNuevos = cjson.decode(votosJson)
local deltas = {}
local todosCandidatos = {}

for cand, val in pairs(votosNuevos) do
  todosCandidatos[cand] = true
end
for cand, val in pairs(votosAnt) do
  todosCandidatos[cand] = true
end

for cand, _ in pairs(todosCandidatos) do
  local valNuevo = tonumber(votosNuevos[cand] or 0)
  local valAnt = tonumber(votosAnt[cand] or 0)
  local diff = valNuevo - valAnt
  if diff ~= 0 then
    deltas[cand] = diff
  end
end

-- 3. Claves de acumulados jerárquicos
local keyMesa = "tot:mesa:" .. mesa
local keyPuesto = "tot:puesto:" .. puesto
local keyMun = "tot:mun:" .. mun
local keyDep = "tot:dep"

-- Si es la primera versión recibida para esta mesa, incrementamos el contador de mesas informadas
local esPrimeraVersion = (versionGuardadaStr == nil)
if esPrimeraVersion then
  redis.call("HINCRBY", keyMesa, "__mesas", 1)
  redis.call("HINCRBY", keyPuesto, "__mesas", 1)
  redis.call("HINCRBY", keyMun, "__mesas", 1)
  redis.call("HINCRBY", keyDep, "__mesas", 1)
end

-- 4. Aplicar deltas a los 4 niveles jerárquicos y a los rankings
for cand, diff in pairs(deltas) do
  redis.call("HINCRBY", keyMesa, cand, diff)
  redis.call("HINCRBY", keyPuesto, cand, diff)
  redis.call("HINCRBY", keyMun, cand, diff)
  redis.call("HINCRBY", keyDep, cand, diff)

  -- Rankings globales y municipales (excluyendo votos en blanco/nulos para ranking de candidatos)
  redis.call("ZINCRBY", "rank:dep", diff, cand)
  redis.call("ZINCRBY", "rank:mun:" .. mun, diff, cand)
end

-- 5. Guardar estado del acta
redis.call("HSET", actaKey,
  "version", version,
  "votos", votosJson,
  "mesa", mesa,
  "puesto", puesto,
  "municipio", mun,
  "dudosa", dudosa,
  "sufragantes", sufragantes,
  "jurado", jurado,
  "hash_foto", hashFoto,
  "ts_cierre", tsCierre
)

-- 6. Si es dudosa, enviar a cola de verificación ordenada por prioridad (sufragantes como score)
if dudosa == 1 then
  redis.call("ZADD", "verif:queue", sufragantes, actaId)
  redis.call("HSET", "verif:case:" .. actaId,
    "acta", actaId,
    "mesa", mesa,
    "puesto", puesto,
    "municipio", mun,
    "version", version,
    "sufragantes", sufragantes,
    "votos", votosJson,
    "jurado", jurado,
    "hash_foto", hashFoto,
    "ts_cierre", tsCierre,
    "ts_ingest", tsIngest
  )
end

-- 7. Publicar en stream global ev:actas
local kind = esPrimeraVersion and "nueva" or "correccion"
local deltasJson = cjson.encode(deltas)

local streamId = redis.call("XADD", "ev:actas", "MAXLEN", "~", 10000, "*",
  "acta", actaId,
  "mesa", mesa,
  "puesto", puesto,
  "mun", mun,
  "version", tostring(version),
  "kind", kind,
  "delta", deltasJson,
  "ts_ingest", tsIngest,
  "votos", votosJson,
  "sufragantes", tostring(sufragantes),
  "dudosa", tostring(dudosa),
  "jurado", jurado,
  "hash_foto", hashFoto,
  "ts_cierre", tsCierre,
  "instancia", instancia
)

return {"OK", streamId, tostring(version), kind, deltasJson}
