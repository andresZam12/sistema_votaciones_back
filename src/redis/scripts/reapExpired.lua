-- reapExpired.lua: Devuelve a la cola los casos en vuelo cuyos locks han expirado
-- Sin keyspace notifications, seguro e idempotente across multiple instances

local inflight = redis.call("SMEMBERS", "verif:inflight")
local reaped = {}

for _, actaId in ipairs(inflight) do
  local lockKey = "lock:acta:" .. actaId
  local exists = redis.call("EXISTS", lockKey)

  if exists == 0 then
    -- El lock expiró: retirar de inflight y reinsertar en la cola de verificación
    redis.call("SREM", "verif:inflight", actaId)

    local sufragantesStr = redis.call("HGET", "verif:case:" .. actaId, "sufragantes")
    local score = sufragantesStr and tonumber(sufragantesStr) or 1
    redis.call("ZADD", "verif:queue", score, actaId)

    table.insert(reaped, actaId)

    -- Registrar evento en ev:audit
    redis.call("XADD", "ev:audit", "MAXLEN", "~", 10000, "*",
      "acta", actaId,
      "auditor", "sistema:reaper",
      "evento", "expirado",
      "detalle", cjson.encode({ score = score })
    )
  end
end

return reaped

