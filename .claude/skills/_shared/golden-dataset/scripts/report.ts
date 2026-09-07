import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseCsv, stringifyCsv, type GoldenCase } from './csv.ts';
import { macroAverage, tallyBy, wilsonInterval, type SliceTally } from './judges.ts';

export type RunRecord = {
    goldenCase: GoldenCase;
    runIndex: number;
    answer: string;
    tools: string[];
    pass: boolean;
    reason: string;
    judgeScores: Record<string, number> | null;
};

export type SkippedCase = {
    id: string;
    reason: string;
};

const RUNS_COLUMNS = ['id', 'run_index', 'capability', 'case_type', 'verdict', 'answer', 'tools', 'reason', 'overall'];

export function renderRunsCsv(records: RunRecord[]): string {
    const rows = records.map((record) => [
        record.goldenCase.id,
        String(record.runIndex),
        record.goldenCase.capability,
        record.goldenCase.case_type,
        record.pass ? 'pass' : 'fail',
        record.answer,
        record.tools.join(';'),
        record.reason,
        record.judgeScores === null ? '' : String(record.judgeScores.overall ?? ''),
    ]);
    return stringifyCsv([RUNS_COLUMNS, ...rows]);
}

/** 케이스 하나가 k회 중 몇 번 통과했는지 */
type CaseSummary = {
    goldenCase: GoldenCase;
    passes: number;
    runs: number;
};

function summarizeByCase(records: RunRecord[]): CaseSummary[] {
    const summaries = new Map<string, CaseSummary>();

    records.forEach((record) => {
        const summary = summaries.get(record.goldenCase.id) ?? {
            goldenCase: record.goldenCase,
            passes: 0,
            runs: 0,
        };
        summary.runs += 1;
        if (record.pass) {
            summary.passes += 1;
        }
        summaries.set(record.goldenCase.id, summary);
    });

    return [...summaries.values()];
}

function percent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

function renderTally(title: string, tallies: SliceTally[]): string[] {
    return [
        `**${title}**`,
        '',
        '| 항목 | 통과 |',
        '|---|---|',
        ...tallies.map((tally) => `| ${tally.key} | ${tally.passes}/${tally.total} (${percent(tally.passes / tally.total)}) |`),
        '',
    ];
}

/**
 * 같은 reports/ 아래에 여러 데이터셋의 실행 기록이 섞이므로 반드시 이름으로 거른다.
 * 거르지 않으면 다른 데이터셋의 실행과 비교해 id가 전부 어긋나고,
 * 회귀 절이 "아무 문제 없음"처럼 보이게 된다.
 */
