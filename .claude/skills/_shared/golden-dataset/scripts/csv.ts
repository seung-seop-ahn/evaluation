import { readFile, writeFile } from 'node:fs/promises';

export const GOLDEN_COLUMNS = [
    'id',
    'question',
    'answer',
    'source',
    'source_quote',
    'source_rev',
    'entrypoint',
    'capability',
    'case_type',
    'grading_mode',
    'grading_spec',
    'expected_tools',
    'expected_args',
    'trajectory_rule',
    'method',
    'status',
    'verified_at',
    'note',
] as const;

export type GoldenColumn = (typeof GOLDEN_COLUMNS)[number];
export type GoldenCase = Record<GoldenColumn, string>;

export const CASE_TYPES = ['happy', 'boundary', 'ambiguous', 'out_of_scope', 'adversarial', 'regression'];
export const GRADING_MODES = ['exact', 'contains', 'numeric', 'regex', 'set_equal', 'sequence', 'llm_judge'];
export const TRAJECTORY_RULES = ['exact_sequence', 'subsequence', 'set_equal', 'no_tool'];
export const METHODS = ['manual', 'generated', 'promoted_from_log'];
export const STATUSES = ['active', 'needs_review', 'retired'];

const ID_PATTERN = /^[a-z0-9_]+-\d{3}$/;

export type ValidationError = {
    row: number;
    id: string;
    message: string;
};

/**
 * RFC 4180 파싱. 인용부호 안의 쉼표, 줄바꿈, 이중 인용부호를 처리한다.
 * 외부 의존성을 늘리지 않으려고 직접 구현했다.
 */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    let index = 0;

    const endField = () => {
        row.push(field);
        field = '';
    };

    const endRow = () => {
        endField();
        rows.push(row);
        row = [];
    };

    while (index < text.length) {
        const char = text[index];

        if (inQuotes) {
            if (char === '"') {
                if (text[index + 1] === '"') {
                    field += '"';
                    index += 2;
                    continue;
                }
                inQuotes = false;
                index += 1;
                continue;
            }
            field += char;
            index += 1;
            continue;
        }

        if (char === '"') {
            inQuotes = true;
            index += 1;
            continue;
        }

        if (char === ',') {
            endField();
            index += 1;
            continue;
        }

        if (char === '\r' && text[index + 1] === '\n') {
            endRow();
            index += 2;
            continue;
        }

        if (char === '\n' || char === '\r') {
            endRow();
            index += 1;
            continue;
        }

        field += char;
        index += 1;
    }

    // 파일이 줄바꿈으로 끝나면 빈 행이 생기므로 내용이 있을 때만 닫는다
    if (field.length > 0 || row.length > 0) {
        endRow();
    }

    return rows;
}

