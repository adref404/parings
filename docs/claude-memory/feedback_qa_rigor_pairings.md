---
name: feedback-qa-rigor-pairings
description: "Fernando expects real QA (recompute-and-compare), not just structural review, before confirming an Excel deliverable is correct"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: ac08facc-2c51-4558-85a4-59dc0ce883ad
  modified: 2026-09-22T15:39:55.399Z
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
