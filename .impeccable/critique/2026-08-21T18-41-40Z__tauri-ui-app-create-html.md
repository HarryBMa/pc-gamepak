---
target: wizard
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-21T18-41-40Z
slug: tauri-ui-app-create-html
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 | Progress and status exist, but async loading states are inconsistent. |
| 2 | Match System / Real World | 3 | Cartridge and drive language fits; filesystem and launcher terminology needs translation. |
| 3 | User Control and Freedom | 2 | Close and dialog cancel work, but there is no clear cancel-write path. |
| 4 | Consistency and Standards | 3 | Controls are coherent, though icon-only and link-style actions vary in emphasis. |
| 5 | Error Prevention | 3 | Typed format confirmation is strong, but consequences are not consolidated into one review. |
| 6 | Recognition Rather Than Recall | 3 | Hints help, but users must remember several selections across the long right column. |
| 7 | Flexibility and Efficiency | 2 | Search, manual entry, bundling, and rescan help, but the keyboard path is under-exposed. |
| 8 | Aesthetic and Minimalist Design | 2 | Restrained styling, but too many conditional options become visible at once. |
| 9 | Error Recovery | 2 | Global status messages preserve state but can be technical and unspecific. |
| 10 | Help and Documentation | 2 | Contextual hints are thorough, but there is no concise task-level orientation. |
| **Total** | | **25/40** | **Acceptable: significant improvements needed** |

## Design Specificity Verdict

The wizard is clearly authored for PC GamePak. Cartridge vocabulary, Steam/Playnite integration, offline-first artwork, typed drive-label confirmation, and the distinction between metadata and copied games are product-specific.

Detector findings: `broken-image` at tauri-ui/app/create.html#L90 for the dynamically assigned preview image, likely intentional; and advisory `em-dash-overuse`, likely a false positive for explanatory product copy. The detector ran in degraded regex mode because parser modules were unavailable. Browser inspection found normal, empty, format, and Settings states rendering correctly, plus a real responsive issue: at 390x844, the two-column layout overflows and clips the right column.

## Overall Impression

The wizard has unusually honest safety language and a strong content model. Its biggest opportunity is to turn the existing safeguards into a calm sequence: choose content, choose cartridge, review consequences, write. Right now the right column reads as a flat technical checklist.

## What’s Working

- Typed current-label confirmation and backend validation create real protection before formatting.
- Games, bundle panel, and preview make single-game and collection creation understandable.
- Copy, Steam registration, verification, TRIM, tuning, and offline artwork behavior are explained honestly.

## Priority Issues

### [P1] Right column is a flat dependency checklist

Group required choices, advanced options, and formatting consequences into a visible sequence with a readiness summary. Suggested command: `/impeccable distill`.

### [P1] Formatting has protection but weak ceremony

When formatting is enabled, change the action to `Format and write cartridge`, show selected drive label/capacity, and state that everything else will be erased. Suggested command: `/impeccable clarify`.

### [P1] Narrow layout clips

At 390x844, the desktop two-column layout overflows horizontally and clips the right rail. Add an intentional stacked or scroll layout. Suggested command: `/impeccable adapt`.

### [P2] Disabled Write lacks an explanation

Add a live `Ready when...` message naming the first unresolved prerequisite. Suggested command: `/impeccable harden`.

### [P2] Explanatory copy is too dense

Lead with consequences, shorten default hints, and move mechanism details behind a compact disclosure. Suggested command: `/impeccable clarify`.

### [P2] Global status does too much

Use field-level messages and structured success/warning rows; normalize backend errors into recovery language. Suggested command: `/impeccable harden`.

## Persona Red Flags

- Alex: no visible keyboard path for the main workflow, long option explanations, no clear cancel during long copy, and slow bundle management.
- Jordan: unclear metadata-vs-copy distinction, untranslated technical terms, unexplained disabled Write, and low-emphasis overwrite/edit guidance.
- Sam: nested buttons in listbox-style rows, no announced readiness summary, global rather than adjacent errors, and heavy dependence on frameless icon controls.

## Minor Observations

Inline Bundle styling, long executable URIs in the preview, consequential Steam unregister as a low-emphasis link, dense success messages, and unvalidated Steam Deck/touch scaling.

## Questions to Consider

- Should the structure become `content -> cartridge -> consequence`, with advanced options collapsed?
- Should enabling format change the action to `Format and write cartridge`?
- Should the wizard prioritize a first successful cartridge or expose every backend capability immediately?
- Is narrow-screen support required for Steam Deck, or should the wizard remain desktop-only?
