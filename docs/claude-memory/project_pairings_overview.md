---
name: project-pairings-overview
description: "What the LATAM/parings project is, its current state, and the key scripts/files (as of 2026-09-24)"
metadata: 
  node_type: memory
  type: project
  originSessionId: ac08facc-2c51-4558-85a4-59dc0ce883ad
  modified: 2026-09-24T00:00:00.000Z
---

Fernando works on LATAM Airlines crew-training scheduling ("Freeze" process): assigning instructor Line Checks (LCK) to specific flights, for both WB (wide body: B767 MIA/SCL routes, B787 SCL route) and NB (narrow body: A320/A319 domestic routes) fleets.

**Why:** The manual process (described in "Manual Traspaso FREEZE LP.docx" and the newer "Procedimiento_LCK_A320F_Flujograma_y_Paso_a_Paso.docx") takes a person ~1-1.5 days per month across 5 phases (Insumos → Demanda → Instructores → Búsqueda de vuelos → Consolidación → Freeze). Fernando is automating this with a set of Google Colab notebooks in `automatizacion_bigquery/` that query BigQuery directly and read/write the real Google Sheets involved, in **preview-first mode** (nothing writes to a live sheet until Fernando reviews the printed preview and manually uncomments the write cell).

**How to apply:** Treat the newer flowchart doc ("Procedimiento_LCK_A320F_Flujograma_y_Paso_a_Paso.docx", reunión Parte 4, 10-ago-2026) as authoritative when it conflicts with the older manual or a training video — e.g. the NB route list AQP/CIX/CJA/CUZ/PEM/PIU/TBP/TPP/TCQ (no IQT) supersedes an older video-sourced list that included IQT and excluded TBP/TCQ.

## Legacy scripts (parent folder, NOT modified — reused via `sys.path` imports)

- `generar_candidatos_nb.py` — loads/depures the NB CSV, filters by month+route+hour rules, builds "primera mitad" candidates (2-leg same-day round trips) per pairing (2.9-2.14 of the manual).
- `generar_reporte_pairings_nb.py` — imports from the above; pairs 2 candidates into a 4-row "instructor day" block (2.15 connection rule between pairings), builds the block-style Excel (Pairings NB / Instructores / Resumen Final sheets). **Format confirmed FINAL/frozen by Fernando** — Instructor/Actividad columns intentionally blank (filled by a parallel manual process, now superseded by the Colab automation below).
- `generar_reporte_pairings.py` — the WB equivalent (B767/B787).

These are considered validated/frozen — the Colab notebooks below **copy their logic literally into notebook cells** rather than importing them, so they can run standalone in Colab without the parent folder on the path, and so editing a notebook never risks touching the validated original.

## Colab automation pipeline (`automatizacion_bigquery/`, built 2026-09-23/24) — current state

