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

## Older BigQuery migration notes (2026-09-22/23, still relevant)

`crew_pairing_carmen_system` field mapping and the `dia_duty`/`bandera_ultima_carga`/`presentacion_duty_date_lt` findings are unchanged — see [[reference-pairings-manual]] for the full table. `pairing_id` reuse across unrelated pairings (needed a synthetic instance key via `dia_duty` regression detection) is also unchanged and is copied into every Colab notebook that touches NB bloques.

**Open/unconfirmed items still worth re-checking periodically:**
- `EXCLUSIONES_MES = {"AQP"}` (Perumín) — Fernando confirmed it *also* applies in October 2026, but this is a month-by-month judgment call, not a fixed rule — re-verify every month.
- `presentacion_duty_date_lt` → `duty_presentation_date_at` (WB script only) — still unverified.
- Fase 5 Freeze automation only covers the roster+CUADRO-FINAL-alterna write; conciliación cupos-vs-demanda, priorización por vencimiento, envío a Karina, and the Diana handoff on flight cancellations are explicitly still manual (no formal enough rules in the source doc to automate without inventing criteria).
