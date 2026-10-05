# Reglas de filtrado — Web App "Generar Pairings" (NB y WB)

Explica, paso a paso, qué hace `8. Web App Pairings.gs` desde que consulta BigQuery hasta que
entrega las hojas "Vuelos" / "Candidatos" / "Resumen" (+ "Excluidos" en NB). Es el mismo
criterio ya validado en sesiones anteriores (manual "Traspaso FREEZE LP" + confirmaciones
directas de Fernando), solo que acá queda todo junto y explicado en un solo lugar.

Las 4 (NB) o 3 (WB) hojas que arma, y qué es cada una:

| Hoja | Qué tiene |
|---|---|
| **Candidatos** | TODOS los pairings que pasaron todas las reglas — tabla plana, 1 fila por pairing. Es el "universo" de donde se arma lo demás. |
| **Excluidos** (solo NB) | Los pairings que NO pasaron, con el motivo exacto de por qué. |
| **Vuelos** | Los candidatos ya armados en el formato de bloque final (con huecos para Instructor/Actividad) — en NB, 2 candidatos combinados por bloque; en WB, 1 pairing = 1 bloque. |
| **Resumen** | Una fila resumen por pairing, con fórmulas que apuntan a "Vuelos" (para que, una vez puesto el Instructor, se actualice solo). |

---

## 1. De dónde salen los datos

Tabla: `operations-data-prod.carmen_gold.crew_pairing_carmen_system` (facturado al proyecto
`datadem-home`, por el tema de permisos ya resuelto). El `WHERE` siempre trae:

- `subsidiary_code = 'LP'`
- `crew_range_type_code = 'SAB'`
- El `QUALIFY` se queda con la carga MÁS RECIENTE del mes (FP si existe, si no ES) — esto evita
  traer datos de una carga vieja ya reemplazada.
- El rango de fechas es dinámico: **del día 1 del mes ANTERIOR al último día del mes elegido**
  (ej. si pides noviembre, trae desde el 1-oct hasta el 30-nov) — el mes extra de colchón es
  porque un pairing puede "empezar" en un mes y su día 1 real caer antes de la fecha de corte.
- Flota: NB filtra `subfleet_code IN ('319','320')`; WB filtra `('763')` para B767 o
  `('788','789')` para B787.

---

## 2. Narrow Body (A320/A319) — reglas

Fuente original: `generar_candidatos_nb.py`, pasos 2.9-2.14 del manual. El Web App las copia
tal cual.

### 2.1 Filtro de mes y ruta (`filtrarMesYRutaNB_`) — a nivel de CADA TRAMO (pierna), no del trip completo

Un tramo pasa si **todo** esto es cierto:
- Su fecha cae en el mes/año pedido.
- Sale de LIM, **o** llega a LIM (uno de los dos, no hace falta ambos).
- La ruta es válida: si llega a LIM, siempre pasa (sin importar de dónde salga); si no llega a
  LIM, su destino debe estar en la lista blanca: **AQP, CIX, CJA, CUZ, IQT, PCL, PEM, PIU,
  TPP**.

**Importante — esto es a nivel de TRAMO, no de trip**: un tramo que vuelve a LIM SIEMPRE pasa
este filtro, aunque el tramo de ida del mismo trip haya sido descartado por ir a un destino
inválido. El trip completo recién se descarta más adelante (sección 2.2) si le queda menos de 1
"día 1" completo.

Exclusiones SIEMPRE aplicadas (destinos que nunca sirven para LCK, no están en la lista blanca):
TRU, JUL, JAE, AYP, JAU — quedan fuera simplemente por no estar en la lista.

**AQP es dinámico por mes**: confirmado excluido en **octubre 2026** (por el Perumín). Para
noviembre/diciembre 2026, por ahora SÍ se incluye AQP (no hay confirmación de que la exclusión
siga vigente esos meses) — si Fernando confirma que sigue excluido, es una línea de código
(`EXCLUSIONES_POR_MES_NB_`).

### 2.2 "Primera mitad" del pairing (`armarPrimerasMitadesNB_`) — a nivel de TRIP completo

