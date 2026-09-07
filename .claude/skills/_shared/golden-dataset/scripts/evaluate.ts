import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { formatErrors, readGoldenCsv, type GoldenCase } from './csv.ts';
import {
    buildJudgePrompt,
    gradeMechanical,
    gradeTrajectory,
    judgeThreshold,
    parseJudgeResponse,
} from './judges.ts';
import { listDatasets, resolveDataset, timestamp } from './locate.ts';
import { fromExample } from './mapping.ts';
import { readMeta } from './meta.ts';
import { readPreviousVerdicts, renderReport, renderRunsCsv, type RunRecord, type SkippedCase } from './report.ts';
import { buildTarget, describeTarget, type Target } from './target.ts';

const USAGE = `
golden dataset evaluate — LangSmith 실험을 실행하고 리포트를 만듭니다

  --dataset <이름>   평가할 데이터셋 (예: nist-policy). 생략하면 목록만 보여줍니다
  --k <횟수>         케이스마다 반복 실행할 횟수. 기본은 meta.md 의 값
  --local            LangSmith 실험 없이 로컬에서만 실행합니다
  --yes              비용 확인을 건너뛰고 바로 실행합니다
  --root <경로>      탐색 시작 경로 (기본: 현재 디렉토리)
  --help             이 도움말

--yes 없이 실행하면 예상 호출 수만 알리고 멈춥니다.
LangSmith 실험은 먼저 upload 로 데이터셋을 올려두어야 실행됩니다.
`.trim();

type Args = {
    dataset: string | null;
    repetitions: number | null;
    local: boolean;
    yes: boolean;
    root: string;
    help: boolean;
};

function parseArgs(argv: string[]): Args {
    const args: Args = {
        dataset: null,
        repetitions: null,
        local: false,
        yes: false,
        root: process.cwd(),
        help: false,
    };

    argv.forEach((token, index) => {
        const next = argv[index + 1];
        if (token === '--dataset') args.dataset = next ?? null;
        if (token === '--k' && next !== undefined) args.repetitions = Number(next);
        if (token === '--root' && next !== undefined) args.root = resolve(next);
        if (token === '--local') args.local = true;
        if (token === '--yes' || token === '-y') args.yes = true;
        if (token === '--help' || token === '-h') args.help = true;
    });

    return args;
}

