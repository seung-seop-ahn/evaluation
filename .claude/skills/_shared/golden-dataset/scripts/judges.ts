import { splitList, type GoldenCase } from './csv.ts';

export type Verdict = {
    pass: boolean;
    reason: string;
};

const DEFAULT_JUDGE_THRESHOLD = 4;

function normalize(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function readSpecNumber(spec: string, key: string): number | null {
    const found = spec.match(new RegExp(`${key}\\s*=\\s*([0-9.]+)`));
    return found === null ? null : Number(found[1]);
}

/**
 * llm_judge 를 제외한 채점. llm_judge 는 모델 호출이 필요하므로 여기서 다루지 않고
 * null 을 돌려 호출한 쪽이 판단하게 한다.
 */
export function gradeMechanical(goldenCase: GoldenCase, actual: string): Verdict | null {
    const expected = goldenCase.answer;
    const spec = goldenCase.grading_spec;

    switch (goldenCase.grading_mode) {
        case 'exact': {
            const pass = normalize(actual) === normalize(expected);
            return { pass: pass, reason: pass ? 'exact match' : `expected "${expected}", got "${actual}"` };
        }

        case 'contains': {
            const pass = normalize(actual).includes(normalize(expected));
            return { pass: pass, reason: pass ? `contains "${expected}"` : `"${expected}" not found in output` };
        }

        case 'numeric': {
            const expectedNumber = Number(expected.replace(/[^0-9.\-]/g, ''));
            const actualNumber = Number(actual.replace(/[^0-9.\-]/g, ''));
            if (Number.isNaN(expectedNumber) || Number.isNaN(actualNumber)) {
                return { pass: false, reason: `could not read a number from "${actual}"` };
            }
            const tolerance = readSpecNumber(spec, 'tolerance') ?? 0;
            const gap = Math.abs(expectedNumber - actualNumber);
            return {
                pass: gap <= tolerance,
                reason: `expected ${expectedNumber}, got ${actualNumber} (gap ${gap}, tolerance ${tolerance})`,
            };
        }

        case 'regex': {
            const pass = new RegExp(spec).test(actual);
            return { pass: pass, reason: pass ? `matched /${spec}/` : `did not match /${spec}/` };
        }

        case 'set_equal': {
            const expectedSet = new Set(splitList(expected));
            const actualSet = new Set(splitList(actual));
            const pass = expectedSet.size === actualSet.size && [...expectedSet].every((item) => actualSet.has(item));
            return { pass: pass, reason: `expected {${[...expectedSet]}}, got {${[...actualSet]}}` };
        }

        case 'sequence': {
            const expectedList = splitList(expected);
            const actualList = splitList(actual);
            const pass =
                expectedList.length === actualList.length &&
                expectedList.every((item, index) => item === actualList[index]);
            return { pass: pass, reason: `expected [${expectedList}], got [${actualList}]` };
        }

        default:
            return null;
    }
}

export type ToolScore = {
    pass: boolean;
    reason: string;
    precision: number;
    recall: number;
    f1: number;
    orderChecked: boolean;
    orderMatched: boolean;
    unnecessaryCall: boolean;
};

function isSubsequence(expected: string[], actual: string[]): boolean {
    let cursor = 0;
    actual.forEach((tool) => {
        if (cursor < expected.length && expected[cursor] === tool) {
            cursor += 1;
        }
    });
    return cursor === expected.length;
}

export function gradeTrajectory(goldenCase: GoldenCase, actualTools: string[]): ToolScore {
    const expectedTools = splitList(goldenCase.expected_tools);
    const expectedSet = new Set(expectedTools);
    const actualSet = new Set(actualTools);
    const overlap = [...expectedSet].filter((tool) => actualSet.has(tool)).length;

    const precision = actualSet.size === 0 ? 1 : overlap / actualSet.size;
    const recall = expectedSet.size === 0 ? 1 : overlap / expectedSet.size;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

    const base = {
        precision: precision,
        recall: recall,
        f1: f1,
        orderChecked: false,
        orderMatched: false,
        unnecessaryCall: false,
    };

    switch (goldenCase.trajectory_rule) {
        case 'no_tool': {
            const calledAnything = actualTools.length > 0;
            return {
                ...base,
                pass: !calledAnything,
                unnecessaryCall: calledAnything,
                reason: calledAnything ? `expected no tool call, got [${actualTools}]` : 'no tool called, as expected',
            };
        }

        case 'exact_sequence': {
            const matched =
                expectedTools.length === actualTools.length &&
                expectedTools.every((tool, index) => tool === actualTools[index]);
            return {
                ...base,
                pass: matched,
                orderChecked: true,
                orderMatched: matched,
                reason: `expected [${expectedTools}] in order, got [${actualTools}]`,
            };
        }

        case 'subsequence': {
            const matched = isSubsequence(expectedTools, actualTools);
            return {
                ...base,
                pass: matched,
                orderChecked: true,
                orderMatched: matched,
                reason: `expected [${expectedTools}] as a subsequence, got [${actualTools}]`,
            };
        }

        case 'set_equal':
        default: {
            const matched = expectedSet.size === actualSet.size && overlap === expectedSet.size;
            return {
                ...base,
                pass: matched,
                reason: `expected {${expectedTools}} in any order, got {${actualTools}}`,
            };
        }
    }
}

export const JUDGE_AXES = ['correctness', 'groundedness', 'completeness', 'conciseness', 'overall'] as const;

export type JudgeScore = Record<(typeof JUDGE_AXES)[number], number> & { evidence: string };

export function judgeThreshold(goldenCase: GoldenCase): number {
    return readSpecNumber(goldenCase.grading_spec, 'threshold') ?? DEFAULT_JUDGE_THRESHOLD;
}

export function buildJudgePrompt(goldenCase: GoldenCase, actual: string): string {
    return [
        'You are grading one case from a golden dataset.',
        '',
        'Apply the rubric exactly as written. Do not substitute your own idea of a',
        'good answer. Score each axis from 1 to 5.',
        '',
        `RUBRIC: ${goldenCase.grading_spec}`,
        '',
        `QUESTION: ${goldenCase.question}`,
        `EXPECTED: ${goldenCase.answer}`,
        goldenCase.source_quote === '' ? '' : `EVIDENCE: ${goldenCase.source_quote}`,
        `ACTUAL OUTPUT: ${actual}`,
        '',
        'Respond with JSON only:',
        '{"correctness":N,"groundedness":N,"completeness":N,"conciseness":N,"overall":N,',
        ' "evidence":"a short direct quotation from the actual output that justifies the overall score"}',
    ]
        .filter((line) => line !== '')
        .join('\n');
}

export function parseJudgeResponse(raw: string): JudgeScore {
    const found = raw.match(/\{[\s\S]*\}/);
    if (found === null) {
        throw new Error(`Judge did not return JSON: ${raw.slice(0, 200)}`);
    }
    const parsed = JSON.parse(found[0]) as Partial<JudgeScore>;

    const score = { evidence: parsed.evidence ?? '' } as JudgeScore;
    JUDGE_AXES.forEach((axis) => {
        score[axis] = Number(parsed[axis] ?? 0);
    });

    if (score.evidence === '') {
        throw new Error('Judge returned no evidence quotation. A verdict without evidence is not reviewable.');
    }
    return score;
}

export type Interval = {
    low: number;
    high: number;
};

/**
 * Wilson 95% 신뢰구간. 케이스가 20~30개면 통과율 오차가 커서
 * 구간 없이 몇 %p 차이를 개선이라 부르면 노이즈를 성과로 착각한다.
 */
export function wilsonInterval(passes: number, total: number): Interval {
    if (total === 0) {
        return { low: 0, high: 0 };
    }

    const z = 1.96;
    const proportion = passes / total;
    const denominator = 1 + (z * z) / total;
    const centre = (proportion + (z * z) / (2 * total)) / denominator;
    const spread =
        (z * Math.sqrt((proportion * (1 - proportion)) / total + (z * z) / (4 * total * total))) / denominator;

    return { low: Math.max(0, centre - spread), high: Math.min(1, centre + spread) };
}

export type SliceTally = {
    key: string;
    passes: number;
    total: number;
};

export function tallyBy(
    results: { pass: boolean; goldenCase: GoldenCase }[],
    column: 'capability' | 'case_type',
): SliceTally[] {
    const tallies = new Map<string, SliceTally>();

    results.forEach(({ pass, goldenCase }) => {
        const key = goldenCase[column];
        const tally = tallies.get(key) ?? { key: key, passes: 0, total: 0 };
        tally.total += 1;
        if (pass) {
            tally.passes += 1;
        }
        tallies.set(key, tally);
    });

    return [...tallies.values()].sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * 칸별 통과율의 단순 평균. 칸마다 케이스 수가 다르면 마이크로 평균은
 * 큰 칸에 지배당해 작은 칸의 실패를 숨긴다.
 */
export function macroAverage(tallies: SliceTally[]): number {
    if (tallies.length === 0) {
        return 0;
    }
    const sum = tallies.reduce((total, tally) => total + tally.passes / tally.total, 0);
    return sum / tallies.length;
}
