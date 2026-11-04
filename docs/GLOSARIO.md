# Glosario Técnico y de Dominio Electoral

Este glosario define los conceptos clave del sistema tanto a nivel del proceso electoral como de la ingeniería de sistemas distribuidos en tiempo real.

---

## Dominio Electoral

- **Acta E-14:** Formulario oficial diligenciado por los jurados de votación al cierre de las urnas. Contiene el desglose de votos por candidato, votos en blanco, nulos y no marcados, junto con el total de sufragantes y firmas de los jurados.
- **Preconteo:** Proceso rápido de transmisión telefónica o digital de los datos del acta E-14 el mismo día de las elecciones. Es de carácter **exclusivamente informativo** para dar tranquilidad y transparencia pública veloz a la ciudadanía. No tiene validez jurídica vinculante.
- **Escrutinio Oficial:** Conteo manual y formal que realizan las comisiones escrutadoras durante los días siguientes sobre los pliegos físicos sellados.
- **Regla Contable:** Validación aritmética donde la suma de todos los votos (candidatos + votos en blanco + nulos + tarjetas no marcadas) debe ser exactamente igual al total de ciudadanos sufragantes que depositaron su voto en la urna.
- **Acta Dudosa:** Acta cuya regla contable no cuadra (por ejemplo, sufragantes = 180 pero suma de votos = 160). No se descarta del preconteo, sino que se registra en los acumulados y simultáneamente entra a la **cola de verificación humana** para revisión por auditores.
- **Jurado / Digitador:** Persona acreditada en la mesa de votación encargada de ingresar los totales del acta E-14 y transmitir la fotografía testimonial.
- **Auditor de Verificación:** Funcionario que, desde una consola web, revisa el acta dudosa, coteja la foto con los números digitados y aprueba o corrige los valores.

---

## Conceptos de Sistemas Distribuidos

- **Idempotencia:** Propiedad de una operación de producir exactamente el mismo resultado sin importar cuántas veces se ejecute consecutivamente. Se implementa mediante la clave `idem` (`SET idem:{idem} 1 NX EX 86400`) y la versión de acta en Redis.
- **Convergencia:** Garantía de que, ante cualquier permutación o desorden en la llegada de mensajes por problemas de red móvil, el estado final de los acumulados será idéntico.
- **Backplane:** Canal centralizado de comunicación (Redis Streams `ev:actas`) que permite que múltiples instancias que no comparten memoria se enteren de los eventos producidos en cualquiera de las demás.
- **Fan-Out:** Mecanismo de difusión de un único evento recibido a miles de clientes conectados concurrentemente.
- **Contrapresión (Backpressure):** Mecanismo de defensa del servidor cuando el cliente receptor consume datos a menor velocidad de la que el servidor produce, evitando el colapso por agotamiento de memoria RAM.
- **Full Jitter:** Estrategia de dispersión aleatoria uniforme en reintentos con retroceso exponencial para evitar la sincronización de miles de clientes en picos destructivos (*Thundering Herd*).
- **Semáforo / Bloqueo Distribuido (Distributed Lock):** Mecanismo atómico (`SET lock:acta:{id} owner PX 30000 NX`) que asegura que una tarea sea asignada a un único trabajador en todo el clúster.
- **Compare-and-Delete:** Operación segura de liberación de bloqueo donde se verifica que el identificador del dueño coincida antes de borrar el recurso, evitando liberar bloqueos que ya han sido transferidos a otro auditor tras expirar.

