---
name: my-golden-dataset-claude-evaluate
description: Run a golden dataset inside Claude Code, grade it, and write a report. No API key and no external service.
argument-hint: "[데이터셋 이름]  예: nist-policy  (생략 시 목록에서 선택)"
disable-model-invocation: true
allowed-tools: Read Write Edit Glob Grep
---

# Evaluate a golden dataset inside Claude Code

Collect the system's real output for each case, grade it, and write a report.
Needs no API key and touches no external service, so it is the right first
check after building or extending a dataset.

**Write every user-facing string in Korean** — questions, options, progress
messages, and the report itself.

<non_negotiable>
- NEVER rewrite a case's `answer` to match the observed output. If a case looks
  wrong, say so in the report and ask before moving it to `needs_review`.
- NEVER drop or exclude cases to raise a pass rate.
- NEVER grade a case whose `status` is not `active`.
- NEVER relax a rubric while judging. Apply `grading_spec` as written.
- NEVER report a verdict without quoting the evidence from the actual output.
- NEVER present 100% as the goal. A perfect score means the dataset has been
  fitted to the system and stopped measuring anything.
- NEVER run a command without showing it and getting approval first.
</non_negotiable>

<workflow>
<step n="0" name="select_dataset">
When the argument is omitted, list the `*.golden.csv` files found under the
project with case counts and last evaluation date, and ask Q4.
</step>
<step n="1" name="read_config">
Read `<name>.meta.md` for the target definition, pass criteria, and default
repetition count. If the target definition is missing, ask for it and record it
before continuing.
</step>
<step n="2" name="select_cases">
Take `status: active` rows only. For each, compare the current revision of its
`source` against `source_rev`; on mismatch move the row to `needs_review` and
exclude it, then report that it happened. Exclude cases with non-empty
`expected_tools` when the target is 방식 B, with the reason recorded.
</step>
<step n="3" name="confirm_run">
Show the exact command, case count, and repetition count, then ask Q5.
</step>
<step n="4" name="collect">
Run each case. 방식 A executes the recorded project command with the question
passed as an argument, never interpolated into a shell string. 방식 B has you
read the target prompt and answer the question with it.
</step>
<step n="5" name="grade">
Grade per `scoring.md`. Mechanical modes compare by rule; `llm_judge` scores
five axes 1-5 and quotes evidence.
</step>
<step n="6" name="report">
Write `reports/<name>-<timestamp>/report.md` and `runs.csv` following
`templates/report.md`. Classify every failure as 시스템 결함, 케이스 오류, or
채점 기준 모호.
</step>
</workflow>

## Grading you perform yourself

You are the judge here, so two habits matter more than usual.

**Apply the rubric text, not your own standard.** The rubric in `grading_spec`
was written and approved by a human. Substituting your own idea of a good
answer makes the score untraceable.

**Quote the evidence.** Every verdict carries a short direct quotation from the
actual output. A verdict with no quotation cannot be reviewed and should be
treated as a defect in the report, not as a result.

When 방식 B was used, you produced the answer and then graded it. Say so at the
top of the report. Marking your own work is a known bias and the reader needs
to know it applies.

## When a case looks wrong

Sometimes the failure is the case, not the system. An expected answer that was
never right, or a rubric that cannot decide the situation in front of it.

Say so in the report under 원인: 케이스 오류 or 채점 기준 모호, describe what you
would change, and stop there. **Do not edit the case.** The moment a dataset
edits itself to agree with observed output, it stops being a measurement and
becomes a record of what the system already does.

## References

- Metrics and formulas: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/scoring.md`
- Column definitions: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/schema.md`
- Korean option wording: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/questions.md`
- Report template: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/templates/report.md`
