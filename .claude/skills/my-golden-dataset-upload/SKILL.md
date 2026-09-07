---
name: my-golden-dataset-upload
description: Upload a verified golden dataset CSV to LangSmith, with schema validation and a preview before anything is written.
argument-hint: "[데이터셋 이름]  예: nist-policy  (생략 시 목록에서 선택)"
disable-model-invocation: true
allowed-tools: Read Edit Glob Grep
---

# Upload a golden dataset to LangSmith

Validate the CSV, show what would change, and write to LangSmith only after the
user approves.

**Write every user-facing string in Korean.**

<non_negotiable>
- NEVER pass `--apply` without showing the preview and getting approval first.
- NEVER upload when schema validation reports an error. Fix the CSV instead.
- NEVER delete an existing LangSmith example. Retiring is a `status` change in
  the CSV; the remote row is updated, not removed.
- NEVER print an API key value, in output, logs, or an echoed command.
- NEVER install a missing package automatically. Show the command and stop.
- NEVER change a dataset name already recorded in `meta.md`.
</non_negotiable>

<workflow>
<step n="0" name="select_dataset">
When the argument is omitted, run the script without `--dataset` to list what
is available, and ask Q4.
</step>
<step n="1" name="preview">
Run the script without `--apply`. It validates the CSV, selects `status: active`
rows, and prints the create / keep / update counts. Nothing is written.
</step>
<step n="2" name="handle_exit">
Exit 1 means validation failed — show the errors and stop; do not offer to
upload anyway. Exit 2 means a dataset with that name already exists and
`meta.md` has no record of it: ask Q6 and re-run with `--langsmith-name`.
</step>
<step n="3" name="confirm">
Show the preview counts and ask for approval.
</step>
<step n="4" name="apply">
Re-run with `--apply`. The script records the chosen name in `meta.md` on first
upload and writes the uploaded example ids to `reports/upload-<timestamp>.md`.
</step>
</workflow>

## Running the script

Prefer the npm script when it exists:

```bash
npm run golden:upload -- --dataset <이름>
```

Otherwise call node directly — Node 23.6+ runs TypeScript without a build step:

```bash
node --env-file=.env ${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/scripts/upload.ts --dataset <이름>
```

On first use, if neither script is registered, ask Q7 before adding these two
lines to `package.json`:

```json
"golden:upload": "node --env-file=.env .claude/skills/_shared/golden-dataset/scripts/upload.ts",
"golden:eval":   "node --env-file=.env .claude/skills/_shared/golden-dataset/scripts/evaluate.ts"
```

If Node is older than 22.6, substitute `npx tsx` for `node --env-file=.env` and
load the env another way.

## Requirements

`LANGSMITH_API_KEY` in the **project root `.env`**, which is already gitignored.
Never create a `.env` under `.claude/` — that directory is committed, so a key
placed there travels with the skill wherever it is copied.

`langsmith` must be installed in the project. If it is missing, show
`npm i langsmith` and stop.

## Why validation runs before any network call

Bad rows pushed to a shared workspace cost far more to undo than to prevent,
and other people may consume them in the meantime. The script exits non-zero on
the first schema violation and makes no request. Treat that exit as final.

## References

- Column mapping, naming, and undo: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/langsmith.md`
- Validation rules: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/schema.md`
- Korean option wording: `${CLAUDE_PROJECT_DIR}/.claude/skills/_shared/golden-dataset/questions.md`
