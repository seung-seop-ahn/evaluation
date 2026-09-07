# Question wording

Every question a skill asks the user is multiple choice. Use the Korean
wording below **verbatim** — do not translate it yourself, or the phrasing
drifts between runs and the options stop being recognisable.

Ask these with `AskUserQuestion`. Put the recommended option first and mark it
`(추천)` when one is clearly better for the situation. Free text is offered
only through the explicit `직접 정하기` option.

---

## Q1 — Purpose

Header: `평가 목적`
Question: `이 평가를 왜 만드시나요?`

| Label | Description shown to the user |
| --- | --- |
| `회귀 방지` | `프롬프트나 모델을 바꿨을 때 원래 잘 되던 게 망가졌는지 확인합니다. 정상 동작 케이스 위주로 만들고 통과 기준을 높게 잡습니다. 한 건만 실패해도 신호로 봅니다.` |
| `약점 찾기` | `지금 시스템이 어디서 무너지는지 찾습니다. 어렵고 애매한 케이스 위주로 만들고, 통과율이 낮게 나오는 게 정상이라 통과 기준을 두지 않습니다.` |
| `배포 판정` | `이 버전을 내보내도 되는지 결정합니다. 중요 기능과 위험 케이스를 균형 있게 넣고 명확한 통과 기준을 정합니다.` |
| `A/B 비교` | `두 프롬프트나 모델 중 어느 쪽이 나은지 봅니다. 같은 데이터셋을 두 번 돌려 차이를 보므로 절대 점수보다 상대 비교가 중심입니다.` |

What each answer changes:

| Purpose | Grid skew | Pass criteria |
| --- | --- | --- |
| `회귀 방지` | `happy` and `regression` heavy | High, 90%+ |
| `약점 찾기` | `boundary`, `ambiguous`, `adversarial` heavy | **None — skip Q2 entirely** |
| `배포 판정` | Balanced, with `out_of_scope` weighted | Explicit, required |
| `A/B 비교` | Balanced | Relative; record the baseline run instead of a threshold |

For `약점 찾기`, do not ask Q2. Setting a bar defeats the purpose of looking
for weaknesses.

---

## Q2 — Pass criteria

Propose defaults derived from Q1 and the source, then ask only whether to keep
them. Show the proposed numbers in the question text.

Header: `통과 기준`
Question: `제안한 통과 기준으로 진행할까요?`

| Label | Description shown to the user |
| --- | --- |
| `이대로` | `제안한 기준을 그대로 씁니다.` |
| `더 엄격하게` | `기준을 높입니다. 통과하기 어려워지지만 놓치는 문제가 줄어듭니다.` |
| `더 느슨하게` | `기준을 낮춥니다. 초기 단계라 아직 통과하기 어려울 때 씁니다.` |
| `직접 정하기` | `기준을 직접 입력합니다.` |

Default criteria by purpose:

- `회귀 방지` — 전체 통과율 ≥ 90%, 회귀 케이스 0건
- `배포 판정` — 전체 통과율 ≥ 85%, `out_of_scope` 통과율 ≥ 95%
- `A/B 비교` — 기준 없음. 대신 비교 대상 실행을 `meta.md`에 기록

Raise the `out_of_scope` bar higher than the overall bar whenever the target
can receive unanswerable input. Inventing an answer costs more than getting an
answerable question slightly wrong.

---

## Q2b — Dataset name and location

Ask once, on a first run only. On an extension the files already exist and
their name and location are settled, so asking again would only invite an
accidental split into two datasets.

Propose a default first and show it in the question text:

- **Name** — derived from the source. A directory gives its own name
  (`src/documents/pdf/` → `documents`), a single file gives its basename
  (`policy.pdf` → `policy`). Lowercase, hyphenated, no extension.
- **Location** — an `eval/` directory beside the source
  (`src/documents/pdf/` → `src/documents/eval/`), so the dataset sits next to
  what it is about.

Header: `저장 위치`
Question: `데이터셋을 이 이름과 위치로 만들까요?`

