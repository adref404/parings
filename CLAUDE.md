# Pairings (repo) — contexto para Claude Code

Este repo contiene automatizaciones de LATAM. Esta nota cubre el proyecto **Pairings WB**
(carpeta `WB/`). No describe ni modifica nada relacionado a NB.

## Pairings WB — resumen operativo

- **Objetivo**: automatizar el cálculo mensual de pairings WB (B767, base LIM, TM) en Apps
  Script + BigQuery + Google Sheets. Ver `WB/README.md` y `WB/docs/DECISIONS.md` para detalle.
- **Repo/rama**: `adref404/parings`, rama de trabajo `Pairings_WB` (nunca `master`).
- **Carpeta del proyecto Apps Script**: `WB/` (clasp `rootDir` = la propia carpeta).
- **Script ID**: `1IFvtE2-2IP0mJkB-Jqm6IDdv586d5T_qrkmfx7_3I9L72fCZRolCTFrw` — **standalone**, NO
  container-bound al Spreadsheet (verificado vía Apps Script API). El menú requiere un trigger
  instalable activado manualmente una vez (`configurarMenuPairingsWB`, ver README).
- **Spreadsheet productivo**: `13gUbtsbVT1HpXemyJl510EZLi-xemMJYSwBCH2q9K0c` ("Pairings WB"), en
  la carpeta Drive `1T6KLxeLkII8WSUmFrxK3RUCsI6w9i1iZ`. Históricos en
  `11Aqpqiw7JKhTzJkdM19wKIlHV8MhOZxv`.
- **Fuente BigQuery (fija, no renegociable)**:
  `operations-data-prod.carmen_gold.crew_pairing_carmen_system` (particionada por MES en
  `pairing_start_date`, clustered por `crew_base_code`, 84 columnas). NUNCA usar
  `so-cm-opanalytics-dev.Performance_VOM` ni CSV/XLSX del repo como fuente productiva — esos son
  solo benchmark/regresión.

## Comandos

```powershell
cd WB
node --test              # 120+ tests de logica pura (Node built-in test runner, sin deps)
clasp.cmd status          # SIEMPRE antes de push: lista exacta de archivos a subir
clasp.cmd push
```

`clasp.cmd`, no `clasp` — en este equipo Windows, `clasp` intenta correr `clasp.ps1` y la
Execution Policy de PowerShell lo bloquea. No cambiar la Execution Policy global para evitar esto.

## Reglas de seguridad no negociables

- **Ownership**: `RESUMEN.INS`/`RESUMEN.ACT` (columnas G/H) son HUMANAS — ningún refresh/cálculo
  las sobrescribe jamás. `RESUMEN.BP` (K) se calcula en memoria, nunca como fórmula (evita
  `#N/A` y problemas de separador `,`/`;` por locale).
- **NO reglas NB en WB**: prohibido aplicar inicio>08:30, conexión 50-90min, PDR, PSV, A319/A320,
  o cualquier regla que provenga de la lógica NB. `70_QA.js` (`q16NbContaminationZero`) escanea el
  código fuente real por estos tokens como test de regresión continua.
- **`pairing_id` no es PK global**: la identidad real es `pairing_instance_key = hash(snapshot_key
  + pairing_id)`. Nunca mezclar snapshots/cargas distintas.
- **Snapshot certification gate**: un cálculo productivo se bloquea si `_CONFIG.SNAPSHOT_CERTIFICATION
  != CERTIFIED` (salvo modo preview explícito).
- **BigQuery solo lectura**: sin `SELECT *`, con filtro de partición, `maximumBytesBilled`
  configurado, sin DML/DDL. Ver `25_BigQueryGateway.js`.
- **Histórico**: Google Sheet nativo (no XLSX), idempotente por `history_key`
  (`65_History.js`/`66_HistoryService.js`), nunca sobrescribe uno anterior.

## Proceso de deploy

1. `node --test` en `WB/` → 0 fallos.
2. `clasp.cmd status` → confirmar que solo se suben `.js` + `appsscript.json` (nunca `tests/`,
   `docs/`, `package.json` — ver `WB/.claspignore`).
3. `clasp.cmd push`.
4. Verificar post-push clonando el Script ID a un directorio temporal FUERA del repo y comparando.
5. Commit + `git push origin Pairings_WB` (nunca force-push, nunca tocar `master`).

## Archivos clave

- `WB/00_Constants.js` — nombres de hoja, esquemas de columnas, defaults de `_CONFIG`.
- `WB/30_PairingAssembler.js` + `WB/35_WBRules.js` — el corazón del cálculo (leg→pairing, reglas WB).
- `WB/40_Reconciliation.js` — semántica ACTIVE/RELINKED_IDENTICAL/REVIEW_SOURCE_CHANGED/ORPHANED/NEW.
- `WB/80_Orchestrator.js` — pipeline completo (dry run / publish), único punto que escribe hojas.
- `WB/docs/DECISIONS.md` — toda decisión de diseño no trivial, con su porqué y evidencia (D1-D16).
- `WB/docs/IMPLEMENTATION_PLAN.json` — estado GREEN/YELLOW/RED de cada feature con evidencia.

## Limitaciones conocidas al momento de esta sesión

Ver `WB/docs/DECISIONS.md` D2-D4: el script es standalone (gate de menú), y desde Claude Code no
hubo permiso de IAM (`bigquery.jobs.create`) para ejecutar consultas reales de BigQuery, ni scope
para leer el contenido vivo del Spreadsheet. El código está escrito y probado (lógica pura) para
ese flujo, pero su ejecución end-to-end en producción requiere que un humano la corra una vez
autorizado en el navegador.