export async function readPreviousVerdicts(
    reportsDirectory: string,
    datasetName: string,
): Promise<Map<string, boolean> | null> {
    const entries = await readdir(reportsDirectory, { withFileTypes: true }).catch(() => null);
    if (entries === null) {
        return null;
    }

    const runDirectories = entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${datasetName}-`))
        .map((entry) => entry.name)
        .sort();

    const latest = runDirectories.at(-1);
    if (latest === undefined) {
        return null;
    }

    const text = await readFile(join(reportsDirectory, latest, 'runs.csv'), 'utf8').catch(() => null);
    if (text === null) {
        return null;
    }

    const rows = parseCsv(text).slice(1);
    const verdicts = new Map<string, boolean>();

    // 같은 id가 여러 번 나오면(k>1) 매번 통과했을 때만 통과로 본다
    rows.forEach((row) => {
        const id = row[0];
        const passed = row[4] === 'pass';
        verdicts.set(id, (verdicts.get(id) ?? true) && passed);
    });

    return verdicts;
}

const CASE_TYPE_ALIASES: Record<string, string> = {
    정상: 'happy',
    경계값: 'boundary',
    애매함: 'ambiguous',
    '범위 밖': 'out_of_scope',
    범위밖: 'out_of_scope',
    거부: 'out_of_scope',
    적대적: 'adversarial',
    회귀: 'regression',
};

/**
 * 기준 문장에서 임계값과 대상 슬라이스를 읽어 판정한다.
 * 어느 슬라이스를 말하는지 알 수 없으면 통과라고 단정하지 않고 수동 확인으로 남긴다.
 */
function judgeCriterion(criterion: string, overallRate: number, byCaseType: SliceTally[]): string {
    const threshold = criterion.match(/([\d.]+)\s*%/);
    if (threshold === null) {
        return '수동 확인 필요';
    }
    const target = Number(threshold[1]) / 100;

    const alias = Object.entries(CASE_TYPE_ALIASES).find(([korean]) => criterion.includes(korean));
    const caseType = alias?.[1] ?? byCaseType.find((tally) => criterion.includes(tally.key))?.key ?? null;

    const measured =
        caseType === null
            ? criterion.includes('전체')
                ? overallRate
                : null
            : (() => {
                  const tally = byCaseType.find((item) => item.key === caseType);
                  return tally === undefined ? null : tally.passes / tally.total;
              })();

    if (measured === null) {
        return '수동 확인 필요';
    }
    return `${percent(measured)} — ${measured >= target ? '통과' : '**미달**'}`;
}

export type ReportInput = {
    datasetName: string;
    purpose: string;
    runner: string;
    targetDescription: string;
    repetitions: number;
    records: RunRecord[];
    skipped: SkippedCase[];
    passCriteria: string[];
    /** LangSmith 실험 이름. URL 은 워크스페이스마다 달라 만들 수 없으므로 이름만 남긴다 */
    experimentName: string | null;
    selfJudged: boolean;
    previousVerdicts: Map<string, boolean> | null;
};

export function renderReport(input: ReportInput): string {
    const summaries = summarizeByCase(input.records);
    // k>1 이면 매번 통과한 것만 통과로 집계한다. 운으로 한 번 통과한 것을 통과로 세면 안 된다
    const caseVerdicts = summaries.map((summary) => ({
        goldenCase: summary.goldenCase,
        pass: summary.passes === summary.runs,
    }));

    const passed = caseVerdicts.filter((verdict) => verdict.pass).length;
    const total = caseVerdicts.length;
    const rate = total === 0 ? 0 : passed / total;
    const interval = wilsonInterval(passed, total);

    const byCapability = tallyBy(caseVerdicts, 'capability');
    const byCaseType = tallyBy(caseVerdicts, 'case_type');
    const macro = macroAverage(byCapability);

    const lines: string[] = [
        `# ${input.datasetName} 평가 결과 · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        '',
        `실행: ${input.runner}`,
        `대상: ${input.targetDescription}`,
        `케이스 ${total}건 × 반복 ${input.repetitions}회 · 채점 불가 ${input.skipped.length}건`,
        ...(input.experimentName === null
            ? []
            : [`LangSmith 실험: ${input.experimentName}  (Experiments 탭에서 이 이름으로 찾으세요)`]),
        '',
    ];

    if (input.selfJudged) {
        lines.push(
            '> 주의: 답변을 만든 쪽과 채점한 쪽이 같습니다. 관대해질 수 있는 조건이므로',
            '> 각 판정의 근거 인용을 함께 확인하시길 권합니다.',
            '',
        );
    }

    lines.push('## 1. 게이트 판정', '');
    if (input.passCriteria.length === 0) {
        lines.push(
            input.purpose.includes('약점')
                ? '통과 기준이 없는 데이터셋입니다. 약점을 찾는 것이 목적이므로 기준선을 두지 않습니다.'
                : 'meta.md 에 통과 기준이 없어 판정하지 못했습니다. 기준을 추가하면 여기에 표시됩니다.',
            '',
        );
    } else {
        lines.push(
            `측정값: 전체 통과율 ${percent(rate)}`,
            '',
            '| 기준 | 판정 |',
            '|---|---|',
            ...input.passCriteria.map((criterion) => `| ${criterion} | ${judgeCriterion(criterion, rate, byCaseType)} |`),
            '',
        );
    }

    lines.push('## 2. 회귀 (직전 실행 대비)', '');
    if (input.previousVerdicts === null) {
        lines.push('직전 실행 기록이 없어 비교를 건너뜁니다.', '');
    } else {
        const regressions = caseVerdicts.filter(
            (verdict) => input.previousVerdicts?.get(verdict.goldenCase.id) === true && !verdict.pass,
        );
        const fixes = caseVerdicts.filter(
            (verdict) => input.previousVerdicts?.get(verdict.goldenCase.id) === false && verdict.pass,
        );

        lines.push(
            '**새로 실패한 케이스** — 총점이 그대로여도 여기 뭔가 있으면 뭔가 깨진 것입니다.',
            '',
            ...(regressions.length === 0 ? ['없음', ''] : [...regressions.map((item) => `- ${item.goldenCase.id}`), '']),
            '**새로 통과한 케이스**',
            '',
            ...(fixes.length === 0 ? ['없음', ''] : [...fixes.map((item) => `- ${item.goldenCase.id}`), '']),
        );
    }

    lines.push(
        '## 3. 슬라이스별 통과율',
        '',
        `전체 ${percent(rate)} (${passed}/${total}), 95% 신뢰구간 [${percent(interval.low)}, ${percent(interval.high)}]`,
        '',
    );

    if (interval.high - interval.low > 0.2) {
        lines.push(
            `케이스가 ${total}개뿐이라 구간이 넓습니다. 이 수치로 몇 %p 차이를 논하는 것은 의미가 없습니다.`,
            '',
        );
    }

    lines.push(...renderTally('능력별', byCapability), ...renderTally('상황별', byCaseType));
    lines.push(`마이크로 평균 ${percent(rate)} / 매크로 평균 ${percent(macro)}`, '');

    if (Math.abs(rate - macro) > 0.05) {
        lines.push('칸별 케이스 수가 달라 작은 칸의 실패가 전체 평균에서 희석되고 있습니다.', '');
    }

    lines.push(...renderToolMetrics(input.records));
    lines.push(...renderRefusalMetrics(caseVerdicts));

    if (input.repetitions > 1) {
        const passAtK = summaries.filter((summary) => summary.passes > 0).length;
        const passPowK = summaries.filter((summary) => summary.passes === summary.runs).length;
        const flaky = summaries.filter((summary) => summary.passes > 0 && summary.passes < summary.runs);

        lines.push(
            `## 4. 반복 실행 안정성 (k=${input.repetitions})`,
            '',
            `pass@${input.repetitions} = ${percent(passAtK / total)}  한 번이라도 통과`,
            `pass^${input.repetitions} = ${percent(passPowK / total)}  매번 통과`,
            '',
            ...(flaky.length === 0
                ? ['불안정한 케이스는 없습니다.', '']
                : [
                      `차이 나는 ${flaky.length}건이 불안정한 케이스입니다. 믿을 수 없습니다:`,
                      flaky.map((summary) => summary.goldenCase.id).join(', '),
                      '',
                  ]),
        );
    }

    lines.push('## 5. 실패 상세', '');
    // 반복 실행해도 케이스당 한 번만 적는다. 같은 실패를 k번 나열하면 리포트를 읽을 수 없다
    const failedSummaries = summaries.filter((summary) => summary.passes < summary.runs);
    if (failedSummaries.length === 0) {
        lines.push('실패한 케이스가 없습니다.', '');
    } else {
        failedSummaries.forEach((summary) => {
            const sample = input.records.find(
                (record) => record.goldenCase.id === summary.goldenCase.id && !record.pass,
            );
            const failureCount = summary.runs - summary.passes;

            lines.push(
                `### ${summary.goldenCase.id} · 실패 · 원인: 미분류`,
                '',
                `질문: ${summary.goldenCase.question}`,
                `기대: ${summary.goldenCase.answer}`,
                `실제: ${sample?.answer ?? ''}`,
                `판정 근거: ${sample?.reason ?? ''}`,
                ...(summary.runs > 1 ? [`${summary.runs}회 중 ${failureCount}회 실패`] : []),
                '',
                '→ 원인을 시스템 결함 / 케이스 오류 / 채점 기준 모호 중 하나로 분류하세요.',
                '',
            );
        });
    }

    lines.push('## 6. 채점하지 못한 케이스', '');
    lines.push(
        ...(input.skipped.length === 0
            ? ['없음', '']
            : [
                  '| id | 사유 |',
                  '|---|---|',
                  ...input.skipped.map((item) => `| ${item.id} | ${item.reason} |`),
                  '',
              ]),
    );

    lines.push(
        '---',
        '',
        '원본 출력은 `runs.csv` 에 있습니다. 리포트만으로 부족할 때 보세요.',
        '',
        '**점수 100%는 목표가 아닙니다.** 만점은 이 골든셋이 이미 시스템에 맞춰졌다는',
        '신호이고, 그때부터는 범위 밖의 문제를 경고해 주지 못합니다.',
        '',
    );

    return lines.join('\n');
}

