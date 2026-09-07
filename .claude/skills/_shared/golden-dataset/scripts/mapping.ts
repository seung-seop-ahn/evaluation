import { GOLDEN_COLUMNS, splitList, type GoldenCase } from './csv.ts';

export type ExamplePayload = {
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
    metadata: Record<string, string>;
};

/** metadata 로 넘어가지 않고 inputs/outputs 로 승격되는 컬럼 */
const PROMOTED_COLUMNS = new Set(['question', 'answer', 'expected_tools']);

/**
 * 채점 정보는 metadata 에 둔다. outputs 에 넣으면 evaluator 가 그것까지
 * 정답의 일부로 취급해 채점이 어긋난다.
 */
export function toExample(goldenCase: GoldenCase): ExamplePayload {
    const metadata: Record<string, string> = {};

    GOLDEN_COLUMNS.forEach((column) => {
        if (PROMOTED_COLUMNS.has(column)) {
            return;
        }
        if (goldenCase[column] !== '') {
            metadata[column] = goldenCase[column];
        }
    });

    // id 는 중복 판정 키이므로 값이 비어 있어도 항상 남긴다
    metadata.id = goldenCase.id;

    const outputs: Record<string, unknown> = { answer: goldenCase.answer };
    const expectedTools = splitList(goldenCase.expected_tools);
    if (expectedTools.length > 0) {
        outputs.tools = expectedTools;
    }

    return {
        inputs: { question: goldenCase.question },
        outputs: outputs,
        metadata: metadata,
    };
}

/**
 * LangSmith example 을 다시 GoldenCase 로 되돌린다.
 * evaluator 는 example.metadata 만 받으므로 채점에 필요한 컬럼을 여기서 복원한다.
 */
export function fromExample(
    inputs: Record<string, unknown>,
    referenceOutputs: Record<string, unknown>,
    metadata: Record<string, unknown>,
): GoldenCase {
    const goldenCase = {} as GoldenCase;

    GOLDEN_COLUMNS.forEach((column) => {
        const value = metadata[column];
        goldenCase[column] = typeof value === 'string' ? value : '';
    });

    goldenCase.question = String(inputs.question ?? '');
    goldenCase.answer = String(referenceOutputs.answer ?? '');

    const tools = referenceOutputs.tools;
    goldenCase.expected_tools = Array.isArray(tools) ? tools.map(String).join(';') : '';

    return goldenCase;
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value) ?? 'null';
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
        left.localeCompare(right),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

export type RemoteExample = {
    id: string;
    inputs?: Record<string, unknown> | null;
    outputs?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
};

/** LangSmith 는 metadata 에 자체 키를 덧붙이므로 우리가 쓴 컬럼만 비교한다 */
export function isUnchanged(remote: RemoteExample, payload: ExamplePayload): boolean {
    if (stableStringify(remote.inputs ?? {}) !== stableStringify(payload.inputs)) {
        return false;
    }
    if (stableStringify(remote.outputs ?? {}) !== stableStringify(payload.outputs)) {
        return false;
    }

    const remoteMetadata = (remote.metadata ?? {}) as Record<string, unknown>;
    return Object.entries(payload.metadata).every(([key, value]) => remoteMetadata[key] === value);
}

export type RemoteIndex = {
    byCaseId: Map<string, RemoteExample>;
    byQuestion: Map<string, RemoteExample>;
    legacyCount: number;
};

/**
 * `metadata.id` 가 기본 키다.
 *
 * 다만 이 스킬 이전에 다른 스크립트로 올린 예제에는 그 필드가 없다. id 로만
 * 찾으면 그런 행이 보이지 않아 같은 질문이 중복 생성되므로, id 가 없는 예제는
 * 질문 문구로도 찾을 수 있게 해 둔다.
 */
export function indexRemoteExamples(examples: RemoteExample[]): RemoteIndex {
    const byCaseId = new Map<string, RemoteExample>();
    const byQuestion = new Map<string, RemoteExample>();
    let legacyCount = 0;

    examples.forEach((example) => {
        const caseId = (example.metadata ?? {}).id;
        if (typeof caseId === 'string' && caseId !== '') {
            byCaseId.set(caseId, example);
            return;
        }

        legacyCount += 1;
        const question = (example.inputs ?? {}).question;
        if (typeof question === 'string' && question !== '') {
            byQuestion.set(question.trim(), example);
        }
    });

    return { byCaseId: byCaseId, byQuestion: byQuestion, legacyCount: legacyCount };
}

export function findRemote(index: RemoteIndex, goldenCase: GoldenCase): RemoteExample | undefined {
    return index.byCaseId.get(goldenCase.id) ?? index.byQuestion.get(goldenCase.question.trim());
}