Four notebooks, all self-contained (BigQuery query + Sheets read/write inline, no dependency on each other's runtime state — each one re-derives what it needs). **Ideal execution order each month:**

1. **`Automatizacion_Fase1_2_Demanda_Instructores.ipynb`** (Fase 1 Demanda + Fase 2 Instructores) — run FIRST. Reads Archivo 9 (`PROGRAMAR=Sí` → demanda) and "Rol Instructores LP <MES>" (`IDE A320=OK` → instructores habilitados), calculates días-IDE/vuelos needed, and reserves slots by writing the literal text `"LCK A320F"` into the Matriz (`Matriz_<Mes>_<Año>` spreadsheet) via round-robin (variety, no 2 consecutive days, only Mon-Fri). **Downstream notebooks depend on these placeholder cells existing.**
2. **`Automatizacion_Fase3_Asignacion_Instructor_Vuelos.ipynb`** (Fase 3, optional but recommended) — run second. Independently re-queries BigQuery to build all NB candidate blocks (2 pairings = 1 instructor-day), matches them against the `"LCK A320F"` slots just written (exact date match, only complete 2-pairing blocks, normalized-accent name match against the instructor catalog), and produces a downloadable formatted "Pairings NB" Excel (dropdowns, Conexión/PSV formulas, Resumen Final sheet) — this is the classic block-format deliverable from `generar_reporte_pairings_nb.py`, now instructor+actividad pre-filled instead of blank. **Does not write anything back to Sheets.**
3. **`Automatizacion_Fase4_Consolidacion.ipynb`** (Fase 4 Consolidación + Fase 5 Freeze) — run LAST, once per month. Re-does the exact same bloques+Matriz matching independently, then writes (each behind its own preview-then-uncomment gate):
   - The detailed vuelo text into the Matriz, **replacing** each `"LCK A320F"` placeholder (format: 2 stacked mini-blocks — actividad/ruta/2 legs — per cell, confirmed by Fernando). **This consumes the placeholder text** — once written, notebook #2's `"LCK A320F"` slots no longer exist as such, so re-running #3's matching (which looks for that exact string) would find 0 slots. Run #3 *before* actually executing this write if you still need the Excel deliverable that month.
   - CUADRO FINAL in Archivo 10 (`AC10:AI...`, Fecha/DíaSEM/Vuelo/Ruta/N°Cupos/INS, **Grupo left blank** — see below), plus an auxiliary table (`AK14:AM...`, INS/Cantidad/Grupos) and an "INS NO CONSIDERADOS" list.
   - Per-tripulante cross-check: reads the pre-existing "INS FINAL" column (Y, blocked instructors, already resolved by another process — never touched) and computes "INS F a considerar" (Z) and "Grupo" (AA) for every tripulante.
   - Fase 5 (Freeze): a roster block (`A1`/`A2`, BP/CAT/Nombre/Estado/Vigencia/Comentario/Grupo, filtered to `PROGRAMAR=Sí`) and an alternate CUADRO FINAL table (`L5` label / `L6` headers / `L7+` data, this time **with Grupo filled** — the instructor's own group) written to a Freeze-example sheet.
4. **`Automatizacion_LCK_A320F_NB.ipynb`** — the original Fase 0+3 notebook (candidatos+bloques only, no instructor assignment, Instructor/Actividad left as blank dropdowns). **Now optional/legacy** — #2 and #3 above cover the same ground automatically; keep only if you want the raw bloques Excel without any Matriz dependency.

### The dynamic group system (important, changed mid-session)

The 3 (now 4) instructor groups are **NOT hardcoded** anywhere in the notebooks — Fernando types the member lists himself into 4 live cells in Archivo 10's "LCK 320" sheet (`AD2`=Grupo 1, `AE2`=Grupo 2, `AF2`=Grupo 3, `AG2`=Grupo 4, comma-separated names), because the real composition already changed once mid-project (the group membership documented in the original flowchart video turned out to be stale). The notebooks read these 4 cells live via `ws.acell()` every run. Fernando's own working formula in the sheet (`=SI(ESNUMERO(HALLAR(AK15;$AD$2));"Grupo 1";...)`, Spanish `HALLAR`/`ESNUMERO`/`SI`) is replicated exactly in `Automatizacion_Fase4_Consolidacion.ipynb`'s aux-table cell, for consistency with what's already deployed.

### Per-tripulante Y → Z/AA logic (the "sin inventar nada" resolution)

Originally flagged as "can't automate, needs REVA history not confirmed in BigQuery" — but Fernando clarified the blocking data **already exists** as column Y ("INS FINAL", resolved by a separate process, never touched by the notebook). The notebook just needs to: for each tripulante, check whether any current group-member's name (or a known nickname — Sebas/Fio/Fiore/Cris/etc., table built from real messy examples Fernando pasted) appears anywhere in that tripulante's Y text; a group is eliminated if any of its members is mentioned. **Z ("INS F a considerar")** = the full names of the members of each *surviving* group (comma within a group, `" / "` between groups — confirmed format: `"Patricia, Cristian, Fiore / Juan, Felipe"`). **AA ("Grupo")** = the surviving group numbers, format `"Grupo 1/2/3"`. Validated against 20 real messy Y strings Fernando pasted (typos like "Celis"/"Celiz", "y"/","-separated free text, `#N/A`) — see [[feedback-qa-rigor-pairings]].

### Real bugs found and fixed this session (BigQuery↔Colab specific, not in the legacy scripts)

- `get_all_records()` fails with `GSpreadException: duplicate headers` when a real sheet (Archivo 9) has note/warning rows above the actual header row — fixed by switching to `get_all_values()` + searching for the header row by content (`"BP"` + `"PROGRAMAR"` both present), not by a fixed row number. Same robust-header-search pattern reused later to find `"INS FINAL"`, `"CAT"`, `"Vigencia"`, `"PROGRAMAR"`, `"OBS FREEZE"` in Archivo 10.
- `bigquery.Client(project="operations-data-prod")` fails with `403 bigquery.jobs.create` — Fernando's account has query rights on the *data* but not job-creation rights in that project. Fix: bill the job to a *different* project he owns (`datadem-home`) while keeping the `FROM` clause fully-qualified to `operations-data-prod...` — standard BigQuery cross-project pattern (`bigquery.Client(project="datadem-home")`).
- `to_dataframe()` then fails with `bigquery.readsessions.create` permission denied — it silently tries the BigQuery Storage API for speed. Fix: `to_dataframe(create_bqstorage_client=False)` forces the plain REST fallback.
- With the Storage API disabled, BigQuery TIME columns (`std_hb`/`sta_hb`/`hbt`) come back as real `datetime.time` objects instead of strings — broke `s.split(":")` calls (`_hora_td`) and, more subtly, broke the **generated Excel's own formulas**: `openpyxl` writes a `datetime.time` as a real numeric Excel time, and `TIMEVALUE()`/`LEFT()` in the Conexión/PSV/Actividad formulas expect *text*, producing `#¡VALOR!`. Fixed by `str(...)`-casting every such value before writing **and** forcing `cell.number_format = "@"` (Text) — without the format override, Excel silently re-converts the text back to a numeric time the moment a user clicks into the cell and presses Enter (re-triggering the same formula breakage), even though the value looked fine on open.
- Matriz dates ("1/10/2026", no leading zero) vs. bloque dates (`strftime("%d/%m/%Y")` → "01/10/2026", zero-padded) silently failed to match as plain strings for every day 1-9 of the month (9 of 24 real reservations wrongly reported as "no bloque"). Fixed by comparing `(int(d), int(m), int(a))` tuples instead of raw strings.
- Pasting a numeric-looking BP string into a Sheets cell without forcing text format made Excel/Sheets auto-convert it to a real number on open (leading `'` shown in the formula bar), breaking a downstream VLOOKUP that expected text — same "force number_format" class of bug as above, mirror-imaged (there: wanted number, got text; here: wanted text, got number — the fix in both cases is to make the *stored type* match what the consuming formula expects, not just what looks right on screen).

**QA discipline used throughout (see [[feedback-qa-rigor-pairings]]):** every notebook cell was extracted and executed against synthetic mock data (`FakeWS`/`FakeGC`/`FakeBQClient` classes simulating gspread/BigQuery) before being handed to Fernando, and re-validated against his *real* pasted data (messy Y-column examples, real group composition) whenever he reported something that didn't match the synthetic assumptions.

## WB pipeline (B767 + B787, built 2026-09-24) — parallel to the NB pipeline above

Fernando asked to replicate the same automation for WB (wide body): **B767** and **B787** are
two separate processes (run the same parameterized notebook twice, once per `FLOTA_WB`), not
one combined flow. Three notebooks built so far, mirroring the NB ones but parameterized by
`FLOTA_WB = "767"` or `"787"` at the top of each:

1. **`Automatizacion_WB_Fase1_2_Demanda_Instructores.ipynb`** — demanda (Archivo 9, same file
   as NB's, tabs "LCK 767"/"LCK 787") + instructores IDE (Rol Instructores, same file as NB,
   columns `IDE B767`/`IDE B787` instead of `IDE A320`) + round-robin reservation in the
   **same Matriz tab as NB** (WB instructors occupy new rows there, added by hand like NB's
   were). Reserves only 1 Matriz cell per bloque (día de ida) — see the B767-MIA caveat below.
2. **`Automatizacion_WB_Fase3_Asignacion_Instructor_Vuelos.ipynb`** — queries BigQuery for both
   WB subfleets together (763, 788, 789), reuses `generar_reporte_pairings.py`'s validated
   filtering logic (route/flight-number/day-of-week/dia_duty rules) ported to read ISO dates
   directly from BigQuery instead of the original CSV's Spanish-text dates. Matches Matriz
   reservations to real pairings and produces a downloadable Excel (Pairings + Resumen Final).
   **Fixed a real bug**: `consulta BQ WB.sql` had `subfleet_code IN ('762', '788', '789')` —
   `'762'` is a typo, corrected to `'763'` (B767's real subfleet code, per
   `generar_reporte_pairings.py`'s own comments).
3. **`Automatizacion_WB_Fase4_Consolidacion.ipynb`** — rebuilds the same pairings+matching, then
   (each behind its own preview-then-uncomment gate) writes the real vuelo text into the Matriz
   (replacing the placeholder) and writes the CUADRO FINAL into Archivo 10 (tabs "prueba de LCK
   767"/"prueba de LCK 787", same file as NB's Archivo 10). **CUADRO FINAL columns are found by
   header name, not fixed position** — confirmed the two WB tabs have different column orders
   (767: fecha/día/ruta/vuelo/cupo/INS/Grupo at AO-AU; 787: Fecha/DíaSEM/Vuelo/Ruta/N°Cupos/
   Grupos/INS at AP-AV) — the same header-search-by-content pattern already used for Archivo 9
   generalizes to this.

### Key structural difference from NB (not invented — from `generar_reporte_pairings.py`)

In WB, **1 "bloque" = 1 pairing** (already ida+vuelta), not 2 pairings combined like NB. A
LIM-SCL-LIM pairing returns same-day (like NB); a LIM-MIA-LIM pairing returns on a *different*
calendar day (multi-day trip). B767 flies both routes (route + flight number decide which);
B787 only flies the SCL route.

### The B767-MIA "two Matriz cells" resolution (confirmed 2026-09-24, resolved across notebooks)

Fernando confirmed a LIM-MIA-LIM pairing must mark **both** days (ida and vuelta) in the
Matriz for the instructor. But the exact gap between those dates varies per real pairing and
isn't knowable at the generic round-robin stage (Fase 1/2, before any real flight search) —
and B767 also flies same-day SCL trips, so a reserved slot might not even turn out to be MIA.
Resolution: Fase 1/2 reserves only 1 cell (día de ida); Fase 3 detects (and reports) when the
matched real pairing's vuelta date differs from ida; Fase 4 is the one that actually writes the
second Matriz cell, once the real date is known. The text written to that second cell is
currently the same full pairing text as the first cell — flagged as an assumption to confirm,
not a stated rule.

### Cupos per flota WB (confirmed from the manual, 2026-09-24)

"Dotación por flota" (manual, reglas transversales): A320 = 4 cupos, A319 = 3 (already used by
NB); **B767 = 1 TJ + 4 TC (5 cupos)**; **B787 = 6 tripulantes/vuelo (6 cupos)**. Used for
`CAPACIDAD_TC_POR_BLOQUE` (Fase 1/2 sizing, extending NB's "×2 legs" pattern — this extension
itself is NOT a confirmed rule, flagged in the notebook) and for the CUADRO FINAL "Cupos"
column in Fase 4.

### Still open for WB — needs more info before it can be built (sin inventar nada)

- **Freeze destination for WB**: confirmed it's the same "202609 Freeze LP" file, tabs
  "LCK 767"/"LCK B787" (same file NB's Freeze doc mentions), but the exact link/`gid` for those
  tabs hasn't been given yet — needed before the roster + alternate-CUADRO-FINAL "dos tablas"
  write (Fase 5 equivalent) can be built.
- **"INS F a considerar"/"Grupo" per-tripulante (Y→Z/AA equivalent) for WB**: a screenshot of
  "prueba de LCK 787" shows group definitions as `"Grupo 1"`/`"Karla y Cris"`/`"Grupo 2"`/
  `"Sebas"`/`"Grupo 3"`/`"Fio"` laid out as alternating label/value pairs in one row (around
  columns AQ-AV) — a different shape than NB's one-cell-per-group (`AD2`/`AE2`/`AF2`/`AG2`).
  Exact cell references and the equivalent of NB's "INS FINAL" column for WB tripulantes are
  not confirmed yet.
- Fernando also confirmed (like NB) that WB group composition varies month to month — whatever
  cell layout gets confirmed must be read live, never hardcoded, same principle as
  [[reference-pairings-manual]]'s NB note.

## Architecture shift: Google Apps Script track (started 2026-10-02)

Fernando is separately rebuilding the whole monthly process "paso a paso" as **Google Apps
Script bound directly to his Sheets** (`apps-script-automatizacion/`, numbered `.gs` files run
via the Apps Script editor's "Ejecutar" button — no Colab/BigQuery), in parallel with (and
partly superseding) the Colab notebook pipeline above. Files 1-4 were already built (with
another AI assistant, not Claude — the code style/comment format differs noticeably from this
session's): `1. VC, FDS, DO(4), CUMP, FERIADO, BLOQUEO IET.gs`, `2. SOLICITUDES DE JEFATURA.gs`,
`3. EXP RECIENTE.gs`, `4. RTI copia.gs` — these populate the real Matriz (`Matriz_Octubre_2026`,
spreadsheet `19WmwaoLDZnArNztu_dJNwi7bjrGq-_cx_gw0aN96zfk`) with non-flight activities read from
reference "Rol" files (vacations, holidays, RTI security revalidation, etc.), using a
"transfer from reference sheet to active Matriz, don't overwrite if occupied, else reassign to
a free substitute" pattern, matched by exact `YYYY-MM-DD` date keys (not raw string compare, to
dodge timezone off-by-one bugs) — same spirit as this session's date-normalization lesson in
[[feedback-qa-rigor-pairings]], arrived at independently there.

**File 5 ("buscar vuelos B767"/"B787") is what Fernando asked Claude to build**, continuing
that same numbered sequence. Confirmed scope (2026-10-02): file 5 is ONLY the tripulante
selection + transfer (Archivo 9 `PROGRAMAR=Sí` → Archivo 10), i.e. a port of
`Automatizacion_WB_Fase1_2_Demanda_Instructores.ipynb`'s demanda logic into Apps Script —
**not** the Matriz round-robin reservation and **not** the BigQuery flight-pairing search
(Fernando said he'll explain the pairing rules later; said it's "similar" to the NB pairing
work already done). Built as `5. buscar vuelos B767.gs` / `5. buscar vuelos B787.gs`
(functions `seleccionarTripulantesB767()` / `seleccionarTripulantesB787()`), matching files
1-4's self-contained style (own header-search logic duplicated per file, `SpreadsheetApp.getUi().alert()`
summary at the end, no separate preview step — direct execute, unlike the Colab notebooks'
preview-then-uncomment gate). Confirmed-same IDs/gids as the Colab WB notebooks (Archivo 9:
`1d95aUJtNVAtHd3tECTcsc2WHM8b557Jbl1DcCDsJGuo`, LCK767 gid `1437673054` / LCK787 gid
`1122326179`; Archivo 10: `1NZN565fOJUtoETQvvPzdHpRvyHp4stY2hsrqtjNjSEU`, prueba-LCK767 gid
`1025385274` / prueba-LCK787 gid `16355364`). Asymmetry confirmed by Fernando: B767 only writes
BP to column A (fila 4+); B787 writes BP (col A) **and** Nombre (col C), both from fila 4.
QA'd via a Node.js `vm`-based mock of `SpreadsheetApp`/`Sheet`/`Range` (same mock-and-execute
discipline as the Python notebooks, ported to JS) — verified header search tolerates note rows,
PROGRAMAR Si/Sí matching, stale leftover rows get cleared when the new list is shorter, and the
column-C asymmetry is respected.

### `5. buscar vuelos B767.gs` — 3 functions now (2026-10-02)

Beyond `seleccionarTripulantesB767()`, the file grew to cover the full B767 "buscar vuelos"
step:
- `armarPairingsVuelosB767()` — queries BigQuery (subfleet `763`, same WHERE/QUALIFY as the
  Colab notebook), ports `cargar_y_filtrar_wb`'s filtering rules to JS, and writes "Vuelos"
  (block-format, Instructor/Actividad as dropdowns) + "Resumen" (formula-linked) sheets into
  `1aSTyd0KUBio7DBaSwwR_8EDAVOW06Un0N2bGlE3p_FY` (confirmed destination — will eventually hold
  6 sheets: Vuelos+Resumen × B767/B787/A320). Validated against real output Fernando ran: 1071
  raw BigQuery rows → 60 valid legs → 30 complete B767 pairings, which matched what the
  filtering logic should produce.
- `asignarInstructoresPorEquidadB767()` — reads a separate **"archivo de equidad"**
  (`19eTaqRHV1zWGvg2Tga10bzQThUmXZy9Kj02M9VFX320`, gid `290322074`, columns include `BP`,
  `INST`, `HAB B767` (qualification text, matched by substring `B767` — covers both
  "Instructor B767 IDE" and "Instructor B767/B787 - IDE"), and `Q B767` (cumulative LCK count
  — the equity metric)) and assigns the lowest-`Q B767` instructor to each pairing found in
  "Vuelos", in chronological order, skipping a candidate only if they're already assigned an
  adjacent calendar day (same "no 2 días consecutivos" principle as the NB/WB Matriz
  round-robin) — confirmed directly by Fernando 2026-10-02 as the real equity rule (previously
  flagged in `[[feedback-qa-rigor-pairings]]`-adjacent notes as "neither of us has this data
  yet" — now resolved).

**Two real bugs found and fixed this session, both worth remembering:**
1. **Off-by-column-shift when porting formulas between layouts.** The NB/WB Python
   `construir_reporte_bloques` used a 13-column header row (`Flight No` at F, `Dep/Arr` at
   G/H); the Apps Script port used an 11-column layout (dropped MES/DAY → `Flight No` at E,
   `Dep/Arr` at F/G) but the ROUTE/FLIGHT TEXT FORMULAS were copy-pasted with the OLD column
   letters unchanged — silently showed "LIM" where the flight number should be. Lesson: when
   porting a formula-generating function to a different column layout, grep every hardcoded
   column letter against the new header array, don't just copy the formula strings.
2. **Apps Script performance: never call `Range.setXxx()` once per cell in a loop.** The first
   version of `escribirHojaVuelosB767_` called `getRange().setValue/setBackground/setNote/
   setDataValidation()` separately for every cell of every pairing block — for 30 pairings this
   was hundreds of individual Sheets API round-trips and left the execution looking "stuck
   loading" for 5+ minutes (it did eventually finish). Fixed by building full-size in-memory
   grids (values, backgrounds, font weights, notes, data validations) and writing each with
   exactly ONE `setValues/setBackgrounds/setFontWeights/setNotes/setDataValidations` call
   regardless of how many pairings exist — the same "load full range to memory, mutate, write
   back once" pattern already used in the pre-existing `4. RTI copia.gs`. QA'd by counting mock
   API calls in the Node harness (asserted ≤2 `setValues` calls for 3 pairings, not 3+).

### Two more corrections to `5. buscar vuelos B767.gs` (2026-10-02, same day)

1. **Equity assignment had a real availability bug.** The first version of
   `asignarInstructoresPorEquidadB767()` only avoided repeating an instructor on an *adjacent*
   day within that run's own assignments — it never checked the real Matriz, so it could
   "assign" someone who is actually on `VACACIONES`/`FDS`/`DO`/`FERIADO`/etc. that date.
   Fernando caught this by looking at his real October Matriz, where several B767 instructors
   (e.g. Fiorella Ruiz) have most of the month blocked off. Fixed by adding
   `obtenerDisponibilidadMatriz_()` / `estaDisponibleEnFecha_()`, which read the real Matriz
   (`19WmwaoLDZnArNztu_dJNwi7bjrGq-_cx_gw0aN96zfk`, tab **"Octubre 2026" gid `1006838221`** —
   note this is a *different* gid than the `580414308` one referenced earlier in this doc from
   the original NB session; Fernando's "redo it properly" rebuild appears to have restructured
   tabs, so `1006838221` is the current confirmed one) and treat a cell as available only when
   it's blank or exactly `"B"`. If literally nobody qualified is free that date (checking both
   ida and vuelta dates for multi-day MIA pairings), the pairing is now left **unassigned** and
   reported in the alert — never silently assigned to an unavailable person.
2. **New function `calcularInsAConsiderarB767()`** — the WB/B767 equivalent of NB's Y→Z/AA
   cross-check, but structurally simpler: Archivo 10 "prueba de LCK 767" already has a resolved
   **group label** (not free-text names) in column "INS FINAL 1 (NO LCK)" per tripulante (e.g.
   `"Grupo 1"`), so the function just computes the complement against the 3 known groups and
   writes the eligible members into "INFO INS A CONSIDERAR" (and a `"Grupo 2/3"`-style summary
   into the column literally named "Grupo", mirroring NB's AA). Real B767 group composition
   given directly by Fernando 2026-10-02: **Grupo 1 = Sebastian/Erika/Claudia, Grupo 2 =
   Javier/Jefferson/Jennifert/Patricia, Grupo 3 = Jazmin/Mariella/Gabriela/Karen** — he
   explicitly said he's not sure a Grupo 4 currently exists ("no veo grupo 4"), so the function
   deliberately does NOT invent a 4th group's membership: a row blocking an unrecognized group
   number excludes nobody and gets flagged in the summary alert instead, same "sin inventar
   nada" principle as everywhere else in this project.

### Third round of fixes to `5. buscar vuelos B767.gs`, same day (2026-10-02) — root-caused the 0/30 failure

Fernando ran `asignarInstructoresPorEquidadB767()` for real and got **0 of 30 pairings
assigned**, every single candidate reported as "not found in the Matriz". Root cause: **date
cells come back from `getValues()` as real JS `Date` objects, not `"dd/mm/yyyy"` text** — both
in the real Matriz's header row AND in "Vuelos"' own `FECHA REAL` column (because Sheets
auto-converts a date-shaped string to a real date value the moment `setValues()` writes it,
same class of bug as the BP-leading-apostrophe and Excel-time-format issues found earlier in
the NB/Colab work). The old parser only handled strings, so `fechasPorColumna` ended up empty
and every date comparison silently failed — explaining the 100% failure rate. Fixed by
`parsearFechaCelda_()`, which checks `instanceof Date` first (mirroring the already-working
`parsearAFechaObj` pattern in the pre-existing `4. RTI copia.gs`) before falling back to string
parsing — this single function now backs every date comparison in the file.

Three more things fixed/added in the same pass, all confirmed directly by Fernando:
1. **Fuzzy name matching** (`nombresCoinciden_`): the equity file and the Matriz don't always
   spell an instructor's name the same way (nicknames, dropped middle names, shortened first
   names — e.g. "Karen Cruz"/"Karen Santa Cruz", "Fiore"/"Fiorella Ruiz", "Jennifer"/"Jennifert
   Acurio", "Patricia Najar"/"Patricia del Pilar Najar"). Resolved generically (not a fixed
   alias table like NB's Sebas/Fio/Cris list, since these variations come from different
   source files rather than free text): normalize accents/case, tokenize into words, and match
   if every token of the shorter name is a prefix of (or contains) some token of the longer
   name. Replaces the old exact-dictionary lookup in `obtenerDisponibilidadMatriz_`.
2. **Matriz destination corrected**: the real read/write target is the spreadsheet tab named
   **"Visua_Octubre_2026"** — looked up by `getSheetByName()`, not by gid — not "Octubre 2026"
   (gid `1006838221`), which Fernando clarified is the old/manual legacy copy. "Octubre 2026"
   is no longer referenced anywhere in this file.
3. **Activity simplified to a hardcoded constant.** Fernando clarified this "Vuelos" sheet
   exists *only* to search LCK B767 flights — "Reentrenamiento"/"Chequeo"/etc. don't belong
   here — so the Actividad dropdown was removed entirely; `armarPairingsVuelosB767()` now
   writes the literal `"LCK B767"` directly into every block's activity cell.
4. **New function `subirAsignacionesAVisualB767()`** — the actual "producto final" Fernando
   wants: after equity assignment fills the Instructor column in "Vuelos", this reads the 6
   consecutive Q-column cells of each block (preRow through postRow2 — literally the exact text
   `"LCK B767\n- LIM-SCL\n- LA 2413 (12:05-15:45 hrs)\nLCK B767\n- SCL-LIM\n- LA 2412
   (17:10-21:00 hrs)"` format Fernando specified) and writes it into "Visua_Octubre_2026" at the
   assigned instructor's row × the pairing's date column(s) — both cells for a multi-day
   LIM-MIA-LIM pairing. Uses the same "load full range, mutate, write back once" batching
   pattern as the rest of the file.

Updated monthly flow for B767: `seleccionarTripulantesB767()` → `armarPairingsVuelosB767()` →
`asignarInstructoresPorEquidadB767()` → `subirAsignacionesAVisualB767()` →
`calcularInsAConsiderarB767()` (independent, runs on Archivo 10 whenever).

### Full B787 pipeline built (2026-10-02, same day), mirroring B767

Fernando confirmed the B767 visual write worked ("se pudo pegar correctamente en el visual")
and asked to build the complete B787 pipeline the same way, deferring two B767 items for later
("puedes hacerlo después"): (1) pushing "Resumen" into Archivo 10's CUADRO FINAL block (the
Colab Fase4 logic, not yet ported to Apps Script), and (2) a further reconciliation step
matching each tripulante's eligible-instructor list (`calcularInsAConsiderarB767`'s output)
against who actually got assigned which flight. Neither is built yet — tracked here so the
next session doesn't assume they exist.

`5. buscar vuelos B787.gs` now has the same 4-function pipeline as B767
(`seleccionarTripulantesB787()` → `armarPairingsVuelosB787()` → `asignarInstructoresB787()` →
`subirAsignacionesAVisualB787()`), built by **reusing the generic helpers already defined in
`5. buscar vuelos B767.gs` directly** (`cargarYFiltrarWB_`, `armarPairingsPorPk_`,
`parsearFechaHoraBQ_`, `parsearFechaCelda_`, `formatearDDMMYYYY_`, `obtenerDisponibilidadMatriz_`,
`estaDisponibleEnFecha_`, `nombresCoinciden_`, `buscarFilaPorNombreDifuso_`,
`indiceColumnaPorHeaderGenerico_`) — since both files live in the same Apps Script project they
share one global scope, so no duplication was needed for fleet-agnostic logic. Only
fleet-specific bits were duplicated (BigQuery subfleet filter `788`/`789`, cupos `6`, IDE
column `IDE B787`, activity constant `"LCK B787"`).

Two confirmed differences from B767:
- **B787 only flies the same-day LIM-SCL-LIM route** (no MIA multi-day case exists for this
  fleet) — the shared multi-cell-write code path still runs but simply never triggers the
  2-cell branch, no special-casing needed.
- **No equity file exists for B787** — Fernando explicitly said he's unsure equity even applies
  here and gave no `Q B787`-style counter source. `asignarInstructoresB787()` therefore uses
  **round-robin within the current run only** (prioritizes whoever has the fewest assignments
  *this run*, not a cross-month accumulated count) plus the same real-availability check against
  `Visua_Octubre_2026` — explicitly not the same algorithm as `asignarInstructoresPorEquidadB767`,
  flagged in the file's header comment so it's not confused for equivalent behavior. If a real
  B787 equity file shows up later, this should be upgraded to match the B767 pattern.
- **Sheet names are `"Vuelos B787"`/`"Resumen B787"`** (not bare `"Vuelos"`/`"Resumen"` like
  B767) since both fleets' sheets live in the same spreadsheet
  (`1aSTyd0KUBio7DBaSwwR_8EDAVOW06Un0N2bGlE3p_FY`, which Fernando said will eventually hold 6
  sheets total for B767/B787/A320 × Vuelos/Resumen) — B767's existing sheet names were left
  untouched since that pipeline is already tested and in active use.

QA'd end-to-end in a single Node `vm` context loading both `.gs` files together (to mirror the
real shared-scope behavior): BigQuery query correctly filters `788`/`789`, 3 mixed-subfleet
pairings assembled correctly, cupos correctly shows `6` in Resumen, round-robin visibly
alternated between 2 available instructors across 3 pairings (not always picking the same one),
and the visual-matrix write correctly placed `"LCK B787"`-prefixed text in `Visua_Octubre_2026`.