async function buildJudge(modelName: string) {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error(
            [
                '.env 에 OPENAI_API_KEY 가 없습니다. llm_judge 케이스를 채점하려면 필요합니다.',
                '',
                '  OPENAI_API_KEY=sk-...',
            ].join('\n'),
        );
    }

    const { ChatOpenAI } = await import('@langchain/openai');
    const model = new ChatOpenAI({ model: modelName, temperature: 0 });

    return async (goldenCase: GoldenCase, actual: string) => {
        const reply = await model.invoke(buildJudgePrompt(goldenCase, actual));
        const score = parseJudgeResponse(String(reply.content));
        return {
            pass: score.overall >= judgeThreshold(goldenCase),
            reason: `overall ${score.overall}/5 — "${score.evidence}"`,
            scores: score as unknown as Record<string, number>,
        };
    };
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
        console.log(USAGE);
        return;
    }

    if (args.dataset === null) {
        const available = await listDatasets(args.root);
        console.log(
            available.length === 0
                ? 'golden.csv 파일을 찾지 못했습니다. 먼저 데이터셋을 만들어 주세요.'
                : ['어느 데이터셋을 평가할까요? --dataset 으로 지정하세요.', '', ...available.map((paths) => `  ${paths.name}  (${paths.goldenCsv})`)].join('\n'),
        );
        return;
    }

    const paths = await resolveDataset(args.root, args.dataset);
    const { cases, errors } = await readGoldenCsv(paths.goldenCsv);

    if (errors.length > 0) {
        console.error(`스키마 검증 실패 — ${errors.length}건. 평가하지 않았습니다.\n`);
        console.error(formatErrors(errors));
        process.exit(1);
    }

    const meta = await readMeta(paths.meta);
    const repetitions = args.repetitions ?? meta.repetitions;

    const skipped: SkippedCase[] = [];
    const gradable: GoldenCase[] = [];

    cases.forEach((goldenCase) => {
        if (goldenCase.status !== 'active') {
            return;
        }
        // 방식 B 는 실제 tool 호출이 일어나지 않아 트래젝토리를 측정할 수 없다
        if (meta.targetMode === 'B' && goldenCase.expected_tools !== '') {
            skipped.push({ id: goldenCase.id, reason: 'tool 호출이 필요한 케이스인데 방식 B로 실행됨' });
            return;
        }
        gradable.push(goldenCase);
    });

    const judgeCases = gradable.filter((goldenCase) => goldenCase.grading_mode === 'llm_judge');
    const targetCalls = gradable.length * repetitions;
    const judgeCalls = judgeCases.length * repetitions;

    console.log(`데이터셋 ${paths.name} · ${describeTarget(meta)}`);
    console.log('');
    console.log(`  케이스 ${gradable.length} × 반복 ${repetitions} = ${targetCalls}회 실행`);
    if (judgeCalls > 0) {
        console.log(`  llm_judge 케이스 ${judgeCases.length}건 → 채점 호출 ${judgeCalls}회 추가`);
    }
    console.log(`  예상 모델 호출 총 ${targetCalls + judgeCalls}회`);
    if (skipped.length > 0) {
        console.log(`  채점 불가 ${skipped.length}건 (사유는 리포트에 기록됩니다)`);
    }
    console.log('');

    if (!args.yes) {
        console.log('실행하려면 --yes 를 붙여 다시 실행하세요. 아직 아무것도 실행하지 않았습니다.');
        return;
    }

    const target = await buildTarget(meta);
    const judge = judgeCases.length > 0 ? await buildJudge(meta.targetModel ?? 'gpt-4o-mini') : null;
    const records: RunRecord[] = [];

    const useLangsmith = !args.local && meta.langsmithDataset !== null && Boolean(process.env.LANGSMITH_API_KEY);
    let experimentName: string | null = null;

    if (useLangsmith) {
        experimentName = await runLangsmithExperiment({
            datasetName: meta.langsmithDataset as string,
            prefix: paths.name,
            repetitions: repetitions,
            target: target,
            judge: judge,
            records: records,
            gradable: gradable,
            skipped: skipped,
        });
    } else {
        if (!args.local && meta.langsmithDataset === null) {
            console.log('meta.md 에 LangSmith 데이터셋 이름이 없어 로컬로만 실행합니다.');
            console.log('실험을 남기려면 먼저 /my-golden-dataset-upload 로 올려 주세요.\n');
        }
        await runLocally({ gradable, repetitions, target, judge, records });
    }

    const runDirectory = join(paths.reportsDirectory, `${paths.name}-${timestamp()}`);
    const previousVerdicts = await readPreviousVerdicts(paths.reportsDirectory, paths.name);
    await mkdir(runDirectory, { recursive: true });

    const report = renderReport({
        datasetName: paths.name,
        purpose: meta.purpose,
        runner: `${useLangsmith ? 'langsmith-evaluate' : 'local-evaluate'} (${meta.targetMode === 'B' ? '방식 B' : '방식 A'})`,
        targetDescription: describeTarget(meta),
        repetitions: repetitions,
        records: records,
        skipped: skipped,
        passCriteria: meta.passCriteria,
        experimentName: experimentName,
        selfJudged: meta.targetMode === 'B',
        previousVerdicts: previousVerdicts,
    });

    await writeFile(join(runDirectory, 'report.md'), report, 'utf8');
    await writeFile(join(runDirectory, 'runs.csv'), renderRunsCsv(records), 'utf8');

    console.log('');
    if (experimentName !== null) {
        console.log(`LangSmith 실험: ${experimentName}`);
    }
    console.log(`리포트: ${join(runDirectory, 'report.md')}`);
    console.log(`원본 출력: ${join(runDirectory, 'runs.csv')}`);
}

type RunContext = {
    repetitions: number;
    target: Target;
    judge: JudgeFn | null;
    records: RunRecord[];
};

async function runLocally(context: RunContext & { gradable: GoldenCase[] }): Promise<void> {
    for (let runIndex = 1; runIndex <= context.repetitions; runIndex += 1) {
        for (const goldenCase of context.gradable) {
            const output = await runTarget(context.target, goldenCase.question);
            context.records.push({
                goldenCase: goldenCase,
                runIndex: runIndex,
                answer: output.answer,
                tools: output.tools,
                ...(await grade(goldenCase, output, context.judge)),
            });
        }
        console.log(`  ${runIndex}/${context.repetitions} 회차 완료`);
    }
}

/**
 * LangSmith 실험으로 실행한다.
 *
 * 원격 데이터셋을 그대로 돌리지 않고 로컬에서 채점 대상으로 고른 것만 넘긴다.
 * 업로드는 예제를 지우지 않으므로, 그 뒤 로컬에서 은퇴시킨 케이스가 원격에는 남아
 * 있다. 그대로 두면 채점되지 않아야 할 케이스가 점수에 들어간다.
 */
