-- renewLock.lua: Renueva el TTL del lock solo si el dueño coincide
-- ARGV[1]: actaId
-- ARGV[2]: owner (auditorId:token)
-- ARGV[3]: lock_ttl_ms (ej: 30000)

local actaId = ARGV[1]
local owner = ARGV[2]
local lockTtlMs = tonumber(ARGV[3])
local lockKey = "lock:acta:" .. actaId

local currentOwner = redis.call("GET", lockKey)
if currentOwner == owner then
  redis.call("PEXPIRE", lockKey, lockTtlMs)
  return 1
else
  return 0
end