### New activity type: "Iniciales" (G9/G10 training, 2026-10-02)

A completely different, non-fleet-specific activity: `7. Iniciales.gs` (`asignarInicialesAVisual()`)
reads a plain Google Sheet (`1X3ITjRp0H_A8HHwIkq9dRZNma0f_DOQmZdeQG2oRBkE`, gid `886777284`)
that Fernando/his team fills by hand from emails — columns `DÍA` (weekday text), `DÍA` (real
date — same header repeated twice, so the date column is identified as "whatever is immediately
left of ACTIVIDAD", not by header text), `ACTIVIDAD` (e.g. `"INICIAL G9"`, `"INICIAL 10"`),
`CANTIDAD INS` (how many *distinct* instructors that activity needs that date — rows with `"-"`
are skipped, nothing to assign), plus `AULA CAE`/`COMENTARIOS`/`COORDINADOR`/`SALAS`/a free-text
note column that aren't used in the write (not asked for).

Key design choices (confirmed/inferred, flagged where inferred):
- **No fleet filter on the instructor pool** — any named row in the Matriz is a candidate,
  since "INICIAL" isn't IDE-B767/B787/A320-specific. Not explicitly confirmed; if wrong, add a
  filter keyed off the `COMENTARIOS` column (`"INST. LATAM"` vs `"IDE LATAM"`), which is
  currently read but unused.
- **Auto-detects the target month tab** (`nombreHojaVisualPara_()` builds `"Visua_<Mes>_<Año>"`
  from each row's own date) rather than hardcoding October, because the real data Fernando sent
  was for **September** 2026 — the first real evidence this pipeline needs to be month-agnostic,
  not just built for whatever month we're currently in.
- **Round-robin fairness within the run** (no equity file here either, same reasoning as B787),
  and never assigns the same person twice for the same date+activity.
- **Color-by-group**: the activity's last whitespace-separated token (`"G9"`, `"10"`, etc.)
  becomes the group key; each new group key gets the next color from a small fixed palette, so
  same-group cells always share a background color. Fernando only asked for "a purple-ish and a
  blue-ish" as examples, not exact hex values — current palette picks reasonable swatches.
- Reuses the B767 file's shared helpers (`obtenerDisponibilidadMatriz_`, `estaDisponibleEnFecha_`,
  `parsearFechaCelda_`, `indiceColumnaPorHeaderGenerico_`) directly — same global-scope strategy
  as B787 — but additionally reads/writes **backgrounds**, which those shared helpers don't
  touch, so this file loads `getBackgrounds()`/`setBackgrounds()` on the Matriz range itself.

QA'd with a Node mock asserting: September dates route to `"Visua_Septiembre_2026"` (not
October), a `CANTIDAD INS = 2` row gets exactly 2 distinct instructors, a `"-"` row is skipped
with no error, and same-activity-group cells get the identical background color while different
groups get different colors.