async function runLangsmithExperiment(
    context: RunContext & {
        datasetName: string;
        prefix: string;
        gradable: GoldenCase[];
        skipped: SkippedCase[];
    },
): Promise<string | null> {
    const { Client } = await import('langsmith');
    const { evaluate } = await import('langsmith/evaluation');

    const gradableById = new Map(context.gradable.map((goldenCase) => [goldenCase.id, goldenCase]));
    const client = new Client();
    const selected: unknown[] = [];

    for await (const example of client.listExamples({ datasetName: context.datasetName })) {
        const caseId = String((example.metadata ?? {}).id ?? '');
        if (gradableById.has(caseId)) {
            selected.push(example);
            gradableById.delete(caseId);
            continue;
        }
        context.skipped.push({
            id: caseId === '' ? '(id 없음)' : caseId,
            reason: '원격에는 있으나 로컬에서 채점 대상이 아님 (은퇴·재검증 대기 등)',
        });
    }

    // 로컬에는 있는데 원격에 없는 케이스. 승격 후 업로드를 안 했다는 뜻
    gradableById.forEach((_, caseId) => {
        context.skipped.push({ id: caseId, reason: '아직 LangSmith에 올라가지 않음 — upload 후 다시 실행하세요' });
    });

    if (selected.length === 0) {
        throw new Error('LangSmith 데이터셋에 채점할 예제가 없습니다. 먼저 upload 를 실행해 주세요.');
    }

    console.log(`  LangSmith 예제 ${selected.length}건으로 실험을 실행합니다.`);

    const runCounts = new Map<string, number>();
    const results = await evaluate(
        async (inputs: Record<string, any>) => runTarget(context.target, String(inputs.question)),
        {
            data: selected as never,
            experimentPrefix: context.prefix,
            numRepetitions: context.repetitions,
            evaluators: [
                async (args: { inputs: Record<string, any>; outputs: Record<string, any>; example: any }) => {
                    const goldenCase = fromExample(
                        args.inputs,
                        (args.example?.outputs ?? {}) as Record<string, unknown>,
                        (args.example?.metadata ?? {}) as Record<string, unknown>,
                    );
                    const output = {
                        answer: String(args.outputs.answer ?? ''),
                        tools: Array.isArray(args.outputs.tools) ? args.outputs.tools.map(String) : [],
                    };
                    const verdict = await grade(goldenCase, output, context.judge);

                    const runIndex = (runCounts.get(goldenCase.id) ?? 0) + 1;
                    runCounts.set(goldenCase.id, runIndex);
                    context.records.push({
                        goldenCase: goldenCase,
                        runIndex: runIndex,
                        answer: output.answer,
                        tools: output.tools,
                        ...verdict,
                    });

                    return { key: 'golden', score: verdict.pass, comment: verdict.reason };
                },
            ],
        },
    );

    return results.experimentName;
}

async function runTarget(target: Target, question: string): Promise<{ answer: string; tools: string[] }> {
    return target(question).catch((error: unknown) => ({
        answer: `실행 실패: ${String(error)}`,
        tools: [] as string[],
    }));
}

type JudgeFn = (
    goldenCase: GoldenCase,
    actual: string,
) => Promise<{ pass: boolean; reason: string; scores: Record<string, number> }>;

async function grade(
    goldenCase: GoldenCase,
    output: { answer: string; tools: string[] },
    judge: JudgeFn | null,
): Promise<Pick<RunRecord, 'pass' | 'reason' | 'judgeScores'>> {
    // tool 케이스는 답변보다 호출 궤적이 판정 대상이다
    if (goldenCase.trajectory_rule !== '') {
        const score = gradeTrajectory(goldenCase, output.tools);
        return { pass: score.pass, reason: score.reason, judgeScores: null };
    }

    const mechanical = gradeMechanical(goldenCase, output.answer);
    if (mechanical !== null) {
        return { pass: mechanical.pass, reason: mechanical.reason, judgeScores: null };
    }

    if (judge === null) {
        return { pass: false, reason: 'llm_judge 케이스인데 채점기를 만들지 못했습니다.', judgeScores: null };
    }

    const verdict = await judge(goldenCase, output.answer).catch((error: unknown) => ({
        pass: false,
        reason: `채점 실패: ${String(error)}`,
        scores: {} as Record<string, number>,
    }));

    return { pass: verdict.pass, reason: verdict.reason, judgeScores: verdict.scores };
}

await main();
