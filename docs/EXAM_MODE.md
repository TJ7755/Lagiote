# Exam Mode Architecture

This document explains the Exam Mode architecture in Lagiote Revise and how to author exam content.

## Overview

Exam Mode is a comprehensive exam preparation system that goes beyond simple flashcard revision. It provides:

- **Exam date countdown and predictions** - Know your likely score and grade probability before sitting the exam
- **Revision completeness tracking** - See how prepared you are across all topics
- **Intelligent practice selection** - Optimised session composition based on exam score impact
- **Mark scheme-driven assessment** - Authentic exam marking with partial credit
- **Failure pattern tracking** - Identify and address recurring mistakes

## Core Concepts

### Atoms (Smallest Learning Units)

An **atom** is the smallest unit of learning, representing:

- A fact (knowledge)
- A micro-procedure (skill)
- An exam technique step
- A representation transform (graph/table comprehension)

Each atom has multiple dimensions:

| Dimension | Range | Description |
|-----------|-------|-------------|
| `mastery` | 0-1 | Probability of demonstrating the atom correctly now |
| `stabilityDays` | 0+ | Resistance to forgetting (time constant for decay) |
| `difficulty` | 0-1 | Content-intrinsic difficulty estimate |
| `depth` | 0-1 | Conceptual abstraction (recall vs synthesis) |
| `transferability` | 0-1 | How broadly the atom generalises |
| `fragility` | 0-1 | Likelihood of performance collapse under variation |
| `timeSensitivity` | 0-1 | How much success depends on speed |
| `type` | enum | knowledge, procedure, exam_technique, representation |
| `prerequisites` | array | Weighted graph of required prerequisite atoms |

### Error Atoms

**Error atoms** track recurring failure patterns, such as:

- Forgetting units in answers
- Answering a different question than asked
- Arithmetic slips despite correct reasoning
- Confusing correlation and causation

These help predict mark loss and target practice.

### Questions

Questions map to one or more atoms with weights, indicating how strongly the question measures each atom.

Each question has:

- `prompt` - The question text
- `type` - mcq_single, mcq_multi, numeric, short_text, structured, essay
- `difficulty` and `depth` - Question-level difficulty parameters
- `timeProfile` - Expected seconds and pressure level
- `atomMap` - Links to atoms with weights

### Mark Schemes

Two styles are supported:

**Points-based schemes** (STEM, structured answers):
- Method marks (M1, M2)
- Accuracy marks (A1, A2)
- Reasoning marks (R1, R2)
- Dependencies between points (requires)
- Error carried forward (ECF) flags
- Accept/reject lists for responses
- Links to atoms with weights

**Levels-based rubrics** (essays):
- Level descriptors
- Mark bands
- Criteria-to-atom linking
- Manual marking workflow

## Architecture

### Three-Layer Separation

The system maintains clean separation between:

1. **State Model** (`js/core/exam/atom-dynamics.js`, `atom-updates.js`)
   - Holds learner's atom state
   - Computes decay and predicted competence
   - Updates states based on marking evidence

2. **Assessment Model** (`js/core/exam/exam-mode.js`, `marking.js`)
   - Question bank with atom mappings
   - Structured mark schemes
   - Scoring logic (objective and rubric-based)

3. **Policy Model** (Cortex integration)
   - Selects what to present next
   - Optimises for exam outcomes by deadline

### Key Modules

```
js/core/exam/
  atom-dynamics.js    - Decay model and mastery prediction
  atom-updates.js     - Update atoms from marking results
  exam-hub.js         - Hub dashboard state management
  exam-mode.js        - Core exam engine functions
  exam-path-map.js    - Topic/cluster navigation
  exam-session-player.js - Session runner
  exam-sync.js        - Cloud synchronisation
  marking.js          - Mark scheme engine

js/pages/
  exam-mode-ui.js     - UI controller for all exam views
```

### Decay Model

Mastery decays over time using exponential decay:

```
predicted_mastery = mastery * exp(-days_elapsed / (stability + epsilon))
```

This allows predicting competence on the exam date, not just current state.

### Effective Mastery

Effective mastery respects prerequisites:

```
effective = min(predicted_mastery, prerequisite_cap)
```

where `prerequisite_cap` is the weighted minimum of prerequisite masteries.

### Practice Value Function

Questions are selected based on expected exam score gain per minute:

```
Value(Q) = E[delta_ExamScore | Q] / time(Q)
```

