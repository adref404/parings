---
name: feedback-qa-rigor-pairings
description: "Fernando expects real QA (recompute-and-compare), not just structural review, before confirming an Excel/Sheets deliverable is correct"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: ac08facc-2c51-4558-85a4-59dc0ce883ad
  modified: 2026-09-24T00:00:00.000Z
---

When Fernando asks "is this correct / did you QA it?", he means: did you independently recompute the expected values (in Python) and cross-check them against every row of the generated file — not just "does the structure look right."

**Why:** Across the WB and NB pairing scripts, doing this repeatedly surfaced real bugs that pure structural/spot-check review missed, e.g.:
- Trip-number reuse across unrelated pairings in one CSV export (same "trip" id, different fecha_inicio_trip) silently merging two different pairings into one block.
- A triangular route (LIM→AQP→CUZ→LIM) where the middle leg got filtered out, leaving a fake "ida/vuelta" pair whose cities didn't actually match.
- A connection-time Excel formula that went negative when the return leg departed after midnight (needed a `+(H<I)` day-rollover term).
- A "PSV ≤ 11h" check that was only validated per individual pairing, not for the combined 2-pairing instructor-day block.
- A "day 1 of pairing" selection that used the minimum `dia_duty` of the *already-filtered* data, which could actually be day 2 or 3 of the real pairing if day 1 got filtered out by month/route — violating the manual's "instructor only covers day 1" rule.

**How to apply:** Before saying an Excel/data deliverable is correct in this project (or similar rules-heavy data-transformation work), always: (1) run an independent Python recomputation of key derived fields against the actual generated file, (2) check for duplicates/uniqueness where uniqueness is claimed, (3) explicitly separate "documented in the manual" rules from "inferred from data" or "confirmed via screenshot/video" rules when reporting back, and (4) report exact counts of what passed/failed rather than a blanket "looks good."

Also: prefer the official manual text over prior inference when they conflict, but note explicitly when a rule came from elsewhere (a video, a pasted screenshot, Fernando's own correction) since those aren't in the written source of truth and might need re-confirming later. See [[project-pairings-overview]].

## Extended in the Colab/BigQuery automation session (2026-09-23/24)

Same discipline, two new techniques that mattered:

1. **Mock-and-execute, not just read-and-reason.** For notebooks that read/write real Google Sheets and BigQuery (not reachable from this environment), the working pattern was: extract each notebook cell's source from the `.ipynb` JSON and `exec()` it in a namespace with `FakeWS`/`FakeSpreadsheet`/`FakeGC`/`FakeBQClient` mock classes that replicate the exact messy structure of the real sheet (blank header rows, duplicate headers, non-zero-padded dates, `datetime.time` values instead of strings, etc.) — then assert on the real computed output. Several real bugs (header-duplicate crash, date-format mismatch, `datetime.time` breaking Excel formulas) were only caught this way, not by inspecting the code.
2. **When Fernando reports a live error or pastes real messy data (e.g. the actual "INS FINAL" column text), rebuild the QA mock to match that exact shape and re-test — don't just patch the code and assume.** The alias-matching table for instructor nicknames (Sebas/Fio/Fiore/Cris) was built and validated directly against ~20 real strings Fernando pasted, not invented ones.
3. **Real gotcha in the edit-verify loop itself:** `NotebookEdit` on a `.ipynb` occasionally either didn't persist a change, or (once, when several inserts happened in the same session) landed content on the wrong cell id after an earlier insert reused an id. The reliable habit that caught both: after any notebook edit, **re-grep the raw file on disk** for the expected new content (not just trust the tool's echoed confirmation), and after any batch of inserts, dump `(index, cell id, first line)` for every cell to visually confirm ordering before trusting the notebook's structure.
4. **Excel/Sheets "looks right on open, breaks on edit" bugs are real and need their own check.** A value can display correctly the moment a generated file is opened, then silently change type (text→number or number→text) the instant a human clicks the cell and presses Enter, because the app re-parses the *raw text* using the cell's number format — not the format the writer intended. The fix in both directions found this session was to explicitly set `cell.number_format` (Excel) so the stored type can't drift on interaction, not just to get the *value* right at write time.
