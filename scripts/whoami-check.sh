#!/bin/bash
# Verifica que 50 peticiones a /whoami caen en instancias distintas demostrando Round-Robin (RT-1, RT-2)

TARGET_URL=${1:-"http://localhost/whoami"}
TOTAL_PETICIONES=50

echo "Ejecutando $TOTAL_PETICIONES llamadas a $TARGET_URL..."

INSTANCIAS=()
for i in $(seq 1 $TOTAL_PETICIONES); do
  RESP=$(curl -s $TARGET_URL)
  INSTANCIA=$(echo $RESP | grep -o '"instancia":"[^"]*' | cut -d'"' -f4)
  if [ -n "$INSTANCIA" ]; then
    INSTANCIAS+=($INSTANCIA)
  fi
done

echo ""
echo "Conteo de peticiones por instancia:"
printf '%s\n' "${INSTANCIAS[@]}" | sort | uniq -c

DISTINTAS=$(printf '%s\n' "${INSTANCIAS[@]}" | sort -u | wc -l)
echo ""
echo "Total de réplicas distintas alcanzadas: $DISTINTAS de 8"

if [ "$DISTINTAS" -gt 1 ]; then
  echo "EXITO: El balanceo Round-Robin esta funcionando sin sesiones pegajosas."
  exit 0
else
  echo "FALLO: Todas las peticiones cayeron en la misma instancia."
  exit 1
fi