### "Programar" computed from vigencias instead of static (2026-10-02)

Fernando flagged that Archivo 9's `Programar` column was **stale** — manually set once and
never recomputed, while the vigencia columns (`Vig. RTI B7xx`/`Vig. LC B7xx`/`Vig. UV B7xx`)
auto-update monthly from an external index. Also corrected the Archivo 9 **gids**: the ones used
all session (`1437673054` for 767, `1122326179` for 787) point at a *static copy* tab
("Copia de 9. Programación LCK..."); the real, live tabs are **767 gid `1427213307`, 787 gid
`107709571`** (same spreadsheet `1d95aUJtNVAtHd3tECTcsc2WHM8b557Jbl1DcCDsJGuo`) — both
`seleccionarTripulantesB767()`/`B787()` were repointed to these.

New function `calcularProgramarWB_()` (shared, defined once in the B767 file, called by both
`calcularProgramarB767()` and `calcularProgramarB787()` with each fleet's own column names) —
**this is Claude's interpretation of the rule, explicitly NOT yet confirmed row-by-row by
Fernando** (he asked to see the logic used and correct it, rather than spelling it out fully
upfront — the sample "Programar" values in the real sheet are known-stale so they couldn't be
used as ground truth to reverse-engineer against). The logic implemented:
- **Sí** when `Vig. LC B7xx` (Line Check — the thing this whole pipeline schedules) is already
  past or expires in the *current real-world month* (`new Date()`, not a hardcoded month — so it
  re-derives correctly every month without code changes) **AND** `Vig. RTI B7xx` is not already
  strictly in the past.
- **No** (forced) when `Vig. RTI B7xx` is strictly expired, regardless of LC status — matches
  the sheet's own red-text label "NO PROGRAMAR A LOS QUE TENGAN REVA VENCIDA".
- `Vig. UV B7xx` is currently unused (no label on the sheet indicated its role) — flagged, not
  invented.
- Unparseable vigencia cells (e.g. `"#N/A"`) → `"No"`, counted separately in the alert, never
  silently guessed.
- Date format parsed: Spanish abbreviated month + `-` + 2-digit year (`"ago-27"`, `"sept-26"`) —
  `parsearMesAnioAbrev_()`.

QA'd against 5 synthetic cases spanning: LC expired/RTI valid → Sí; LC expiring this month → Sí;
LC still valid (future) → No; LC expired but RTI also expired → No (RTI block wins); unparseable
`"#N/A"` → No. All 5 passed, but **this whole rule needs Fernando's confirmation against real
data** before trusting it for actual scheduling — see [[feedback-qa-rigor-pairings]] note below.

Monthly flow is now: `calcularProgramarB767()` (or `B787()`) → `seleccionarTripulantesB767()` →
`armarPairingsVuelosB767()` → `asignarInstructoresPorEquidadB767()` (or `asignarInstructoresB787()`
for 787) → `subirAsignacionesAVisualB767()` (or `B787()`).

### `calcularProgramarWB_` fixed twice more, same day (2026-10-02)

First real run gave 321 of 321 rows "no determinable" — **same root cause as the Matriz dates**:
the vigencia cells (`"ago-27"`, `"feb-26"`, etc.) are real `Date` objects with a `"mmm-yy"`
display format, not plain text, so `String(valor)` never matched the text parser. Fixed by
checking `instanceof Date` first in `parsearMesAnioAbrev_`, exactly mirroring `parsearFechaCelda_`
— this is now the third time this exact class of bug (Sheets auto-typing a date-shaped value)
has bitten this project; worth treating as a standing rule going forward: **any time a cell is
read via `getValues()` and is expected to look like a date or a date-like abbreviation, assume
it may arrive as a `Date` object and check `instanceof Date` before any string parsing.**

Second fix: the real column header for RTI in Fernando's sheet renders as `"Vig. RTI B76"`
(looks like the trailing "7" is missing — truncated display or a real typo in the source sheet,
unconfirmed) which didn't match the exact string `"Vig. RTI B767"` the function searched for.
Replaced the exact-match lookup for the RTI/LC columns specifically with a new
`indiceColumnaPorHeaderContiene_()` (header must *contain* both `"VIG"` and `"RTI"`, or `"VIG"`
and `"LC"`, rather than equal the full exact string) — tolerates this and similar variations
without needing the precise header text.

### Standalone Web App for format-only pairings (2026-10-03, urgent request)

Fernando's boss asked, under time pressure, for a **separate deliverable**: an Apps Script Web
App (`doGet`/HTML form) where the user picks a month (Oct/Nov/Dec 2026) and a fleet (A320/B767/
B787), and it generates a brand-new Google Sheet (in its own Drive folder, `"Pairings Web App
(generados automáticamente)"`) with just "Vuelos" + "Resumen" — Instructor/Actividad left blank
for the boss to fill by hand. Explicitly must NOT touch any existing files/flow — new files only:
`8. Web App Pairings.gs` + `WebAppPairingsForm.html`.

Reuses the already-validated WB generic helpers (`cargarYFiltrarWB_`, `armarPairingsPorPk_`,
`parsearFechaHoraBQ_`, `formatearDDMMYYYY_`) directly via shared Apps Script scope, but needed a
**new dynamic-date-range BigQuery query** (`consultarBigQueryWBGenerico_`/`consultarBigQueryNB_`)
since the existing per-fleet query functions hardcode a fixed month — this one derives the
`BETWEEN` range from the user's month selection (1st of previous month → last day of selected
month) so Nov/Dec work without code changes.

