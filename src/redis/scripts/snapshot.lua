-- snapshot.lua: Obtiene el estado consolidado de un tópico y el cursor del stream de forma atómica
-- ARGV[1]: tipo_topico ('dep', 'mun', 'puesto')
-- ARGV[2]: id_entidad (ej: '11', '176', o vacío si es 'dep')

local tipo = ARGV[1]
local entidadId = ARGV[2]

local keyTot = "tot:dep"
local keyRank = "rank:dep"
local keyMeta = "meta:mesas:dep"

if tipo == "mun" then
  keyTot = "tot:mun:" .. entidadId
  keyRank = "rank:mun:" .. entidadId
  keyMeta = "meta:mesas:mun:" .. entidadId
elseif tipo == "puesto" then
  keyTot = "tot:puesto:" .. entidadId
  keyRank = "rank:dep" -- puestos no tienen ranking ZSET individual, heredan el de candidatos
  keyMeta = "meta:mesas:puesto:" .. entidadId
end

-- 1. Totales de votos por candidato
local totRaw = redis.call("HGETALL", keyTot)
local totales = {}
local mesasInformadas = 0

for i = 1, #totRaw, 2 do
  local k = totRaw[i]
  local v = tonumber(totRaw[i + 1])
  if k == "__mesas" then
    mesasInformadas = v
  else
    totales[k] = v
  end
end

-- 2. Total de mesas esperadas
local totalMesasStr = redis.call("GET", keyMeta)
local totalMesas = totalMesasStr and tonumber(totalMesasStr) or 0

-- 3. Ranking de candidatos
local rankingRaw = redis.call("ZREVRANGE", keyRank, 0, -1, "WITHSCORES")
local ranking = {}
for i = 1, #rankingRaw, 2 do
  table.insert(ranking, {
    candidato = rankingRaw[i],
    votos = tonumber(rankingRaw[i + 1])
  })
end

-- 4. Último ID del stream ev:actas para sincronía estricta de cursor
local streamRev = redis.call("XREVRANGE", "ev:actas", "+", "-", "COUNT", 1)
local lastStreamId = "0-0"
if #streamRev > 0 then
  lastStreamId = streamRev[1][1]
end

local snapshot = {
  topico = (tipo == "dep") and "dep" or (tipo .. ":" .. entidadId),
  streamId = lastStreamId,
  mesasInformadas = mesasInformadas,
  totalMesas = totalMesas,
  porcentajeMesas = (totalMesas > 0) and ((mesasInformadas / totalMesas) * 100) or 0,
  totales = totales,
  ranking = ranking
}

return cjson.encode(snapshot)
