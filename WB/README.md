# Pairings WB — Automatización productiva

Automatiza el cálculo mensual de pairings WB (B767, base LIM, tripulación TM) para LATAM Perú:
descubre/certifica el snapshot correcto en Carmen Gold, reconstruye pairings desde BigQuery,
aplica las reglas WB (rutas MIA/SCL/ATL, máximo de días ocupados, días de semana permitidos),
concilia con las asignaciones humanas (INS/ACT) ya existentes sin pisarlas, publica
RESUMEN/Vuelos/Cronograma/_PAIRINGS_DATA, y archiva un histórico Google Sheet reproducible.

## Arquitectura

```
BigQuery (Carmen Gold, solo lectura)
  -> BigQueryGateway (25)          SQL parametrizado, sin SELECT *, con poda de particion
  -> SnapshotService (20)          identidad de carga -> snapshot_key -> pairing_instance_key
  -> PairingAssembler (30)         leg -> pairing, ocupacion via duty, pairing_content_hash
  -> WBRulesEngine (35)            rutas/dias/DOW segun _CONFIG (ruleset LP_WB_B767)
  -> AssignmentReconciler (40)     ACTIVE / RELINKED_IDENTICAL / REVIEW_SOURCE_CHANGED /
                                    ORPHANED_SOURCE_MISSING / NEW (nunca pierde INS/ACT)
  -> Renderers (55/56/57/60)       RESUMEN, Vuelos, Cronograma, _PAIRINGS_DATA
  -> QaService (70)                Q1-Q20 pre-write y post-write
  -> HistoryService (66) + Audit (75)   histórico idempotente + _RUNS
```

Fuente productiva **exacta** (no negociable, ver Sección 3 de la misión original):
`operations-data-prod.carmen_gold.crew_pairing_carmen_system`.

## Setup (Windows / PowerShell)

El binario instalado es `clasp.cmd` (no `clasp` a secas: la Execution Policy de PowerShell
bloquea `clasp.ps1`). Todos los comandos de este documento usan `clasp.cmd`.

```powershell
cd "WB"
clasp.cmd login              # una vez, si el token expira
clasp.cmd status             # lista exactamente lo que se subiria
clasp.cmd push                # sube el codigo (ver Preflight abajo)
```

## Pruebas locales

Toda la lógica de negocio pura (config, snapshot, hashing, ensamblado de pairings, reglas WB,
reconciliación, SQL builder, parsing por esquema, lanes de Cronograma, historial, QA) tiene
pruebas con el test runner nativo de Node (sin dependencias externas):

```powershell
cd WB
node --test
```

## Deploy (preflight obligatorio antes de `clasp push`)

1. `git status` limpio o con un checkpoint claro; rama = `Pairings_WB`.
2. `node --test` → 0 fallos.
3. `clasp.cmd status` → revisar la lista exacta de archivos a subir (debe ser solo `.js` +
   `appsscript.json`; nunca `tests/`, `docs/`, `package.json`).
4. `clasp.cmd push`.
5. Verificar post-push: clonar el Script ID a un directorio temporal fuera del repo y comparar.

## Estructura del Spreadsheet

Visibles: `Vuelos`, `Cronograma`, `RESUMEN`, `Diccionario`.
Técnicas (ocultas): `_PAIRINGS_DATA`, `_CONFIG`, `_RUNS`.

`RESUMEN` es la única tabla de asignaciones humanas: `INS`/`ACT` (columnas G/H) nunca se
sobrescriben en un refresh — ver `AssignmentReconciler` (`40_Reconciliation.js`) y
`docs/DECISIONS.md` (D12/D13).

## Menú "Pairings WB" (único menú de nivel superior)

Cuatro acciones de usuario final, en lenguaje operacional (sin BigQuery/snapshot/hash/`_CONFIG`):

1. **Actualizar Pairings WB** → el flujo normal de cada mes: revisa todo silenciosamente
   (configuración, snapshot, seguridad del baseline), previsualiza, muestra un resumen humano y
   publica SOLO si usted confirma y todos los controles pasan.
2. **Previsualizar cambios** → el mismo cálculo, con resumen humano, en modo de solo lectura.
3. **Ver estado del mes** → vistazo rápido y barato (sin BigQuery) al periodo configurado.
4. **Ir a RESUMEN** → activa la hoja RESUMEN (valida `EXPECTED_SPREADSHEET_ID` antes de actuar).