Para cada trip, se agrupan sus tramos (ya filtrados por 2.1) y:

1. **Día 1 real vs. día 1 filtrado**: se calcula el `dia_duty` mínimo ANTES de aplicar 2.1, y se
   compara contra el mínimo que sobrevive DESPUÉS del filtro. Si no coinciden (el día 1 real
   cayó fuera de mes/ruta y lo que sobrevivió es en realidad el día 2 o 3), se descarta el trip
   completo — el instructor solo puede cubrir el día 1 REAL, nunca un día posterior.
2. Se toman solo los tramos del día 1 (mínimo `dia_duty`), ordenados por hora de salida.
3. Si quedan **menos de 2 tramos** ese día → descartado (no hay ida+vuelta el mismo día).
4. Si el día 1 tiene **6, 8 o 10 tramos** (3, 4 o 5 idas+vueltas seguidas) → descartado completo
   (demasiado para un instructor, no se toman ni los 2 primeros).
5. De los 2 primeros tramos del día 1: la ida debe salir de LIM, la vuelta debe llegar a LIM, y
   la vuelta debe salir de donde llegó la ida (si no, es una ruta triangular con un tramo
   intermedio que se filtró en 2.1 — se descarta).
6. Reglas horarias sobre esos 2 tramos:
   - La ida debe salir **después de las 08:30**.
   - Cada tramo (ida y vuelta) debe tener **HBT > 1 hora**.
   - La conexión interna (entre que llega la ida y sale la vuelta) debe ser **positiva** (no
     puede ser negativa o cero — dato inconsistente).
   - El PSV total (desde que sale la ida hasta que llega la vuelta) no puede superar **11
     horas**.

Si pasa todo lo anterior, el trip queda como **candidato válido**. Si no, se descarta con un
motivo específico (visible en la hoja "Excluidos").

**Nota sobre "Excluidos"**: solo registra motivo para trips que SÍ llegaron a la etapa 2.2 (es
decir, que tenían al menos 1 tramo sobreviviendo el filtro 2.1). Un trip cuyos DOS tramos se
cayeron en 2.1 (por mes o ruta) nunca llega a 2.2, y por lo tanto no aparece ni en "Candidatos"
ni en "Excluidos" — simplemente no se ve en ningún lado (no se trackea motivo a ese nivel).

### 2.3 "Posible 2do vuelo" (columna extra en Candidatos y Vuelos)

Para cada candidato, se listan TODOS los demás candidatos del mismo día cuya salida cae dentro
de la ventana (50 min, 1 h 30) después de que este candidato regresa a LIM — no solo el que el
algoritmo terminó usando, para poder verificar o rearmar el emparejamiento a mano.

### 2.4 Emparejamiento en bloques (`parearCandidatosNB_`, solo afecta la hoja "Vuelos")

Recorre los candidatos en orden cronológico; cada uno se une con el primer candidato del mismo
día (todavía no usado) cuya salida caiga en la ventana (50 min, 1 h 30) desde su regreso. Si no
encuentra pareja, queda como bloque de 1 solo pairing (2 filas en vez de 4).

### 2.5 Lo que NB **NO** filtra (a diferencia de WB — ver sección 4)

- **No hay filtro de día de semana a nivel de candidato.** Un candidato con STD después de
  08:30 puede caer sábado o domingo y NO se descarta acá — el manual recomienda "empezar
  asignando jueves y viernes" como preferencia de reparto (eso se aplica después, al repartir
  los slots en la Matriz), no como una regla que invalide el candidato en esta etapa.
- **No hay un tope de "cuántos días dura el pairing completo".** Solo importa el día 1: si el
  pairing real del trip dura 3, 4 o más días, no importa — el instructor solo cubre el día 1 y
  el resto del pairing no se mira para nada.

---

## 3. Wide Body (B767/B787) — reglas

Fuente original: lógica ya usada en `5. buscar vuelos B767.gs`/`B787.gs` (validada contra el
roster real de referencia en sesiones anteriores).

### 3.1 Filtro a nivel de TRAMO (`cargarYFiltrarWB_`)