function escapeField(value: string): string {
    if (/[",\r\n]/.test(value)) {
        return `"${value.replaceAll('"', '""')}"`;
    }
    return value;
}

export function stringifyCsv(rows: string[][]): string {
    return rows.map((row) => row.map(escapeField).join(',')).join('\n') + '\n';
}

export function toRow(goldenCase: GoldenCase): string[] {
    return GOLDEN_COLUMNS.map((column) => goldenCase[column] ?? '');
}

export function serializeGoldenCases(cases: GoldenCase[]): string {
    return stringifyCsv([[...GOLDEN_COLUMNS], ...cases.map(toRow)]);
}

export async function writeGoldenCsv(path: string, cases: GoldenCase[]): Promise<void> {
    await writeFile(path, serializeGoldenCases(cases), 'utf8');
}

export type LoadResult = {
    cases: GoldenCase[];
    errors: ValidationError[];
};

export async function readGoldenCsv(path: string): Promise<LoadResult> {
    const text = await readFile(path, 'utf8');
    const rows = parseCsv(text);

    if (rows.length === 0) {
        return { cases: [], errors: [{ row: 0, id: '', message: 'File is empty.' }] };
    }

    const header = rows[0];
    const headerError = validateHeader(header);
    if (headerError !== null) {
        return { cases: [], errors: [headerError] };
    }

    const cases = rows.slice(1).map(rowToCase);
    return { cases, errors: validateCases(cases) };
}

function validateHeader(header: string[]): ValidationError | null {
    const expected = GOLDEN_COLUMNS.join(',');
    const actual = header.join(',');

    if (actual === expected) {
        return null;
    }

    return {
        row: 1,
        id: '',
        message: `Header does not match the fixed schema.\n  expected: ${expected}\n  actual:   ${actual}`,
    };
}

function rowToCase(row: string[]): GoldenCase {
    const goldenCase = {} as GoldenCase;
    GOLDEN_COLUMNS.forEach((column, columnIndex) => {
        goldenCase[column] = (row[columnIndex] ?? '').trim();
    });
    return goldenCase;
}

/** schema.md 의 검증 규칙 10가지. 위반은 경고가 아니라 오류로 다룬다. */
export function validateCases(cases: GoldenCase[]): ValidationError[] {
    const errors: ValidationError[] = [];
    const seenIds = new Set<string>();

    cases.forEach((goldenCase, caseIndex) => {
        // 헤더가 1행이므로 데이터 첫 행은 2행
        const row = caseIndex + 2;
        const report = (message: string) => errors.push({ row: row, id: goldenCase.id, message: message });

        if (goldenCase.id === '') {
            report('id is empty.');
        } else if (!ID_PATTERN.test(goldenCase.id)) {
            report(`id "${goldenCase.id}" must look like <capability>-<3 digits>, e.g. fact_lookup-007.`);
        } else if (seenIds.has(goldenCase.id)) {
            report(`id "${goldenCase.id}" is duplicated.`);
        } else {
            seenIds.add(goldenCase.id);
        }

        if (goldenCase.question === '') {
            report('question is empty.');
        }
        if (goldenCase.answer === '') {
            report('answer is empty.');
        }

        assertEnum(goldenCase.case_type, CASE_TYPES, 'case_type', report);
        assertEnum(goldenCase.grading_mode, GRADING_MODES, 'grading_mode', report);
        assertEnum(goldenCase.method, METHODS, 'method', report);
        assertEnum(goldenCase.status, STATUSES, 'status', report);

        if (goldenCase.grading_mode === 'llm_judge' && goldenCase.grading_spec === '') {
            report('grading_mode is llm_judge but grading_spec has no rubric.');
        }

        if (goldenCase.grading_mode === 'regex') {
            try {
                new RegExp(goldenCase.grading_spec);
            } catch {
                report(`grading_spec is not a valid regular expression: ${goldenCase.grading_spec}`);
            }
        }

        const hasExpectedTools = goldenCase.expected_tools !== '';
        if (hasExpectedTools) {
            if (goldenCase.trajectory_rule === '') {
                report('expected_tools is set but trajectory_rule is empty.');
            } else if (goldenCase.trajectory_rule === 'no_tool') {
                report('trajectory_rule is no_tool but expected_tools is not empty.');
            }
        }

        if (goldenCase.trajectory_rule !== '') {
            assertEnum(goldenCase.trajectory_rule, TRAJECTORY_RULES, 'trajectory_rule', report);
        }

        if (goldenCase.status === 'active' && goldenCase.verified_at === '') {
            report('status is active but verified_at is empty. An unverified case must not be active.');
        }

        if (goldenCase.expected_args !== '') {
            try {
                JSON.parse(goldenCase.expected_args);
            } catch {
                report(`expected_args is not valid JSON: ${goldenCase.expected_args}`);
            }
        }
    });

    return errors;
}

function assertEnum(
    value: string,
    allowed: string[],
    columnName: string,
    report: (message: string) => void,
): void {
    if (!allowed.includes(value)) {
        report(`${columnName} "${value}" is not one of: ${allowed.join(', ')}`);
    }
}

export function splitList(value: string): string[] {
    if (value === '') {
        return [];
    }
    return value
        .split(';')
        .map((item) => item.trim())
        .filter((item) => item !== '');
}

export function formatErrors(errors: ValidationError[]): string {
    return errors
        .map((error) => {
            const label = error.id === '' ? `row ${error.row}` : `row ${error.row} (${error.id})`;
            return `  ${label}: ${error.message}`;
        })
        .join('\n');
}
