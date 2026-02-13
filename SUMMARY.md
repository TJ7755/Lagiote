# Summary of Changes

## Issues Found

1. **Loose equality (`==`) in dashboard.js:2965**
   - `log.cardID == cardId` uses type-coercing equality instead of strict comparison.
   - File: `js/pages/dashboard.js`, line 2965.
   - Could cause incorrect card ID matching when types differ (string vs number).

2. **Missing `type="button"` on buttons in study.html**
   - Seven `<button>` elements lacked explicit `type` attributes.
   - File: `study.html`, lines 26, 44, 83–86, 97.
   - Without `type="button"`, buttons default to `type="submit"` and can trigger unintended form submissions.

3. **Negative phase index when phases array is empty in exam-session-player.js:268**
   - `playerState.currentPhaseIndex = phases.length - 1` evaluates to `-1` when `phases` is empty.
   - File: `js/core/exam/exam-session-player.js`, line 268.
   - Could cause downstream errors when accessing `phases[-1]`.

4. **Shallow copy in question editor reset causes state mutation (editors.js:372)**
   - `reset()` used `{ ...initialQuestion }` (shallow copy). Since the initial object reference was shared with `state.question`, edits via `updateField()` and `addAtomMapping()` mutated the original `initialQuestion`, making reset ineffective.
   - File: `js/core/exam/editors.js`, lines 193–200, 372.

5. **Shallow copy in mark scheme editor reset causes state mutation (editors.js:654)**
   - Same pattern as #4. `addPoint()` and other methods mutated the initial scheme object, so `reset()` could not restore the original state.
   - File: `js/core/exam/editors.js`, lines 404–412, 660.

## Files Changed

| File | Change |
|------|--------|
| `js/pages/dashboard.js` | Replace `==` with `===` on line 2965 |
| `study.html` | Add `type="button"` to 7 button elements |
| `js/core/exam/exam-session-player.js` | Guard empty phases: `Math.max(0, phases.length - 1)` |
| `js/core/exam/editors.js` | Deep-clone initial state in question editor and mark scheme editor (snapshot at creation, use for reset) |
| `tests/vitest/bugfix-guards.test.mjs` | New: 5 tests covering all bug fixes |

## Tests Added

| Test file | Type | Coverage |
|-----------|------|----------|
| `tests/vitest/bugfix-guards.test.mjs` | Unit | Empty phases guard (2 tests), question editor deep clone on reset (2 tests), mark scheme editor deep clone on reset (1 test) |

## Commands to Reproduce

```bash
# Install dependencies
npm ci

# Build
npm run build

# Run legacy tests
npm test

# Run vitest tests (includes bugfix tests)
npx vitest run

# Run all tests together
npm run test:unit
```

## Coverage

Run coverage with:
```bash
npx vitest run --coverage
```

All 383 vitest tests pass. All 20 legacy tests pass. Build succeeds.

## Design Decisions

- **Deep-clone pattern**: Followed the existing pattern used by `createAtomEditor()` which already correctly deep-clones `initialAtom`. Applied the same pattern consistently to `createQuestionEditor()` and `createMarkSchemeEditor()`.
- **`Math.max(0, ...)`**: Minimal guard that prevents negative index while preserving behaviour for non-empty arrays.
- **`type="button"`**: Added only to `study.html` buttons which are standalone action buttons not within forms. Buttons in `index.html` could also benefit but are mostly `onclick`-driven and the scope of this change was kept minimal.