**New NB (A320) logic in Apps Script for the first time** — previously NB automation only
existed in Python (`generar_candidatos_nb.py`/`generar_reporte_pairings_nb.py`) and the Colab
notebooks; ported faithfully: candidate "primera mitad" filtering (2.9-2.14 rules), the
real/filtered `dia_duty` minimum distinction (avoids the historical bug where a filtered-out
real day-1 got mistaken for day 1), and `parearCandidatosNB_` (greedy same-day 2-pairing
combination within the 50min-1h30 connection window). Also added the **"Posible 2do vuelo"**
column Fernando asked to see explicitly this time (it already existed as a column in
`generar_candidatos_nb.py`'s output, just hadn't been surfaced in any Apps Script deliverable
yet) — for every candidate, lists every OTHER same-day candidate whose connection window would
also fit, not just the one the greedy algorithm happened to pick, so the boss can verify/rework
the pairing by hand.

**Corrected a conflation while building this**: initially ported NB's resumen using the OLD
WB single-sheet "embedded R-Z resumen columns" pattern (from `generar_reporte_pairings.py`,
the pre-per-pairing-block WB script) — rechecking `generar_reporte_pairings_nb.py` directly
showed NB's real "Resumen Final" is a **separate sheet** referencing the main grid's B/C/D/E/
F/G/J/M/O columns directly, with no embedded block. Fixed before shipping.