Un tramo pasa si:
- El día de la semana es **lunes a viernes** (sábado/domingo siempre se excluyen acá — a
  diferencia de NB).
- La fecha de PRESENTACIÓN (no la del vuelo) no cae domingo.
- La ruta es una de las permitidas: **LIM-MIA, MIA-LIM, LIM-SCL, SCL-LIM**.
- El número de vuelo es uno de los de entrenamiento confirmados:
  - MIA (B767): 2480, 2481, 2695, 2694, 2698, 2699.
  - SCL B767: 2413, 2412.
  - SCL B787: 2697, 2696.

### 3.2 Filtro a nivel de TRIP completo

Un trip (agrupado por `pairing_id + fecha_inicio_trip`) pasa si **todos** sus tramos cumplen lo
de 3.1, Y además:
- El trip "empieza" en el mes/año pedido (la pierna de `dia_duty` mínimo cae en ese mes/año).
- Los valores de `dia_duty` del trip son **contiguos** (sin huecos) y el rango entre el mínimo y
  el máximo **no supera 2** — es decir, el pairing dura como máximo 3 días de duty distintos.
- Al final, se descartan los trips que terminan con **menos de 2 tramos válidos** (ej. si por un
  corte de carga BigQuery solo trajo la ida y no la vuelta).

### 3.3 Por qué no hay "Posible 2do vuelo" en WB

En WB, **1 pairing YA ES el bloque completo** (ida + vuelta del mismo trip) — no se combinan 2
pairings distintos como en NB. Por eso no aplica ese concepto acá.

---

## 4. Comparación directa NB vs. WB (respondiendo punto por punto)

| Pregunta | Narrow Body (320/319) | Wide Body (767/787) |
|---|---|---|
| ¿Filtra sábado/domingo? | **No**, a nivel de candidato (es preferencia de reparto después, no regla de validez acá) | **Sí**, cualquier tramo en sábado/domingo se excluye directo |
| ¿Cuántos días puede durar el pairing real? | No importa — solo se usa el día 1, el resto del pairing (si dura más) no se mira | Máximo 3 días de duty distintos (`dia_duty` contiguo, rango ≤ 2) |
| ¿1 pairing = 1 bloque, o se combinan 2? | Se combinan **2 pairings** del mismo día en 1 bloque (si hay pareja válida; si no, queda 1 solo) | **1 pairing = 1 bloque** completo (ida+vuelta ya vienen juntos) |
| ¿Hora mínima de salida? | Sale después de 08:30 (solo la IDA del bloque) | No hay ese filtro explícito (viene dado por los números de vuelo ya fijos) |
| ¿HBT mínimo por tramo? | > 1 hora | No se filtra por HBT (viene dado por los vuelos ya fijos) |
| ¿Tope de PSV? | ≤ 11 horas | No aplica (no hay "PSV" en el mismo sentido — WB son 2 tramos de un pairing ya armado por Carmen) |
| Rutas válidas | AQP\*, CIX, CJA, CUZ, IQT, PCL, PEM, PIU, TPP (\*AQP excluido en oct-2026, no confirmado para nov/dic) | LIM-MIA / LIM-SCL (B767), LIM-SCL (B787), por número de vuelo específico |
| Cupos por vuelo | 4 (A320) / 3 (A319) — se calcula en el paso de asignación, no en Candidatos/Vuelos de este Web App | 5 (B767) / 6 (B787) |

---

## 5. Lo que este Web App NO hace (a propósito)

- No asigna instructor ni actividad — esas celdas quedan en blanco para llenar a mano (así lo
  pidió tu jefe).
- No verifica equidad ni disponibilidad real contra ninguna Matriz — eso existe para B767/B787
  en `5. buscar vuelos B767/B787.gs` (flujo mensual real), pero no está conectado a este Web App
  porque es un entregable aparte, más simple, solo para sacar el formato rápido.
- No hay "Excluidos" para WB todavía — el filtrado de WB es a nivel de tramo (no trackea un
  motivo por trip como NB); si hace falta, se puede agregar con el mismo criterio de NB.
