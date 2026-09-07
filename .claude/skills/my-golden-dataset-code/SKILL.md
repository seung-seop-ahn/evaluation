---
name: my-golden-dataset-code
description: Build or extend a golden dataset from agent code and system prompts, deriving expected behaviour from the rules those files state.
argument-hint: "[코드 경로]  예: src/agents/agent.ts, src/agents/  (생략 시 탐색)"
disable-model-invocation: true
allowed-tools: Read Write Edit Glob Grep
---

# Code and prompt grounded golden dataset

Build evaluation cases from the rules an agent's code and system prompt already
state. The source of truth is what the system is **specified** to do, not what
it currently does.

**Write every user-facing string in Korean** — questions, options, progress
messages, file contents. Use the exact Korean wording from `questions.md`
rather than translating it yourself; translated options drift between runs.

<non_negotiable>
- NEVER run the system and record its output as `answer`. A dataset built that
  way certifies current behaviour and can never detect a defect in it.
- NEVER write a case into the golden CSV without explicit user approval.
- NEVER skip steps 0-2 and jump straight to generating candidates.
- NEVER fill the dataset with happy-path cases only.
- NEVER duplicate a case by rewording it to reach a target count.
- NEVER collapse a behavioural expectation into a literal string such as
  `answer: "거부함"`. Use `llm_judge` with a rubric, or `regex`.
- NEVER invent a rule the code does not state. Every case cites a real line.
</non_negotiable>

<workflow>
<step n="0" name="load_existing">
If `<name>.golden.csv` exists, read it and `<name>.meta.md`, report current
coverage and the next id per capability, then go to step 2 as a gap analysis.
When the argument is omitted, find agent code and prompt files under the
project and ask Q4.
</step>
<step n="1" name="define_purpose">
Ask Q1, then Q2 with defaults derived from Q1. On a first run also ask Q2b for
the dataset name and directory, proposing a default derived from the source.
Validate the name and check the path is free before writing. Record all of it
in `meta.md`.
</step>
<step n="2" name="coverage">
Read the code, extract the rules it states, present them as Q3 options with the
citing line shown, and write the resulting grid to `meta.md`. Record the git
SHA as the source revision.
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

## Where cases come from

Read the entrypoint, its system prompt, and any output schema, then look for
two things.

**Stated rules become cases directly.** A prompt line saying "출력은 JSON이어야
한다" or "근거가 없으면 질문을 만들지 말 것", a zod schema, a refusal condition,
a formatting constraint — each is a rule someone wrote down expecting it to
hold. Set `source` to `path:line` and `source_quote` to the rule's own text.

**Realistic inputs come from what the entrypoint accepts.** Read the input type
and the prompt's framing to work out what a real user would actually send, and
build the `question` from that rather than from an idealised example.

The distinction that matters: derive `answer` from the rule, never from a run.
Executing the code and recording what came back produces a dataset that agrees
with every bug the system currently has.

Typical capability axes: 출력 형식 준수, 프롬프트 제약 준수, 상태·컨텍스트 유지,
오류 입력 처리, 거부 조건.

## Grading modes for code cases

| Situation | Mode |
| --- | --- |
| Output must be valid JSON with given keys | `regex` or `llm_judge` |
| A field must hold one of a fixed set | `contains` or `regex` |
| Must not do something | `llm_judge` with a rubric naming both sides |
| Must ask instead of guessing | `llm_judge` with a rubric |

Set `entrypoint` on every case so a later reader knows which agent or prompt the
case targets. A dataset covering several entrypoints is fine; one that does not
say which is which is not.

## References

- Column definitions and validation rules: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/schema.md`
- Full workflow detail: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/workflow.md`
- Korean option wording: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/questions.md`
- File templates: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/templates/`
