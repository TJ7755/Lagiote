Sequence Learning Mode Rationale
================================

Overview
--------
Sequence learning targets short–to–medium retention (days to months) for ordered procedures. The design below ties product rules directly to well-replicated findings in cognitive psychology so the mode is retrieval-first, spaced, and chunk-aware while balancing interference.

Key Principles and Product Rules
--------------------------------
- Retrieval beats passive review: Recalling steps strengthens later performance versus re-reading (Roediger & Karpicke, 2006, https://doi.org/10.1037/0096-3445.135.3.389). Product rule: Sequence mode must default to retrieval tasks (order reconstruction, next-step recall, fill-a-gap) rather than passive step viewing.
- Spacing over cramming: Distributed practice improves retention over massed practice (Cepeda et al., 2006, https://doi.org/10.1177/0956797604272856). Product rule: Schedule Sequence steps with FSRS spacing over days/weeks; inside a session, resurface misses quickly (“within-session spacing”) before moving on.
- Chunking to reduce load: Humans encode long sequences as chunks to stay within working-memory limits (Gobet et al., 2001, https://doi.org/10.1207/S15326942DN0202_2). Product rule: Practise small windows first; expand window size as mastery improves. UI should surface chunk-level practice and gradual window growth.
- Contextual variability with guardrails: Interleaving can improve transfer, but excessive interference hurts early learning (Shea & Morgan, 1979, https://doi.org/10.1152/jappl.1979.46.4.605; Brady, 2008, https://doi.org/10.3758/MC.36.3.356). Product rule: Start with blocked practice per sequence, then introduce mixed/interleaved sequences only after mastery crosses a threshold; allow user/deck config for mixing intensity.

Concrete UX/Engine Requirements
-------------------------------
- Retrieval-first flows: Default tasks are reconstruct order (shuffle chunk and reorder), next-step recall, and fill-the-gap. Viewing the answer is secondary feedback, not the main task.
- Spaced scheduling: All Sequence cards integrate with FSRS for cross-day spacing. Within-session misses are re-queued soon (small chunk around the failed step).
- Chunk windows: Default window of ~4 steps; deck settings expose min/max chunk sizes. Increase window as correctness rises to reflect chunk consolidation.
- Blocked → mixed progression: Begin blocked per sequenceId. When average mastery for a sequence exceeds a threshold (e.g., >0.8), allow interleaving across sequences. Provide an opt-in toggle for mixed practice in settings.
- Data model resilience: Each step stores sequenceId + stepIndex + order; deck.sequenceMeta preserves titles/descriptions so reordering does not lose context.
- Compatibility: Sequence decks must work with existing Learn/Review/Practice Test/Exam Plan flows (step text as question, optional notes as answer) and analytics/Memory Insights (log mode “Sequence” with accuracy per step).

References
----------
- Retrieval practice: Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves long-term retention. DOI: 10.1037/0096-3445.135.3.389.
- Spacing effect: Cepeda, N. J., et al. (2006). Distributed practice in verbal recall tasks: A review and quantitative synthesis. DOI: 10.1177/0956797604272856.
- Chunking in sequences: Gobet, F., et al. (2001). Chunking mechanisms in human learning. DOI: 10.1207/S15326942DN0202_2.
- Contextual variability/interference: Shea, J. B., & Morgan, R. L. (1979). Contextual interference on motor tasks. DOI: 10.1152/jappl.1979.46.4.605. Brady, F. (2008). The contextual interference effect and sport skills. DOI: 10.3758/MC.36.3.356.
