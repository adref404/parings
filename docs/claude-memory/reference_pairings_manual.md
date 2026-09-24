---
name: reference-pairings-manual
description: Where the business rules for the LATAM pairings/Freeze automation come from
metadata: 
  node_type: memory
  type: reference
  originSessionId: ac08facc-2c51-4558-85a4-59dc0ce883ad
  modified: 2026-09-24T00:00:00.000Z
---

The authoritative source for Line Check (LCK) scheduling rules is **"Manual Traspaso FREEZE LP.docx"** in the project root — specifically "Parte 2. Line Check A320" (sections 2.1 through 2.21), which documents the full manual process from determining who needs a Line Check through building the Pairings NB/WB files and loading the Freeze.

It's a .docx (binary) — the Read tool can't open it directly; extract text via `python3 -c "import zipfile,re,html; ..."` reading `word/document.xml` and stripping tags (works without python-docx, which isn't installed).

Some rule details are NOT in this manual and came from other sources during the conversation — track these separately since they might need periodic reconfirmation:
- The exact NB valid-destination list (AQP/CIX/CJA/CUZ/IQT/PCL/PEM/PIU/TPP) came from a training video Fernando has access to, and overrides the manual's own stated exclusion list (which would exclude IQT and include TCQ/TYL/TBP).
- WB's exact flight numbers (2480/2481/2695/2694/2698/2699 for MIA, 2413/2412 for B767-SCL, 2697/2696 for B787-SCL) were reverse-engineered against a real reference roster file, then partly confirmed by a LATAM contact (Antonella Cotrina) via chat screenshot for the B787 flights.
- The Instructores catalog (name/BP/legal-name, 21-22 people) was given directly by Fernando, not derived from any file.
- **Instructor-group assignments (Grupo 1/2/3/4) are NOT fixed** — despite being documented once in the flowchart video (Grupo 1: Fio-Sebas-Cris, etc.), Fernando confirmed mid-project the real composition already changed and is not reliable as a hardcoded constant. As of 2026-09-24 the groups live in 4 editable cells in Archivo 10 ("LCK 320" sheet, `AD2`/`AE2`/`AF2`/`AG2`, comma-separated names) that Fernando maintains by hand each month — any automation must read them live, never hardcode a snapshot. See [[project-pairings-overview]] for how the notebooks consume this.

See [[project-pairings-overview]] for how these feed into the scripts.

## BigQuery field mapping (crew_pairing_carmen_system) — confirmed 2026-09-22

The CSV column `dia_duty` (used throughout the WB/NB scripts for the "pairing partido" logic, since it's expected to SKIP numbers when there's a rest day) maps to BigQuery's **`duty_calendar_day_number`**, NOT `duty_day_number`. The CSV column `duty` (sequential, never skips) maps to `duty_day_number`.

Confirmed three independent ways: (1) empirical query on a real multi-day pairing showing `duty_calendar_day_number` jumping 1→4 across a 3-day calendar gap while `duty_day_number` only went 1→2; (2) a same-day snapshot of ~50 different pairings where `duty_calendar_day_number` was ≥ `duty_day_number` in every single row (consistent with calendar days elapsed ≥ duty periods completed); (3) direct confirmation from Ignacio Pinto Rojas (LATAM) with a worked example: a 3-duty pairing Oct 11→15 gives duty/dia_duty pairs 1/1, 2/3, 3/5.

Also confirmed by Ignacio: **`bandera_ultima_carga` does not exist in `crew_pairing_carmen_system`** — it's computed in a separate table `so-cm-opanalytics-dev.Performance_VOM.bbdd_pairing`, partitioned by Tipo de carga + Filial + Flota + TM/SAB + Mes + Año. Check whether that table also has the flight-level detail needed before recreating the flag logic by hand on `crew_pairing_carmen_system`.

Full raw→working column mapping for the NB/WB scripts (source: `operations-data-prod.carmen_gold.crew_pairing_carmen_system`):

| Script column | BigQuery field |
|---|---|
| trip | pairing_id |
| dia_duty | duty_calendar_day_number |
| fecha_inicio_trip | pairing_start_date |
| inicio_vuelo_lt | flight_start_date_local_time |
| vuelo | flight_number |
| dep | departure_airport_code |
| arr | arrival_airport_code |
| std_hb | flight_departure_time_crew_base |
| sta_hb | flight_arrival_hour_block_time |
| hbt | flight_block_time |
| sub_fleet | subfleet_code |
| mes | flight_month_description |
| pax | is_crew_passenger |
| presentacion_duty_date_lt | ⚠️ no exact match found yet — closest candidate `duty_presentation_date_at`, unconfirmed |

Also: `pairing_id` alone is NOT a unique/stable key across the full history (same id reused for many unrelated pairings across years) — always pair it with a date filter (or `pairing_start_date`) when querying a specific pairing instance, matching the `_pk` = trip+fecha_inicio_trip composite key already used in the WB script.

