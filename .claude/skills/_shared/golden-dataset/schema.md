# Golden dataset schema

One CSV row is one case. The header below is fixed and shared by every
`my-golden-dataset-*` skill, so a consumer reads any dataset the same way.
Leave a column empty when it does not apply.

```
id,question,answer,source,source_quote,source_rev,entrypoint,capability,case_type,grading_mode,grading_spec,expected_tools,expected_args,trajectory_rule,method,status,verified_at,note
```

## Columns a human judges

These four are the only ones shown in the candidate review table. A reviewer
must be able to approve or correct a case from these alone.

| Column | What the reviewer decides |
| --- | --- |
| `question` | Is this something a real user would actually ask? |
| `answer` | Is this answer correct? |
| `source_quote` | Does this evidence actually support that answer? |
| `case_type` | Is this labelled as the right kind of situation? |

## Columns the skill maintains

| Column | Rules |
| --- | --- |
| `id` | `<capability>-<3 digits>`, e.g. `fact_lookup-007`. Continue from the highest existing number in the golden CSV. Stable across edits; it is the dedup key on upload. |
| `source` | Where the evidence lives. Documents: `path#page` or `path#section`. Code: `path:line`. Prompts: prompt name. |
| `source_rev` | Revision of the evidence: a git SHA, or a content hash for files outside version control. Empty when the expectation has no corpus behind it (arithmetic, tool selection). |
| `entrypoint` | Which agent, prompt, or command this case targets. |
| `capability` | Row axis of the coverage grid. Snake_case, reused verbatim across the dataset. |
| `grading_mode` | See below. |
| `grading_spec` | Parameters for the mode. Tolerance, pass threshold, or the full rubric text for `llm_judge`. |
| `expected_tools` | Tool names separated by `;`, in call order. Tools datasets only. |
| `expected_args` | JSON fragment naming only the arguments that decide the outcome. Tools datasets only. |
| `trajectory_rule` | See below. Tools datasets only. Required whenever `expected_tools` is non-empty OR the case expects no tool at all. |
| `method` | `manual`, `generated`, or `promoted_from_log`. |
| `status` | `active`, `needs_review`, or `retired`. |
| `verified_at` | ISO date, written at promotion time. Never backdated. |
| `note` | Why this case exists. Most valuable on cases promoted from a real incident. |

`verified_by` deliberately does not exist. When the CSV is under version
control, `git log` and `git blame` already say who approved each row. Do not
duplicate derivable information as a column.

`difficulty` deliberately does not exist. Easy/hard labelling is subjective
and carries little signal; `case_type` is the useful axis.

## `case_type`

| Value | Meaning |
| --- | --- |
| `happy` | The ordinary path that must simply work. |
| `boundary` | Empty input, very long input, minimum and maximum values, edges. |
| `ambiguous` | The request is unclear and the system should ask rather than guess. |
| `out_of_scope` | Unanswerable. The system must say so instead of inventing an answer. **The most common real-world failure.** |
| `adversarial` | Deliberately confusing input, or an attempt to bypass a stated rule. |
| `regression` | Promoted from an observed failure. Exists to stop that failure returning. |

## `grading_mode`

| Mode | Comparison | `grading_spec` holds |
| --- | --- | --- |
| `exact` | Normalised string equality (trim, collapse whitespace) | — |
| `contains` | Expected string appears in the output | — |
| `numeric` | Numeric equality within tolerance | `tolerance=0.01` |
| `regex` | Output matches the pattern | The pattern |
| `set_equal` | Two `;`-separated sets are equal, order ignored | — |
| `sequence` | Two `;`-separated lists are equal, order preserved | — |
| `llm_judge` | Five-axis rubric scoring, see `scoring.md` | The rubric, plus optional `threshold=4` |

`llm_judge` is the right mode whenever the expectation describes *behaviour*
rather than a literal string. "Must refuse", "must not cite a figure", "must
ask a clarifying question" all belong here. Writing `answer: "refuses"` with
`grading_mode: exact` produces a case that can never pass.

Every `llm_judge` case needs a rubric in `grading_spec` that states the pass
condition and the fail condition in the same sentence pattern:

```
Passes if it states the document does not cover this. Fails if it describes
specific 2.0 changes.
```

## `trajectory_rule`

| Value | Meaning |
| --- | --- |
| `exact_sequence` | The listed tools, in exactly this order, no extras. |
| `subsequence` | The listed tools appear in this relative order; other calls are tolerated. |
| `set_equal` | The same set of tools, order irrelevant. |
| `no_tool` | No tool may be called at all. `expected_tools` must be empty. |

Choosing `exact_sequence` everywhere is the usual mistake: it turns correct
behaviour into failures whenever order genuinely does not matter. Use it only
when a later call depends on an earlier call's result.

## `status` and what consumers do with it

| Value | Consumers |
| --- | --- |
| `active` | **Graded.** The only rows that count towards a score. |
| `needs_review` | Skipped and reported. Waiting on a human decision. |
| `retired` | Skipped silently. Kept for history, never deleted. |

A consumer that grades `retired` rows produces false failures, so this rule is
not optional.

### The `source_rev` rule

Recording a revision and never acting on it makes the column decoration.
The rule is:

> When the current revision of a case's `source` differs from its
> `source_rev`, move the case to `needs_review` and exclude it from scoring
> until a human re-verifies it.

A document changed underneath a case means the old expected answer may now be
wrong. Continuing to grade against it produces a score that is quietly a lie.

## Validation rules

Enforce all of these before a dataset is used or uploaded. A violation is an
error, not a warning.

1. Header matches the fixed column list exactly, in order.
2. `id` is non-empty, unique, and matches `^[a-z0-9_]+-\d{3}$`.
3. `question` and `answer` are non-empty.
4. `case_type`, `grading_mode`, `method`, `status` hold a listed value.
5. `grading_mode: llm_judge` requires non-empty `grading_spec`.
6. `grading_mode: regex` requires a `grading_spec` that compiles.
7. `expected_tools` non-empty requires a `trajectory_rule` other than `no_tool`.
8. `trajectory_rule: no_tool` requires empty `expected_tools`.
9. `status: active` requires non-empty `verified_at`.
10. `expected_args`, when present, parses as JSON.

## Mapping to an evaluation platform

`langsmith.md` covers the LangSmith mapping in full. The shape generalises:
put the input in `inputs`, the expected output in `outputs`, and **everything
else, grading information included, in `metadata`**. Grading fields placed in
`outputs` get treated as part of the expected answer and corrupt scoring.
