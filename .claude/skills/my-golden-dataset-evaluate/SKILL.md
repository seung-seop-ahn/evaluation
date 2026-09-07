---
name: my-golden-dataset-evaluate
description: Run a LangSmith experiment against an uploaded golden dataset, producing scores, a local report, and the raw outputs.
argument-hint: "[데이터셋 이름]  예: nist-policy  (생략 시 목록에서 선택)"
disable-model-invocation: true
allowed-tools: Read Edit Glob Grep
---

# Run a LangSmith experiment against a golden dataset

Execute every active case against the recorded target, grade it, record the run
as a LangSmith experiment, and write a local report in the same format
`my-golden-dataset-claude-evaluate` produces, so the two can be compared
directly.

Run `my-golden-dataset-upload` first. Without an uploaded dataset there is
nothing for the experiment to attach to, and the script falls back to a local
run — the same thing `claude-evaluate` already does, so the fallback is a
signal that a step was missed, not a feature to rely on.

**Write every user-facing string in Korean.**

<non_negotiable>
- NEVER run without showing the estimated call count and getting approval.
- NEVER rewrite a case's `answer` to match the observed output. Report it and
  ask before moving the case to `needs_review`.
- NEVER drop or exclude cases to raise a pass rate.
- NEVER print an API key value, in output, logs, or an echoed command.
- NEVER install a missing package automatically. Show the command and stop.
- NEVER present 100% as the goal. A perfect score means the dataset has been
  fitted to the system and stopped measuring anything.
</non_negotiable>

<workflow>
<step n="0" name="select_dataset">
When the argument is omitted, run the script without `--dataset` to list what
is available, and ask Q4.
</step>
<step n="1" name="estimate">
Run the script without `--yes`. It validates the CSV, selects gradable cases,
and prints the estimated call count. Nothing executes.
</step>
<step n="2" name="confirm">
Show the estimate and ask Q5. Repetition can be raised there; pass it through
as `--k`.
</step>
<step n="3" name="run">
Re-run with `--yes`. The script runs the LangSmith experiment when `meta.md`
records a dataset name and `LANGSMITH_API_KEY` is set, and writes
`reports/<name>-<timestamp>/report.md` and `runs.csv` either way. Pass
`--local` to skip the experiment deliberately.
</step>
<step n="4" name="read_report">
Read the report and walk the user through it in this order: 게이트 판정,
회귀 목록, 슬라이스별 통과율, pass^k, 실패 상세. Classify each failure as
시스템 결함, 케이스 오류, or 채점 기준 모호 — the script leaves them 미분류
because that judgement needs context it does not have.
</step>
</workflow>

## Running the script

Prefer the npm script when it exists:

```bash
npm run golden:eval -- --dataset <이름>
```

Otherwise call node directly — Node 23.6+ runs TypeScript without a build step:

```bash
node --env-file=.env ${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/scripts/evaluate.ts --dataset <이름>
```

See `my-golden-dataset-upload` for registering the npm scripts and for the
older-Node fallback.

## The target

The script reads the 평가 대상 section of `<name>.meta.md`.

**방식 A** runs the recorded project command once per case, with the question
passed as a shell argument rather than interpolated into the command string, so
quotes and semicolons in a question cannot break or hijack it. If the command
prints JSON shaped `{"answer": "...", "tools": [...]}`, tool calls are measured
too; otherwise the whole of stdout becomes the answer.

**방식 B** calls the recorded model with the recorded prompt. Tool cases are
skipped in this mode and listed with the reason — no real call happens, so
there is no trajectory to measure.

## Requirements

`LANGSMITH_API_KEY` in the **project root `.env`**, to record the experiment.
Without it the run falls back to local only.

`OPENAI_API_KEY`, needed only when the dataset has `llm_judge` cases or the
target is 방식 B. A dataset graded entirely by mechanical modes and run with
`--local` needs no key at all.

Never create a `.env` under `.claude/` — that directory is committed.

`@langchain/openai` must be installed for judge or 방식 B runs. If missing, show
`npm i @langchain/openai` and stop.

## Reading the result

The report's own order is its priority order. The headline rate is the least
interesting line on the page: **the regression list matters more**, because a
score that held steady while two cases silently broke is a worse outcome than a
score that dropped.

When the confidence interval is wide, the report says so. Believe it — with
twenty-odd cases, a few points of movement is noise.

## References

- Metrics and formulas: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/scoring.md`
- Target definition and env: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/langsmith.md`
- Korean option wording: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/questions.md`
