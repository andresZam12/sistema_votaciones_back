-- rateLimit.lua: Límite de tasa atómico mediante ventana fija
-- KEYS[1]: rl:{credencial}:{ventana}
-- ARGV[1]: ttl_seconds (ej. 60)
-- ARGV[2]: max_allowed (ej. 120)

local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local maxAllowed = tonumber(ARGV[2])

local current = redis.call("INCR", key)
if current == 1 then
  redis.call("EXPIRE", key, ttl)
end

local allowed = (current <= maxAllowed) and 1 or 0
return {allowed, current}

