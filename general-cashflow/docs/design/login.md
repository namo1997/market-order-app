# General Cashflow access

Production UI implementation within the existing navy, gold, and paper design.
The cashier's first decision is their active branch, with one full-width touch target per branch.
Admin chooses สา, โม, or จ๋า, then enters a masked six-digit PIN through a numeric input or on-screen keypad.
The sixth digit submits once. Wrong PIN clears the input and allows another attempt.
Preserve configured Google login; remove the unused username/password form.
Use distinct user records for branch cashiers and named admins so audit actor IDs remain meaningful.
Do not change existing accounts, balances, transactions, or accounting flows.
Verify keyboard access, paste, touch keypad, errors, branch preselection, and narrow mobile layouts.

## UI review, 4 October 2026

Found and fixed clipping of the PIN dialog at 320 × 568, enlarged Cancel/Back touch targets, and made the entry buttons full width. The dialog is capped to the visible viewport with internal scrolling, including reduced available height. Selecting an operator does not focus the native input on touch devices, preserving immediate use of the on-screen keypad. Desktop keyboard users retain automatic input focus.

Verified seven viewport sizes: 320 × 568, 360 × 640, 390 × 844, 430 × 932, 844 × 390, 1440 × 900, and 390 × 360. Dialog stays within the viewport, no horizontal overflow, and buttons are at least 44 pixels. Verified focus containment, inert background, keyboard login as จ๋า and emulated touch keypad login as โม. Native iOS/Android software keyboards have not been tested on physical devices; short-height emulation verifies control reachability.

Critique: 8/10 overall. Strong task clarity and large touch controls within the established visual language. The small-screen clipping in the first implementation was a material flaw and is now fixed. Remaining validation is a physical-device check of native keyboard and Safari behavior.
