# Scoring

Shared by `my-golden-dataset-claude-evaluate` and
`my-golden-dataset-evaluate`, so the two produce comparable reports.

## Per-case verdict

Every case ends as `pass`, `fail`, or `skipped`.

`skipped` is for cases that could not be run, not for cases that failed. The
two reasons are a `source_rev` mismatch (moved to `needs_review`) and a tools
case attempted without real tool execution. Skipped cases are excluded from
rates and listed separately with the reason.

### Mechanical modes

Compare per `schema.md`. Normalise whitespace and case before string
comparison. For `numeric`, parse both sides and compare within
`tolerance` from `grading_spec`, defaulting to exact equality.

### `llm_judge`

Score five axes from 1 to 5:

| Axis | Question |
| --- | --- |
| `correctness` | Is the substance right? |
| `groundedness` | Is every claim supported by the provided evidence? |
| `completeness` | Does it cover what the expected answer covers? |
| `conciseness` | Is it free of padding and irrelevant material? |
| `overall` | Taking the rubric as a whole, how good is this answer? |

`overall >= threshold` is a pass. Threshold defaults to 4 and can be set per
case in `grading_spec`.

Two requirements on the judge:

- **Apply the rubric text as written.** Do not substitute your own standard for
  what a good answer looks like.
- **Quote the evidence.** Every verdict carries a short quotation from the
  actual output that justifies the score. A verdict with no quotation is not
  reviewable and should be treated as a defect in the report.

When the evaluation ran with the evaluator judging output it produced itself,
say so in the report header. A judge marking its own work is a known bias, and
the reader needs to know it applies.

## Aggregate metrics

### Pass rate, two ways

- **Micro** — passes divided by graded cases, overall.
- **Macro** — mean of the per-cell pass rates across the coverage grid.

Report both. When cells hold different numbers of cases, micro is dominated by
the large cells and hides failures in the small ones. A widening gap between
the two numbers is itself the finding.

Also break the rate down by `capability` and by `case_type` separately.

### Wilson 95% confidence interval

On the overall pass rate. With 20 to 30 cases the interval is wide, and
reporting a bare percentage invites treating noise as improvement.

For `p̂ = x/n` at `z = 1.96`:

```
centre = (p̂ + z²/2n) / (1 + z²/n)
spread = z·√(p̂(1-p̂)/n + z²/4n²) / (1 + z²/n)
interval = centre ± spread
```

When the interval spans more than 20 percentage points, say plainly in the
report that differences of a few points are not meaningful at this sample size.

### Tools metrics

For expected tool set `T` and actually-called set `A`:

- `precision = |T ∩ A| / |A|` — how much of what it called was needed
- `recall = |T ∩ A| / |T|` — how much of what was needed it called
- `F1` — harmonic mean

Report separately, because set F1 hides both:

- **Trajectory exact match rate** — fraction where order also matched, over
  cases whose `trajectory_rule` is `exact_sequence` or `subsequence`
- **Unnecessary call rate** — fraction of `no_tool` cases where any tool was
  called. This is usually the most actionable number in a tools report:
  needless calls cost latency and money on every single request.

### Refusal and fabrication

Over `out_of_scope` cases:

- **Refusal rate** — correctly said it could not answer
- **Fabrication rate** — produced specific content with no supporting evidence

### pass@k and pass^k

Only when `k > 1`. With `k = 1` the two are identical and neither is shown.

- `pass@k` — passed at least once across k runs
- `pass^k` — passed in every one of the k runs

The gap between them is the set of cases that pass by luck. They are counted
as passes in the headline rate but cannot be relied on, so list them by id.

### Regression comparison

Compare against the most recent previous report for the same dataset:

- **Regressions** — passed before, fails now
- **Fixes** — failed before, passes now

List both by id. In practice this list matters more than the total: a score
that held steady while two cases silently broke is a worse outcome than a
score that dropped.

### Gate verdict

Compare each criterion in `meta.md` against the measured value and state pass
or miss per criterion. When the purpose is `약점 찾기` there are no criteria and
the gate section is omitted rather than faked.

## Failure cause classification

Classify every failure as exactly one of:

| Cause | Meaning | Follow-up |
| --- | --- | --- |
| **System defect** | The system is wrong | Fix the system |
| **Case error** | The expected value is wrong | Propose moving to `needs_review`; never edit it directly |
| **Grading ambiguity** | `grading_spec` cannot decide this | Propose a rubric fix |

Treating every failure as a system defect leads to fixing the wrong thing.
This classification is the most useful part of the report.

## Report ordering

The report is read top to bottom in this order of importance:

1. Gate verdict
2. Regression list
3. Slice breakdown — where the overall average is hiding a weak cell
4. `pass^k`, when `k > 1`
5. Failure detail with cause classification
6. Coverage gaps and promotion candidates

## Never

- **NEVER** rewrite a case's `answer` to match observed output.
- **NEVER** drop or exclude cases to raise a rate.
- **NEVER** relax a rubric while judging.
- **NEVER** present 100% as the goal. A perfect score means the golden set has
  been fitted to the system and has stopped measuring generalisation.