| Label | Description shown to the user |
| --- | --- |
| `제안대로` | `제안한 이름과 위치를 그대로 씁니다.` |
| `이름만 바꾸기` | `위치는 그대로 두고 데이터셋 이름만 직접 정합니다. 이 이름이 파일명과 LangSmith 데이터셋 이름의 기본값이 됩니다.` |
| `위치만 바꾸기` | `이름은 그대로 두고 저장할 디렉토리만 직접 정합니다.` |
| `둘 다 직접 정하기` | `이름과 위치를 모두 직접 입력합니다.` |

Validate whatever the user supplies before writing anything:

- The name must match `^[a-z0-9][a-z0-9-]*$`. Reject spaces, uppercase, and
  dots — it becomes a filename, an id prefix, and a LangSmith dataset name.
- If `<location>/<name>.golden.csv` already exists, say so and offer to extend
  that dataset instead of creating a second one at the same path.
- Create the directory if it does not exist. Do not write outside the project.

Record the resolved name and location in `meta.md` so every later run and every
evaluation skill finds the same files.

Read the source first, derive the axes from what is actually in it, and present
them as a multi-select. Never present a generic list — the point is that the
user does not have to think from a blank page.

Header: `평가 항목`
Question: `무엇을 평가할까요? (여러 개 선택 가능)`

Each option is a short capability name plus one line saying what it checks, and
where that came from:

```
사실 조회       문서에 명시된 내용을 정확히 답하는가
범위 밖 거부    문서에 없는 걸 물으면 지어내지 않고 모른다고 하는가
수치·표 해석    표와 숫자를 정확히 읽는가
```

For code and tools sources, cite the line the rule came from:

```
출력 스키마 준수    { question, answer, source } 형태를 지키는가
                    근거: dataset.define.ts:18 (zod 스키마)
```

---

## Q4 — Target selection when the argument is omitted

Header: `대상 선택`
Question (dataset builders): `어느 것으로 데이터셋을 만들까요?`
Question (evaluators): `어느 데이터셋을 평가할까요?`

List what was actually found, with enough detail to tell the entries apart —
file counts for sources, case counts and last-evaluated date for datasets.
Always include `직접 경로 입력` as the last option.

---

## Q5 — Run confirmation

Before anything that executes commands, spends money, or writes to a shared
service. Show the exact command, the case count, and the repetition count in
the question text.

Header: `실행 확인`
Question: `이대로 실행할까요?`

| Label | Description |
| --- | --- |
| `진행` | `표시된 대로 실행합니다.` |
| `반복 3회로` | `케이스마다 3번 실행해 안정성까지 봅니다. 실행 횟수와 비용이 3배가 됩니다.` |
| `취소` | `실행하지 않습니다.` |

---

## Q6 — LangSmith dataset name collision

Only when a dataset with the same name already exists. Show its example count
and last-modified date in the question text.

Header: `이름 충돌`
Question: `같은 이름의 데이터셋이 이미 있습니다. 어떻게 할까요?`

| Label | Description |
| --- | --- |
| `이어서 추가` | `내가 전에 올린 것이 맞습니다. 여기에 붙입니다. 같은 id는 건너뛰고 달라진 것만 갱신합니다.` |
| `새 이름으로` | `다른 데이터셋입니다. 프로젝트 이름을 접두어로 붙여 새로 만듭니다.` |
| `취소` | `먼저 LangSmith에서 직접 확인하겠습니다.` |

Record the chosen name in `meta.md` and never ask again for that dataset.

---

## Q7 — Register npm scripts

Once, on first use of `upload` or `evaluate`, when the scripts are absent.

Header: `npm script`
Question: `package.json 에 실행 스크립트를 추가할까요?`

| Label | Description |
| --- | --- |
| `추가` | `golden:upload 과 golden:eval 두 줄을 추가합니다. 터미널에서 직접 실행할 수 있게 됩니다.` |
| `추가 안 함` | `추가하지 않습니다. 스킬이 node 명령을 직접 실행합니다. 동작에는 차이가 없습니다.` |
