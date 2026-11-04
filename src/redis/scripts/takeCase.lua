-- takeCase.lua: Toma el caso de mayor prioridad de verif:queue y adquiere lock exclusivo
-- ARGV[1]: auditorId
-- ARGV[2]: token
-- ARGV[3]: lock_ttl_ms (ej: 30000)

local auditorId = ARGV[1]
local token = ARGV[2]
local lockTtlMs = tonumber(ARGV[3])
local owner = auditorId .. ":" .. token

-- 1. Sacar caso de mayor prioridad (ZPOPMAX toma mayor cantidad de sufragantes)
local popResult = redis.call("ZPOPMAX", "verif:queue", 1)
if #popResult == 0 then
  return {"EMPTY"}
end

local actaId = popResult[1]
local score = popResult[2]

local lockKey = "lock:acta:" .. actaId

-- 2. Adquirir lock exclusivo NX PX
local acquired = redis.call("SET", lockKey, owner, "PX", lockTtlMs, "NX")
if not acquired then
  -- Conflicto: devolver a la cola
  redis.call("ZADD", "verif:queue", score, actaId)
  return {"LOCKED_BY_OTHER", actaId}
end

-- 3. Marcar en verif:inflight
redis.call("SADD", "verif:inflight", actaId)

-- 4. Obtener datos del caso
local caseData = redis.call("HGETALL", "verif:case:" .. actaId)

-- 5. Registrar evento de auditoría en stream ev:audit
redis.call("XADD", "ev:audit", "MAXLEN", "~", 10000, "*",
  "acta", actaId,
  "auditor", auditorId,
  "evento", "tomado",
  "detalle", cjson.encode({ token = token, score = score })
)

return {"OK", actaId, token, cjson.encode(caseData)}
