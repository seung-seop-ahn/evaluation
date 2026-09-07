# LangSmith integration

Used by `my-golden-dataset-upload` and `my-golden-dataset-evaluate`.

## Environment

Read from the **project root `.env`**, via `node --env-file=.env`. Never
create a `.env` under `.claude/` — that directory is committed, and a key
placed there travels with the skill to every machine it is copied to.

| Variable | Needed by |
| --- | --- |
| `LANGSMITH_API_KEY` | upload, evaluate |
| `OPENAI_API_KEY` | evaluate, only when the dataset has `llm_judge` cases |

When a required variable is missing, stop and print which one, where to put it,
and the fact that `.env` is gitignored. **Never print a key's value** — not in
logs, not in reports, not in an echoed command.

## Column mapping

| CSV | LangSmith example |
| --- | --- |
| `question` | `inputs.question` |
| `answer` | `outputs.answer` |
| `expected_tools` | `outputs.tools` — array, only when non-empty |
| everything else | `metadata.<column>` |

Grading columns belong in `metadata`, not `outputs`. An evaluator reading
`outputs` treats every key there as part of the expected answer, so a
`grading_mode` sitting in `outputs` corrupts the comparison.

`metadata.id` is the dedup key. Upload compares by it:

- id absent → create
- id present, content identical → skip
- id present, content differs → update

**Never delete an existing example.** Retiring a case is a `status` change in
the CSV, and the LangSmith row is updated, not removed.

## Dataset naming

Default to the local dataset name unchanged: `nist-policy.golden.csv` becomes
`nist-policy`. Keeping the two identical is what lets someone trace a LangSmith
dataset back to the CSV it came from.

On first upload, if a dataset with that name already exists, ask Q6 from
`questions.md`. Record the decision in `meta.md`:

```markdown
## LangSmith
- 데이터셋 이름: evaluation-nist-policy
- 첫 업로드: 2026-09-07
```

Read that value on every later run and never ask again. `evaluate` reads the
same field, so upload and evaluation always target the same dataset.

**Never change a recorded name automatically.** A silently renamed dataset is
disconnected from its own experiment history.

For `새 이름으로`, propose the project directory name as a prefix. In a shared
workspace `nist-policy` says nothing about its owner while
`evaluation-nist-policy` does. Do not force the prefix — in a personal
workspace it is only noise.

## Upload safety

1. Validate the CSV against `schema.md` first. Any violation aborts **before**
   any network call. Recovering from bad data already pushed to a shared
   service costs far more than the check.
2. Select `status: active` rows only.
3. Show a preview — target dataset, whether it is new, and the create / skip /
   update counts — and get explicit approval. A dry run is the default; there
   is no flag the user has to remember to pass.
4. After applying, write the example ids to
   `reports/upload-<timestamp>.md`. That file is the only basis for undoing a
   bad upload.

## Evaluation

Build the target from the `평가 대상` section of `meta.md`: either run the
recorded project command per case, or call the recorded model with the recorded
prompt.

Attach evaluators per `grading_mode`, following `scoring.md`. Add the tools
metrics whenever the dataset has any non-empty `expected_tools`.

Before running, state the cost: case count × repetitions × model calls, with
judge calls counted separately. Then ask Q5.

Afterwards, print the experiment URL and write the same-format local report to
`reports/<name>-<timestamp>/`. Identical formatting is what makes a local run
and a LangSmith run directly comparable.
