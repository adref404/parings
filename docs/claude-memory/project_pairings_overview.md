---
name: project-pairings-overview
description: "What the LATAM/parings project is, its current state, and the key scripts/files (as of 2026-09-22)"
metadata: 
  node_type: memory
  type: project
  originSessionId: ac08facc-2c51-4558-85a4-59dc0ce883ad
  modified: 2026-09-23T12:08:58.209Z
---

Fernando works on LATAM Airlines crew-training scheduling ("Freeze" process): assigning instructor Line Checks (LCK) to specific flights, for both WB (wide body: B767 MIA/SCL routes, B787 SCL route) and NB (narrow body: A320/A319 domestic routes) fleets.

**Why:** The manual process (described in "Manual Traspaso FREEZE LP.docx") takes a person ~1-1.5 days per month: manually searching a downloaded pairings CSV for valid instructor-day flight combinations under a long list of business rules (connection windows, HBT minimums, PSV maximums, route exclusions, "pairing partido" logic, no-repeat rules, etc). Fernando is automating this with Python scripts that read the CSV export and produce ready-to-fill Excel workbooks.

**How to apply:** Treat "Manual Traspaso FREEZE LP.docx" (Parte 2. Line Check A320) as the authoritative source for business rules — prefer it over inference from data whenever they conflict, but note some numeric thresholds (esp. for WB flight numbers/routes) aren't in the manual and were reverse-engineered from a reference file or confirmed by Fernando directly (e.g. exact NB destination list AQP/CIX/CJA/CUZ/IQT/PCL/PEM/PIU/TPP came from a training video, not the manual text, and supersedes the manual's stated exclusion list).

**Key scripts (as of last session, 2026-09-18/19):**
- `generar_candidatos_nb.py` — loads/depures the NB CSV, filters by month+route+hour rules, builds "primera mitad" candidates (2-leg same-day round trips) per pairing (2.9-2.14 of the manual).
- `generar_reporte_pairings_nb.py` — imports from the above; pairs 2 candidates into a 4-row "instructor day" block (2.15 connection rule between pairings), builds the block-style Excel (Pairings NB / Instructores / Resumen Final sheets).
- `generar_pairings_nb_v4.py` (newest, added 2026-09-18/19, NOT reviewed by me yet in this session) — imports from `generar_reporte_pairings_nb.py`; goes further and AUTO-ASSIGNS instructor+activity+crew per block using instructor groups and a reva-conflict rule. **Its own docstring flags that the crew/reva-history data is 100% FICTITIOUS (CREW_SIMULADO, placeholder names)** because the real roster/reva-history file was never provided as data (only seen in screenshots) — must be swapped for the real file before any production use.
- `generar_reporte_pairings.py` — the WB equivalent (B767/B787), built earlier; produces block-style Excel with instructor/activity dropdowns and a formula-driven resumen.
- `json_a_excel.py` — unrelated one-off: converts a BigQuery-profile-style JSON export into a multi-sheet Excel.

**Data files:** CSVs named `Panel pairing_Base reporte pairing_Tabla*.csv` are raw exports from the "Panel pairing" Looker Studio panel (different numbered exports = different months/fleets pulled at different times — always check which one a script's `SRC` points to before trusting output). Outputs are named `Pairings_NB_<MES>_<AÑO>*.xlsx` / `Reporte_pairings_WB_*.xlsx`.

**QA discipline established on this project:** [[feedback-qa-rigor-pairings]] — multiple real bugs were found only by actually re-deriving expected values in Python and cross-checking against the generated Excel, not by eyeballing structure. Always do this before telling Fernando something is "correct."

## Latest status (2026-09-23)

Fernando got direct BigQuery query access to the true source table (`operations-data-prod.carmen_gold.crew_pairing_carmen_system`), replacing the manual "download CSV from Looker Studio panel" step. See [[reference-pairings-manual]] for the full column mapping and the confirmed `dia_duty = duty_calendar_day_number` finding.

- Built and validated 2 working "sub-final" SQL queries (NB and WB) against that table, with correct column aliases matching what the existing Python scripts already expect — so switching the CSV source requires zero code changes, just point `SRC` at the new export.
- Real gotcha hit and fixed: `carrier_code` only holds real airline codes (LA/4C/4M) — `subsidiary_code` is the field for filial codes (LP/4C/XL, "región andina"). Filtering `carrier_code IN ('LP','4C','XL')` silently returned 0 rows.
- `bandera_ultima_carga` (which load is the most recent, per Tipo de carga + Filial + Flota + TM/SAB + Mes + Año) doesn't exist as a column on this table — Ignacio Pinto Rojas (LATAM) confirmed it's computed in a separate table `so-cm-opanalytics-dev.Performance_VOM.bbdd_pairing`. Currently replicating the CASE-window logic by hand on `crew_pairing_carmen_system` (via `ingestion_datetime`, unconfirmed equivalence to whatever "load_date" means in his table) — worth periodically checking whether `bbdd_pairing` alone could replace this entirely.
- `presentacion_duty_date_lt` (used by the WB script to exclude Sunday-presentation pairings) still has no confirmed BigQuery equivalent — currently guessing `duty_presentation_date_at`, unverified.

**Constraint that shapes the next automation step:** Fernando can only query BigQuery through the work environment (no local Python→BigQuery connection, no service account access from his own machine). He *can* already pull BigQuery via Apps Script (proven working, tied to a billing project). Agreed direction: **Google Colab**, not Apps Script, for the next automation step — Colab can authenticate as Fernando's own Google identity (`google.colab.auth.authenticate_user()`), inheriting his existing BigQuery query permission, while still running the *same already-QA'd Python scripts* almost unchanged (only the `pd.read_csv(SRC)` line becomes a BigQuery query). Rewriting the business logic into Apps Script was explicitly rejected as too risky (would re-litigate already-fixed bugs in a new language) unless a future need specifically requires zero-Python (e.g. a button for a non-technical colleague).

**Immediate next step (as of last message):** Fernando is downloading the 2 sub-final query results as CSV by hand to keep working with the existing pipeline meanwhile; building the Colab notebook version is the deferred follow-up.