function renderToolMetrics(records: RunRecord[]): string[] {
    const toolRecords = records.filter((record) => record.goldenCase.trajectory_rule !== '');
    if (toolRecords.length === 0) {
        return [];
    }

    const noToolRecords = toolRecords.filter((record) => record.goldenCase.trajectory_rule === 'no_tool');
    const unnecessary = noToolRecords.filter((record) => record.tools.length > 0).length;

    const orderRecords = toolRecords.filter((record) =>
        ['exact_sequence', 'subsequence'].includes(record.goldenCase.trajectory_rule),
    );
    const orderMatched = orderRecords.filter((record) => record.pass).length;

    return [
        '**tool 지표**',
        '',
        ...(orderRecords.length === 0
            ? []
            : [`트래젝토리 정확 일치 ${percent(orderMatched / orderRecords.length)}`]),
        ...(noToolRecords.length === 0
            ? []
            : [`불필요 호출률 ${percent(unnecessary / noToolRecords.length)}  (${unnecessary}/${noToolRecords.length})`]),
        '',
    ];
}

function renderRefusalMetrics(caseVerdicts: { goldenCase: GoldenCase; pass: boolean }[]): string[] {
    const outOfScope = caseVerdicts.filter((verdict) => verdict.goldenCase.case_type === 'out_of_scope');
    if (outOfScope.length === 0) {
        return [];
    }

    const refused = outOfScope.filter((verdict) => verdict.pass).length;
    return [
        '**거부·환각**',
        '',
        `올바로 거부 ${percent(refused / outOfScope.length)} (${refused}/${outOfScope.length}) · 지어냄 ${percent(1 - refused / outOfScope.length)}`,
        '',
    ];
}
