---
name: my-golden-dataset-tools
description: Build or extend a tool trajectory golden dataset covering which tools an agent should call, in what order, and when it should call none.
argument-hint: "[코드 경로]  예: src/tools/toolkit.ts, src/tools/  (생략 시 탐색)"
disable-model-invocation: true
allowed-tools: Read Write Edit Glob Grep
---

# Tool trajectory golden dataset

Build evaluation cases for an agent's tool use: which tools it calls, in what
order, with which arguments, and — most importantly — when it should call
nothing at all.

**Write every user-facing string in Korean** — questions, options, progress
messages, file contents. Use the exact Korean wording from `questions.md`
rather than translating it yourself; translated options drift between runs.

<non_negotiable>
- NEVER run the agent and record the tools it happened to call as expected.
- NEVER write a case into the golden CSV without explicit user approval.
- NEVER skip steps 0-2 and jump straight to generating candidates.
- NEVER build a dataset where every case expects a tool call. Cases that must
  call nothing are the point.
- NEVER set `exact_sequence` unless a later call genuinely depends on an
  earlier call's result.
- NEVER duplicate a case by rewording it to reach a target count.
</non_negotiable>

<workflow>
<step n="0" name="load_existing">
If `<name>.golden.csv` exists, read it and `<name>.meta.md`, report current
coverage and the next id per capability, then go to step 2 as a gap analysis.
When the argument is omitted, find tool definitions under the project and ask
Q4.
</step>
<step n="1" name="define_purpose">
Ask Q1, then Q2 with defaults derived from Q1, adding 불필요 호출률 to the
proposed criteria — it is the number this dataset exists to measure. On a first
run also ask Q2b for the dataset name and directory. Record all of it in
`meta.md`.
</step>
<step n="2" name="coverage">
Read the tool definitions and the agent that binds them, derive capability
axes, ask Q3, and write the grid to `meta.md`. Ensure `out_of_scope` has a
substantial target count.
</step>
<step n="3" name="draft_candidates">
Aim at the short cells. Check each candidate against existing rows for near
duplication before writing it. Write to `<name>.candidates.md`.
</step>
<step n="4" name="human_gate">
Show the candidate table including `expected_tools` and `trajectory_rule`, tell
the user to correct or delete rows in place, and wait.
</step>
<step n="5" name="promote">
Set `status: active` and `verified_at`, append approved rows to the golden CSV,
remove them from the candidates file, then report the cells still short.
</step>
</workflow>

## Reading tool definitions

For each tool, read its name, description, and parameter schema, then work out
two sets of situations: **when it must be called**, and **when calling it would
be wrong**. Both become cases.

The second set is where the value is. An agent that calls a search tool to
answer `3 더하기 5는?` is not merely inelegant — it adds latency and cost to
every such request in production, and a dataset made only of positive cases
cannot see it. Express these with `trajectory_rule: no_tool` and an empty
`expected_tools`.

Typical capability axes: tool 선택, 호출 순서, 인자 구성, 불필요 호출 억제,
실패한 tool 복구.

## Choosing `trajectory_rule`

| Situation | Rule |
| --- | --- |
| Order matters — a later call consumes an earlier result | `exact_sequence` |
| These tools must appear in this order, extras tolerated | `subsequence` |
| Same tools, order irrelevant | `set_equal` |
| No tool may be called | `no_tool` |

Defaulting everything to `exact_sequence` turns correct behaviour into
failures. Ask for each case whether swapping the order would actually produce a
worse answer; if not, `set_equal` is right.

## Arguments

Put only the arguments that decide the outcome into `expected_args`, as a JSON
fragment. Listing every argument makes the case fail on harmless differences —
a sensible default the agent filled in, a field the model ordered differently —
and a case that fails for harmless reasons gets ignored, which is worse than
not having it.

## References

- Column definitions and validation rules: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/schema.md`
- Full workflow detail: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/workflow.md`
- Korean option wording: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/questions.md`
- File templates: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/templates/`