This considers:
- Urgency (low exam-date predicted mastery)
- Mark leverage (atoms tied to high mark yield)
- Error atoms causing mark loss
- Depth gap (recall vs application)
- Fragility (fails under variation)
- Time sensitivity (fluency weakness)

## Session Composition

Optimal sessions follow a structured pattern:

1. **Warm-up** (10%) - Easy retrieval to activate memory
2. **Targeted Struggle** (50%) - Challenging but achievable questions
3. **Technique Drill** (20%) - Exam-specific skills practice
4. **Timed Chunk** (15%) - Build fluency under pressure
5. **Recap** (5%) - Review weak points

## Keyboard Shortcuts

### Dashboard
- `Ctrl/Cmd+Shift+E` - Open Exam Hub
- `Ctrl/Cmd+Shift+/` - Show keyboard shortcuts help

### Exam Hub
- `S` - Start optimal session
- `T` - Open topic map
- `E` - Open editors
- `Esc` - Back

### Session Player
- `Left/Right` - Navigate questions
- `1-4` - Select MCQ option
- `Enter` - Submit answer
- `F` - Flag question for review
- `Ctrl/Cmd+S` - Submit exam
- `Esc` - Pause

### Marking
- `1` - Mark incorrect
- `2` - Mark partially correct
- `3` - Mark correct
- `N` / `P` - Next / Previous question

## Authoring Content

### Creating Atoms

Use the Atom Editor in Exam Mode to create atoms:

1. Open Exam Hub for a deck
2. Navigate to Editors
3. Click "New Atom"
4. Fill in dimensions and prerequisites
5. Save

### Creating Questions

1. Open the Question Editor
2. Enter the prompt and select question type
3. Map atoms with weights (how much does this question test each atom?)
4. Link to a mark scheme
5. Set difficulty and time profile

### Creating Mark Schemes

For points-based schemes:

1. Create scheme points (M1, A1, R1, etc.)
2. Define accept/reject lists for each point
3. Set dependencies (M2 requires M1)
4. Link each point to atoms with weights
5. Configure ECF flags if appropriate

For rubric schemes:

1. Define levels with descriptors
2. Set mark bands for each level
3. Link criteria to atoms

### Testing Mark Schemes

Use the Test Harness:

1. Open the mark scheme
2. Paste a sample response
3. View scoring and awarded points
4. Adjust accept/reject lists as needed

## Predictions

### Score Distribution

The system predicts:
- Expected marks (mean)
- Confidence interval (90%)
- Grade boundary probabilities

Predictions use:
- Decay-adjusted atom mastery at exam date
- Question-atom mappings
- Mark scheme structure
- Historical calibration from real sittings

### Revision Completeness

Completeness considers:
- Score progress towards target
- Coverage across all atoms
- Fragility risk
- Technique readiness
- Time/fluency gaps

### Time-to-Target

Estimates how many hours of practice are needed to reach your target score, with uncertainty bands.

## Data Model

All exam data is stored in IndexedDB with full offline support:

- `atoms` - Knowledge atoms
- `errorAtoms` - Failure patterns
- `questions` - Question bank
- `markSchemes` - Marking schemes
- `examSpecs` - Exam blueprints
- `examPapers` - Generated papers
- `examSittings` - Practice sessions and marks
- `markingRecords` - Detailed marking history

All entities use UUIDs and support versioning, tombstones, and sync.

## Best Practices

1. **Start with atoms** - Define the knowledge/skills before creating questions
2. **Use weighted mappings** - Not all questions test atoms equally
3. **Track error patterns** - Add error atoms for recurring mistakes
4. **Set realistic exam dates** - Predictions depend on time remaining
5. **Complete practice sessions** - Partial sessions don't update state properly
6. **Review weak areas regularly** - The system prioritises high-value practice
7. **Calibrate with mocks** - Real sitting results improve predictions

## Troubleshooting

**Predictions seem inaccurate:**
- Ensure questions have proper atom mappings
- Complete more practice sessions for calibration
- Check that atoms have reasonable initial difficulty values

**Sessions feel too easy/hard:**
- Adjust atom mastery values
- Review question difficulty settings
- Check the phase setting (foundation/build/perform)

**Mark schemes not working:**
- Verify accept/reject lists cover common responses
- Check dependencies are correctly configured
- Use the test harness to debug

---

For implementation details, see the source code in `js/core/exam/` and `js/pages/exam-mode-ui.js`.