**AQP exclusion**: carried forward as confirmed for October only; Nov/Dec default to including
AQP in the NB valid-route whitelist since that exclusion was never confirmed for those months
(see `EXCLUSIONES_POR_MES_NB_` — one line to edit if Fernando confirms it should continue).

QA'd end-to-end in Node (both NB and the new WB wrapper): a 3-candidate, 1-invalid-route
same-day NB scenario correctly produced 2 blocks (A+B combined via the connection window, C
standalone), "Posible 2do vuelo" correctly showed only the genuinely-compatible alternate, the
invalid-route trip's outbound leg was correctly dropped while its inbound leg legitimately
survived the per-leg filter (matching the original Python's leg-level, not trip-level, route
check) and then got excluded for real at the "needs 2 legs" stage; the WB wrapper's dynamic
date range correctly produced `2026-10-01`..`2026-11-30` when asked for November.

Not yet deployed/verified against real BigQuery or real Drive — Fernando needs to paste both
files into an Apps Script project, add `WebAppPairingsForm.html` as an HTML-type file with that
exact name, and deploy via Implementación > Nueva implementación > Aplicación web.

### Web App extended + rules doc written (2026-10-03, same thread)

Two follow-ups to the urgent Web App request above, both completed:
1. Fixed a real deploy bug: Fernando deployed `8. Web App Pairings.gs` into a *different* Apps
   Script project than the one holding `5. buscar vuelos B767/B787.gs`, so the shared helpers
   (`cargarYFiltrarWB_`, `armarPairingsPorPk_`, `parsearFechaHoraBQ_`, `formatearDDMMYYYY_`,
   `DIAS_SEMANA_ES_`) weren't in scope → `ReferenceError`. Fixed by inlining copies of those
   5 definitions directly into `8. Web App Pairings.gs`, making it fully standalone/portable
   regardless of which project it's deployed into (verified in Node by loading *only* that one
   file). Also hit (and fixed, documented in that file's history) a missing BigQuery OAuth
   scope — `appsscript.json` needs an explicit `oauthScopes` array
   (`bigquery`/`spreadsheets`/`drive`) even with the BigQuery advanced service enabled, since
   Apps Script's scope auto-detection didn't pick it up; re-authorizing via "Ejecutar" on any
   function in the editor after updating the manifest fixed it.
2. Added two more sheets per Fernando's request: **"Candidatos"** (flat list of every valid
   pairing — for NB, the same shape as `generar_candidatos_nb.py`'s "Candidatos_validos" output,
   with formatted Conexión/PSV and the alternates column; for WB, one row per full pairing) and,
   NB-only, **"Excluidos"** (every rejected trip + its exact reason, ported 1:1 from that
   script's exclusion messages — `armarPrimerasMitadesNB_` now returns `{validos, excluidos}`
   instead of just the valid list). WB doesn't get an Excluidos sheet since its filter is
   leg-level, not trip-level with a tracked reason — flagged as addable later if wanted, not
   invented now.

