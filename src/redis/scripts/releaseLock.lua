-- releaseLock.lua: Liberación segura de lock (Compare-and-Delete)
-- ARGV[1]: actaId
-- ARGV[2]: owner (auditorId:token)
-- ARGV[3]: accion ('liberar' o 'cerrar')

local actaId = ARGV[1]
local owner = ARGV[2]
local accion = ARGV[3]
local lockKey = "lock:acta:" .. actaId

local currentOwner = redis.call("GET", lockKey)
if currentOwner ~= owner then
  -- El lock ya no le pertenece (expiró o fue tomado por otro auditor)
  return 0
end

-- El dueño coincide: liberar
redis.call("DEL", lockKey)
redis.call("SREM", "verif:inflight", actaId)

if accion == "liberar" then
  -- Reingresar a la cola de verificación con su prioridad original
  local sufragantesStr = redis.call("HGET", "verif:case:" .. actaId, "sufragantes")
  local score = sufragantesStr and tonumber(sufragantesStr) or 1
  redis.call("ZADD", "verif:queue", score, actaId)
end

-- Registrar evento en ev:audit
local auditorId = string.match(owner, "^([^:]+)")
redis.call("XADD", "ev:audit", "MAXLEN", "~", 10000, "*",
  "acta", actaId,
  "auditor", auditorId or "desconocido",
  "evento", accion == "cerrar" and "cerrado" or "liberado",
  "detalle", cjson.encode({ owner = owner, accion = accion })
)

return 1
