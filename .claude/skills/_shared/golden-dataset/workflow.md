# Shared workflow for the three dataset-building skills

Six steps, in order. Steps 0 through 2 are not optional preparation: skipping
them is what produces a dataset full of easy questions that scores well and
measures nothing.

## Step 0 — Load existing state

Look for `<name>.meta.md` and `<name>.golden.csv` at the target location.

When the user names a dataset that does not exist yet, or gives none, treat the
run as a first run and settle the name and location in step 1.

**If they exist**, this is an extension, not a first run:

- Read the coverage grid from `meta.md` and tally the existing rows against it.
- Find the highest numeric suffix per capability so new ids continue the run.
- Report the current state before doing anything else, then skip step 1 (the
  purpose is already decided) and go to step 2 as a gap analysis.

**If they do not exist**, this is a first run. Continue to step 1.

Extension is the common case. A skill that only handles the empty-dataset path
can be used exactly once.

## Step 1 — Define the purpose, name, and location

Present the purpose options (Q1) from `questions.md`. Then present the
pass-criteria options (Q2), pre-filled with the defaults that match the chosen
purpose. Then, on a first run only, present Q2b for the dataset name and the
directory it lives in, with a default derived from the source.

Never ask any of these as an open question. "What decision will this evaluation
drive?" is not answerable by someone who has not built an evaluation before,
which is exactly who needs the skill. The same applies to "where should I put
it?" — propose a sensible default and let the user override it.

Write the answers into `meta.md` before continuing.

## Step 2 — Design coverage, or diff against it

Read the source and derive candidate capability axes from what is actually
there. Present them as a multi-select using the wording pattern in
`questions.md`: each option is a short name plus one line saying what it
checks.

Turn the chosen axes into a grid of `capability` (rows) by `case_type`
(columns), with a target count per cell, and write it to `meta.md`.

For an extension, instead compare the existing distribution against the
targets and report which cells are short. Those cells are the brief for step 3.

Every grid must include `out_of_scope` coverage unless the target genuinely
cannot receive out-of-scope input. Systems fail there more often, and more
quietly, than anywhere else.

## Step 3 — Draft candidates

Aim at the short cells identified in step 2. For each candidate:

- Fill every column the skill maintains, including `grading_mode` and
  `grading_spec`. A candidate without a grading decision is not reviewable.
- Check it against existing golden rows for near-duplication before writing it.
  Compare normalised `question` text and the `source` locator. A prohibition
  with no checking step attached is decoration.
- Prefer sources in this order: observed production failures and incident
  records first, then issue trackers, then the document or code itself.
  A case that comes from a real failure is worth several invented ones.

Write them to `<name>.candidates.md` using `templates/candidates.md`. This file
is a workspace, not a dataset. Nothing in it counts until step 5.

## Step 4 — Human verification gate

Show a compact summary, then hand the file over:

- The candidate table shows only `id`, `question`, `answer`, `source_quote`,
  and `case_type`. More columns make the table unreadable and the review
  worthless.
- Tell the user to correct wording in place, delete rows they reject, and say
  when they are done.

**This step is deliberately not multiple-choice.** Verification in practice is
rewriting — adjusting an expected answer, tightening a rubric, splitting one
case into two — and a chooser cannot express that. Step 1's decisions have a
handful of discrete answers, so options work there. Editing prose does not.

Do not offer to "approve all". A gate that can be waived in one keystroke is
not a gate.

## Step 5 — Promote and report coverage

For each row the user kept:

1. Set `status` to `active` and `verified_at` to today's date.
2. Append it to `<name>.golden.csv`.
3. Remove it from `<name>.candidates.md`.

Then report which grid cells are still short, so the next run has a brief.

A golden dataset is never "finished". Leaving named gaps is the correct
end state, not an incomplete one.