Also wrote **`docs/Reglas_Filtrado_Pairings_WebApp.md`** — a comprehensive, Fernando-readable
explainer of every filtering rule for both fleets (requested directly: "quiero que... me des
paso a paso el resumen... qué filtras, qué no filtras... todas las reglas"), including a direct
NB-vs-WB comparison table answering his specific questions (weekday filtering, max pairing
duration, 1-vs-2-pairings-per-block, hour/HBT/PSV thresholds). Notable finding surfaced while
writing it: **NB has no day-of-week filter at the candidate level** (Sat/Sun pairings aren't
excluded here — the "prefer Thu/Fri" guidance only applies later, at Matriz slot assignment),
which is a real, confirmed asymmetry with WB (which does exclude Sat/Sun per-leg) — worth
remembering since it's easy to assume both fleets behave the same way.

QA'd the two new sheets in Node: NB's Candidatos/Excluidos correctly separated a 2-pairing
combinable block from two synthetically-broken trips (short HBT, single-leg day) with the exact
expected rejection reasons, Conexión/PSV rendered as "h:mm" text (not raw milliseconds or
`undefined`); WB's Candidatos correctly listed one full pairing per row.

### Live preview added to the Web App (2026-10-03)

Fernando showed an internal LATAM BI tool (filters → live result table on the same page) and
asked for something similar: filter first, see the candidate list right there, *then* decide to
generate the file. Didn't try to replicate that tool's full filter set (Filial/Llave
carga/Fecha carga/service_type/etc. — those are BigQuery load-tracking metadata the existing
`QUALIFY` clause already resolves automatically by always picking the latest load, so exposing
them wouldn't add real value here) — instead added a **"Vista previa"** button alongside
"Generar Sheet" in the same form.

Refactored `generarNB_`/`generarWBGenerico_` to split candidate computation from sheet-writing:
new `calcularCandidatosNB_()`/`calcularCandidatosWB_()` return the same `{validos, excluidos}`/
`{pairingsPorPk}` shapes without touching any Spreadsheet, and both the preview and the real
generator call them. New `previsualizarPairingsWebApp(mes, flota)` returns a plain
`{flota, columnas, filas, excluidosCount}` object (JSON-safe, no Date objects) that the HTML
renders as an in-page scrollable table — no new Sheet/Drive file created for a preview, only
when "Generar Sheet" is explicitly pressed. QA'd in Node: preview returns the right shape and
row count without ever calling `SpreadsheetApp`/`DriveApp`.

### Corrected: "vista previa" meant raw data browse, not filtered candidates (2026-10-03)

Fernando clarified (after seeing the candidatos-only preview) that what he actually wanted,
based on the reference BI tool, was a **raw, unfiltered data browser** with simple checkbox
filters (Subflota, Tipo de carga) showing the FULL row count (he gave concrete numbers: 665 WB
rows total, narrowing to 130 when checking only subflota 787/788/789) — not the already-LCK-
rule-filtered candidate list. These are two genuinely different views and both now exist side
by side in the Web App:
- **"Vista previa (candidatos)"** — unchanged, still the LCK-business-rule-filtered list.
- **"Base de datos original"** (new) — `previsualizarBaseDatosOriginal(mes, subflotas[],
  tiposCarga[])` / `consultarBaseDatosOriginal_()`: a plain BigQuery query with NO LCK filtering
  at all (no route/HBT/PSV/connection/day-of-week checks) — only `subsidiary_code='LP'` (hardcoded,
  matching every other query in this project) + checkbox-selected `subfleet_code` + checkbox-
  selected `load_type_code`, same latest-load `QUALIFY` as everywhere else. Rendered via
  multi-select checkboxes (with "marcar todas"/"desmarcar todas" links) for Subflota
  (319/320/321/330/763/773/788/789) and Tipo de carga (FP/ES), reusing the same Mes dropdown.

QA'd in Node: confirmed the query correctly includes only the checked subflotas/tipos in its
`IN (...)` clauses, returns ALL matching rows with no business-rule filtering applied, and
throws a clear error if either checkbox group is left fully unchecked (client-side JS also
blocks the call before hitting the server, for immediate feedback).

## Web App unified flow + real "Flota" facet filter (2026-10-03)

Replaced the single Flota `<select>` dropdown with a unified panel (Mes → Filial → Flota →
Subflota → Tipo de carga checkboxes) and 3 progressive buttons (Ver vista previa → Generar
candidatos → Generar Google Sheet), all in `8. Web App Pairings.gs` +
`WebAppPairingsForm.html`. Server: `identificarGruposFlota_(subflotas)` maps the Subflota
checkbox selection to NB/B767/B787 rule-groups; `previsualizarCandidatosDesdeFiltros` and
`generarPairingsDesdeFiltros` replaced the old single-flota `previsualizarPairingsWebApp`/
`generarPairingsWebApp` (deleted) and combine/generate across every recognized fleet-group in
one go (one new Spreadsheet, `"Vuelos <clave>"`/`"Resumen <clave>"`/`"Candidatos <clave>"` +
`"Excluidos <clave>"` for NB, per group).

**Bug found right after, by Fernando comparing against the reference BI tool**: "Flota" and
"Subflota" are TWO INDEPENDENT real BigQuery columns (`fleet_type_code` vs `subfleet_code`),
not one derived from the other — the reference tool showed Flota=NB + Subflota=788/789 → 12
registros (a real, if "weird", intersection), while this Web App was ignoring Flota entirely
and showing 270 (all rows for Subflota 788/789 regardless of Flota). Fixed by:
- Exposing `fleet_type_code AS flota` as a REAL filter column everywhere (`consultarBaseDatosOriginal_`,
  `consultarBigQueryNB_`, `consultarBigQueryWBGenerico_`), applied as `AND fleet_type_code IN (...)`
  in AND with Subflota/Filial/Tipo de carga — threaded as a new `flotas` param through
  `calcularCandidatosNB_`/`calcularCandidatosWB_`/`generarNB_`/`generarWBGenerico_`/
  `previsualizarCandidatosDesdeFiltros`/`generarPairingsDesdeFiltros`. `FLOTAS_DISPONIBLES_ =
  ["NB","WB","E02","B787","B767"]` (the real values from the reference tool's Flota dropdown).
- New `obtenerRegistrosCrudosMes(mesStr)` / `consultarBaseDatosCrudaMesCompleto_`: fetches the
  ENTIRE month ONE time (only date range + `crew_range_type_code='SAB'`, no other filter) so the
  client can do true Looker-style faceted cross-filtering without hitting BigQuery again on every
  checkbox click.
- `WebAppPairingsForm.html` rewritten: "Ver vista previa" now does that one full-month fetch;
  after that, toggling any Filial/Flota/Subflota/Tipo-de-carga checkbox recomputes (client-side,
  in `recalcularFacetas()`) which OTHER checkboxes still have ≥1 matching record given what's
  currently checked in the other 3 dimensions — shows a live `(count)` next to each option, hides
  (and auto-unchecks) options that would yield 0 — and re-renders the live-filtered table
  instantly, matching the "si seleccionas uno y no existe en otro filtro se desaparece" behavior
  Fernando described from the reference tool. Also fixed a pre-existing latent bug noticed while
  touching `generarNB_`: it never forwarded the group's `subflotasNB` into `calcularCandidatosNB_`
  (always silently defaulted to `['319','320']`) — now passed through correctly.

QA'd in Node (`vm` + mocked `BigQuery.Jobs.query` capturing the generated SQL text): confirmed
`previsualizarBaseDatosOriginal` only adds the `fleet_type_code IN (...)` clause when `flotas` is
passed and non-empty, and both `previsualizarCandidatosDesdeFiltros`/`generarPairingsDesdeFiltros`
correctly thread `flotas` into the NB and WB queries respectively.

## Facet "Ver vista previa" crashed with OOM — moved aggregation into BigQuery (2026-10-03, same day)

`obtenerRegistrosCrudosMes()` (the full-month-no-filter download for client-side faceting,
described just above) **crashed in production**: Fernando's real run failed after 85s with
"Error provocado por memoria insuficiente". Root cause: `crew_range_type_code='SAB'` + date
range with NO subsidiary/subfleet/fleet filter at all pulls the ENTIRE airline's crew-pairing
leg data (all 6 filiales × every subfleet) for 2 months — tens/hundreds of thousands of rows —
into Apps Script's V8 heap, which cannot hold that (and `ejecutarQueryBigQuery_`'s pagination
loop uses `.concat()` per page, making it worse). "Download once, filter client-side" does not
scale against this table; deleted `obtenerRegistrosCrudosMes`/`consultarBaseDatosCrudaMesCompleto_`
entirely (also deleted the now-dead `previsualizarBaseDatosOriginal`/`consultarBaseDatosOriginal_`
that `obtenerRegistrosCrudosMes` was replacing in the UI anyway).

Replaced with **server-side aggregation**: new `obtenerFacetasYVistaPrevia(mesStr, filiales,
flotas, subflotas, tiposCarga)` / `consultarFacetasYVistaPrevia_()` in `8. Web App Pairings.gs`.
One BigQuery call does the faceting — 4 `UNION ALL` branches (one per dimension: filial/flota/
subflota/tipoCarga), each `GROUP BY` its own column while filtering by the OTHER 3 dimensions'
*current* selections (never its own) — returning only ~20-30 aggregate rows regardless of table
size, since the counting happens inside BigQuery, not in Apps Script memory. A second query
returns the live-filtered preview, capped at `LIMIT 300`, with the TRUE total carried via
`COUNT(*) OVER()` (a window function, evaluated before `LIMIT` in BigQuery's semantics, so the
total reflects every matching row even though only 300 are returned). Both queries share a
`QUALIFY_ULTIMA_CARGA_SQL_` constant (new) for the latest-load dedup, and a `WITH deduped AS (...)`
CTE computed once per call.

`WebAppPairingsForm.html` changed from "fetch once, filter in JS" to "every checkbox change
calls `obtenerFacetasYVistaPrevia` again" (a real BigQuery round-trip per click, a few seconds —
this *is* how Looker/real faceted-search tools actually work against big tables, not a step
back). Added `requestIdFacetas` (monotonic counter) so a stale response arriving after the user
already clicked something else is discarded instead of overwriting newer state.

QA'd in Node (`vm` + mocked `BigQuery.Jobs.query`): confirmed the facet query for each dimension
excludes its own filter but includes the other 3, confirmed the preview query has `LIMIT 300`
and `COUNT(*) OVER()`, and confirmed the `.gs`/inline-`<script>` both parse cleanly
(`node --check`).

## Filter options must come from real DB values, not hand-typed lists; "Tipo de carga" removed as a filter (2026-10-03, same day)

Fernando compared the Web App against the reference BI tool side by side (screenshots showing
its real "Flota" checkbox list and the official `fleet_type_code` column description he pasted:
`description: "Indica la flota... Puede tomar valores como: NB, B787."`) and caught that my
hand-typed `FLOTAS_DISPONIBLES_ = ["NB","WB","E02","B787","B767"]` was wrong — **"E02" is
actually a `subfleet_code` (Sub flota) value, not a `fleet_type_code` (Flota) value**; I had
guessed it into the wrong dimension. His instruction: "no quiero que... pongas NB o WB de
acuerdo a lo que yo te estoy diciendo, pon de acuerdo a lo que está en la base de datos" — stop
hand-typing filter option lists, always derive them from what's actually distinct in the table.

Fixed in `8. Web App Pairings.gs` + `WebAppPairingsForm.html`: deleted the hardcoded
`FILIALES_DISPONIBLES_`/`SUBFLOTAS_DISPONIBLES_`/`FLOTAS_DISPONIBLES_` constants entirely. The
HTML now calls `obtenerFacetasYVistaPrevia(mes, [], [], [])` (all 3 filters empty) on page load
and on every Mes change — the unfiltered facet counts ARE the real distinct value lists per
dimension — and builds the Filial/Flota/Sub flota checkboxes dynamically from that response
(`cargarOpcionesDeFiltro()`), instead of static `<label>` markup. "LP" is pre-checked by default
only if it's actually among the real returned Filial values (never assumed).

Same conversation, second instruction: "el tipo de cargas que sea solamente FP... quita el tipo
de carga... esto tiene que estar siempre buscar el FP" — removed "Tipo de carga" as a
selectable filter entirely (UI checkboxes gone, `tiposCarga` parameter removed from every
function in the file: `obtenerFacetasYVistaPrevia`, `consultarFacetasYVistaPrevia_`,
`calcularCandidatosNB_`/`WB_`, `generarNB_`/`WBGenerico_`, `consultarBigQueryNB_`/
`WBGenerico_`, `previsualizarCandidatosDesdeFiltros`, `generarPairingsDesdeFiltros`) along with
the `AND load_type_code IN (...)` WHERE clause that selectability added. Deliberately did NOT
touch the underlying `QUALIFY_ULTIMA_CARGA_SQL_` dedup logic (latest load, FP preferred, ES only
as fallback when no FP exists for that partition) — that already *is* "siempre buscar el FP",
and removing the ES fallback entirely would risk silently dropping months/subsidiaries where
only an ES load has landed so far, which Fernando did not ask for.

QA'd in Node (`vm` + mocked `BigQuery.Jobs.query`): confirmed `obtenerFacetasYVistaPrevia`'s
facet result has only `{filial, flota, subflota}` keys (no `tipoCarga`), confirmed its
UNION-ALL query has exactly 3 branches and never mentions `load_type_code`, confirmed the NB and
WB candidate queries no longer add a `load_type_code IN (...)` clause while still carrying the
`load_type_code = 'FP'` QUALIFY preference, and confirmed `generarPairingsDesdeFiltros` still
works end-to-end with the new 4-argument signature. `node --check` clean on both the `.gs` file
and the extracted inline `<script>`.

## Bug: Flota filter silently zeroed out WB candidates when Subflota spans multiple fleets (2026-10-04)

Fernando checked Flota=NB only, but Sub flota had all 5 real values checked (319/320/763/788/789
— likely via "Marcar todas", since 763/788/789 DO have a handful of genuinely real matching rows
under flota=NB too, ~3-4 each — confirmed by him in the prior message, not invented noise).
Result: "Generar candidatos" came back with 0 total, "81 excluido(s) (NB)" and nothing from the
B767/B787 groups, with no explanation of why WB came back empty.

Root cause: `flotas` (the Flota checkbox selection) had been threaded all the way into
`previsualizarCandidatosDesdeFiltros`/`generarPairingsDesdeFiltros` and from there into EVERY
rule-group's BigQuery query uniformly — `calcularCandidatosNB_`/`WB_`, `generarNB_`/
`WBGenerico_`, `consultarBigQueryNB_`/`WBGenerico_`. Routing to NB/B767/B787 is driven 100% by
which *Subflotas* are checked (`identificarGruposFlota_`, unaffected by Flota). But the SAME
`flotas=['NB']` filter then got applied to the B767/B787 groups' queries too — i.e. "subfleet_code
IN ('763') AND fleet_type_code IN ('NB')" — and real B767 flights overwhelmingly have
`fleet_type_code='WB'`, not `'NB'`, so that query returned (near-)zero rows every time, silently,
with no distinguishing error message. This is a direct consequence of Flota and Subflota being
genuinely independent real columns (see the facet-filter work above) — mixing them into one
filter across unrelated rule-groups was never going to work.

Fix: removed `flotas` entirely from the candidate-generation/generate-sheet pipeline — it now
stays ONLY in `obtenerFacetasYVistaPrevia`/`consultarFacetasYVistaPrevia_` (raw "Ver vista
previa" browsing, where it's a real independent cross-filter against Subflota, exactly as
designed). `previsualizarCandidatosDesdeFiltros(mesStr, filiales, subflotas)` and
`generarPairingsDesdeFiltros(mesStr, filiales, subflotas)` are back to 3 params; which
rule-group runs is determined ONLY by Subflota, same as the original design before Flota got
over-extended into this stage. Also clarified in the HTML's intro text that Flota only matters
for step 1, not steps 2/3.

Separately confirmed (not a bug) that the 10,822-leg "NB" preview total Fernando flagged as
suspicious *was* already correctly filtered to Filial=LP — it's a LEG-level count across the
2-month preview window (not pairing/candidate-level), and its own checkbox counts summed exactly
to it (2400+8412+4+3+3=10822), proving the filter was working; it's just a fundamentally
different, much larger number than "LCK candidates after business rules" (10822 raw legs vs. 81
NB trips evaluated vs. 0 that passed every rule) — these are three different stages, not a
contradiction. Whether 0 valid NB candidates for Nov-2026/LP is itself expected needs Fernando to
check the "Excluidos NB" sheet (only visible after actually generating the Sheet, step 3) — the
`previsualizarCandidatosDesdeFiltros` preview only surfaces an aggregate excluded-count, not the
per-trip reasons.

QA'd in Node (`vm` + mocked `BigQuery.Jobs.query`): reproduced Fernando's exact filter
combination (subflotas 319/320/763/788/789, no flota threaded) and confirmed the B767 WB query no
longer carries any `fleet_type_code IN (...)` clause and correctly returns a synthetic matching
candidate; confirmed both `previsualizarCandidatosDesdeFiltros` and `generarPairingsDesdeFiltros`
are back to arity 3. `node --check` clean on both files.

**Open question for next session**: whether the Freeze destination found 2026-09-24
(`Matriz_Octubre_2026` tabs "LCK 767" gid `1188477249` / "LCK 787" gid `1779651341`, roster
A1:G1 `BP/CAT/Nombre/Estado/Vigencia/Comentario/Grupo`, alt CUADRO FINAL table at `L5`) and the
still-unresolved WB group-definition cells / "INS FINAL"-equivalent column should now also be
built as Apps Script instead of the Colab `Automatizacion_WB_Fase4_Consolidacion.ipynb` — not
asked yet, follow Fernando's lead the same way file 5 was clarified before building.

## Older BigQuery migration notes (2026-09-22/23, still relevant)

`crew_pairing_carmen_system` field mapping and the `dia_duty`/`bandera_ultima_carga`/`presentacion_duty_date_lt` findings are unchanged — see [[reference-pairings-manual]] for the full table. `pairing_id` reuse across unrelated pairings (needed a synthetic instance key via `dia_duty` regression detection) is also unchanged and is copied into every Colab notebook that touches NB bloques.

**Open/unconfirmed items still worth re-checking periodically:**
- `EXCLUSIONES_MES = {"AQP"}` (Perumín) — Fernando confirmed it *also* applies in October 2026, but this is a month-by-month judgment call, not a fixed rule — re-verify every month.
- `presentacion_duty_date_lt` → `duty_presentation_date_at` (WB script only) — still unverified.
- Fase 5 Freeze automation only covers the roster+CUADRO-FINAL-alterna write; conciliación cupos-vs-demanda, priorización por vencimiento, envío a Karina, and the Diana handoff on flight cancellations are explicitly still manual (no formal enough rules in the source doc to automate without inventing criteria).