Toda herramienta técnica/administrativa vive bajo **Administración** (Configuración / Fuente de
datos / Proceso y reconciliación / Históricos / Auditoría y QA), que termina en **Guía de uso y
administración** (sidebar con el manual completo). Ver `docs/DECISIONS.md` D21.

### Flujo mensual técnico (para administración)

1. **Configurar año y mes** (si cambia el periodo).
2. **Detectar snapshots del mes** → lista de cargas candidatas en Carmen Gold.
3. **Certificar snapshot** → obligatorio antes de publicar (bloqueo real, no cosmético).
4. **Comparar snapshot con RESUMEN actual** (Fuente de datos) → diagnóstico DRY-RUN que separa "el
   hash legacy no es compatible" de "el pairing realmente cambió", comparando hechos visibles
   (Fecha/Vuelo/Ruta/Inicio/Fin) en vez del hash. Necesario mientras el baseline tenga asignaciones
   humanas migradas sin `pairing_instance_key`/`source_snapshot_key` (ver D21): publicar queda
   bloqueado hasta resolverlo — no hay forma de "forzar" el bloqueo.
5. **Previsualización técnica** (Proceso y reconciliación) → dry run completo, sin escribir nada.
6. **Actualizar Pairings WB** (menú principal) → escribe RESUMEN/Vuelos/Cronograma/_PAIRINGS_DATA,
   corre QA post-escritura, y archiva el histórico automáticamente si `AUTO_ARCHIVE_ON_SUCCESS=TRUE`.
7. **Ver último run** / **Ejecutar QA** (Auditoría y QA) para auditoría en cualquier momento.

## Gate crítico: script standalone

El Apps Script (`1IFvtE2...`) **no está container-bound** al Spreadsheet (confirmado vía
`script.googleapis.com` — `parentId` vacío). Por eso `onOpen()` simple trigger nunca se dispara
para el Spreadsheet productivo. La mitigación es un **trigger instalable**: ejecutar **una sola
vez**, manualmente, desde el editor de Apps Script (Extensiones → Apps Script → seleccionar
`configurarMenuPairingsWB` → Ejecutar), lo cual pedirá autorización OAuth interactiva. Después de
eso, el menú aparece solo cada vez que se abre el Spreadsheet. Ver `docs/DECISIONS.md` (D2).

## Troubleshooting / IAM necesario

- **BigQuery**: la identidad que autorice el script necesita `roles/bigquery.dataViewer` (o
  equivalente) sobre `operations-data-prod.carmen_gold` y `roles/bigquery.jobUser` sobre el
  proyecto configurado en `_CONFIG.BIGQUERY_JOB_PROJECT_ID`. Si falta el segundo rol, `Jobs.query`
  devuelve `403 PERMISSION_DENIED: User does not have bigquery.jobs.create permission`. El DATA
  project (`operations-data-prod`, donde vive la tabla) y el JOB project (donde se crea/factura el
  query job) son cosas distintas en BigQuery: `operations-data-prod` NO tiene por qué tener (ni
  tiene, confirmado) `bigquery.jobs.create` para esta identidad. Usar el menú **BigQuery → Probar/
  configurar proyecto de ejecución** para probar (sin efectos secundarios) y, solo si ambas pruebas
  pasan y se confirma explícitamente, alinear `BIGQUERY_JOB_PROJECT_ID` a un proyecto que sí tenga
  ese permiso — ver D19/D20 en `docs/DECISIONS.md`.
- **Sheets/Drive**: el script pide los scopes de `SpreadsheetApp`/`DriveApp` automáticamente al
  autorizarse (no hay `oauthScopes` explícitos en `appsscript.json`: se detectan por los servicios
  usados).
- **Menú no aparece**: ver "Gate crítico" arriba.
- **`#N/A` en BP**: no debería ocurrir nunca — `BP` se calcula en memoria (D8), no como fórmula.
  Si aparece, ejecutar "Ejecutar QA" (Q18-Q20) para localizarlo.

## Decisiones registradas

Ver `docs/DECISIONS.md` para cada decisión de diseño no trivial (D1-D16) con su evidencia.
