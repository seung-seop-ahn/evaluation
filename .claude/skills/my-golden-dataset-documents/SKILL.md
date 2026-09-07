---
name: my-golden-dataset-documents
description: Build or extend a document-grounded golden dataset from PDF, Markdown, or text sources.
argument-hint: "[문서 경로]  예: docs/policy.pdf, src/documents/pdf/  (생략 시 탐색)"
disable-model-invocation: true
allowed-tools: Read Write Edit Glob Grep
---

# Document-grounded golden dataset

Build evaluation cases whose expected answers come from a specific passage in a
document, so a reviewer can verify each one without reopening the source.

**Write every user-facing string in Korean** — questions, options, progress
messages, file contents. Use the exact Korean wording from `questions.md`
rather than translating it yourself; translated options drift between runs.

<non_negotiable>
- NEVER write a case into the golden CSV without explicit user approval.
- NEVER use output obtained by running the system under test as `answer`.
- NEVER skip steps 0-2 and jump straight to generating candidates.
- NEVER fill the dataset with happy-path cases only.
- NEVER duplicate a case by rewording it to reach a target count.
- NEVER collapse a behavioural expectation into a literal string such as
  `answer: "모른다고 답함"`. Use `llm_judge` with a rubric, or `regex`.
- NEVER write a case whose `source_quote` is empty when the answer is supposed
  to come from the document.
</non_negotiable>

<workflow>
<step n="0" name="load_existing">
If `<name>.golden.csv` exists, read it and `<name>.meta.md`, report current
coverage and the next id per capability, then go to step 2 as a gap analysis.
When the argument is omitted, find documents under the project and ask Q4.
</step>
<step n="1" name="define_purpose">
Ask Q1, then Q2 with defaults derived from Q1. On a first run also ask Q2b for
the dataset name and directory, proposing a default derived from the source.
Validate the name and check the path is free before writing. Record all of it
in `meta.md`.
</step>
<step n="2" name="coverage">
Read the document, derive candidate capability axes from what is actually in
it, ask Q3, and write the resulting grid to `meta.md`. Record the source
revision (git SHA, or a content hash for untracked files).
</step>
<step n="3" name="draft_candidates">
Aim at the short cells. Check each candidate against existing rows for near
duplication before writing it. Write to `<name>.candidates.md`.
</step>
<step n="4" name="human_gate">
Show the candidate table, tell the user to correct or delete rows in place,
and wait. Do not offer to approve everything at once.
</step>
<step n="5" name="promote">
Set `status: active` and `verified_at`, append approved rows to the golden CSV,
remove them from the candidates file, then report the cells still short.
</step>
</workflow>

## Deriving cases from a document

Walk the document section by section and ask: **what question could only be
answered by this passage?** That question is the case, and the passage is its
`source_quote`.

- Set `source` to `path#page` or `path#section`, and `source_quote` to the
  sentence that carries the answer. The reviewer judges from the quote alone,
  so it must actually contain the answer, not merely relate to it.
- Do not build questions from a whole-document summary. If no single passage
  can be cited, the case cannot be graded either.
- Cover `out_of_scope` heavily. Inventing a confident answer to something the
  document never mentions is how document-grounded systems fail in production,
  and it fails silently.

Typical capability axes: 사실 조회, 여러 절 종합, 수치·표 해석, 조건부 규칙 적용,
범위 밖 거부.

## Grading modes for document cases

| Situation | Mode |
| --- | --- |
| A short factual answer | `exact` or `contains` |
| A figure from a table | `numeric` with `tolerance` |
| Must refuse, must not fabricate | `llm_judge` with a rubric |
| Must mention a specific term | `regex` |

An `out_of_scope` case always needs a rubric that names both sides:

```
문서에 없다고 명시하면 pass. 2.0의 내용을 구체적으로 서술하면 fail.
```

## References

- Column definitions and validation rules: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/schema.md`
- Full workflow detail: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/workflow.md`
- Korean option wording: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/questions.md`
- File templates: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/templates/`
