import { readFile, writeFile } from 'node:fs/promises';

/**
 * meta.md 는 스킬이 템플릿으로 생성하므로 형식이 정해져 있다.
 * 일반적인 마크다운 파서 대신 필요한 줄만 읽는다.
 */
export type DatasetMeta = {
    purpose: string;
    passCriteria: string[];
    langsmithDataset: string | null;
    firstUploadedAt: string | null;
    targetMode: 'A' | 'B' | null;
    targetCommand: string | null;
    targetPrompt: string | null;
    targetModel: string | null;
    repetitions: number;
};

const FIELD_PATTERNS = {
    langsmithDataset: /^-\s*데이터셋 이름:\s*(.+)$/m,
    firstUploadedAt: /^-\s*첫 업로드:\s*(.+)$/m,
    targetMode: /^-\s*방식:\s*(.+)$/m,
    targetCommand: /^-\s*명령:\s*(.+)$/m,
    targetPrompt: /^-\s*프롬프트:\s*(.+)$/m,
    targetModel: /^-\s*모델:\s*(.+)$/m,
    repetitions: /^-\s*반복 기본값:\s*k=(\d+)/m,
};

function matchField(text: string, pattern: RegExp): string | null {
    const found = text.match(pattern);
    if (found === null) {
        return null;
    }
    const value = found[1].trim();
    // 템플릿의 미기입 자리표시자는 값이 없는 것으로 취급한다
    if (value === '' || value.startsWith('{')) {
        return null;
    }
    return value;
}

/**
 * `## 제목` 아래 다음 제목까지의 본문.
 * 파일 끝을 `(?![\s\S])` 로 잡는다 — JS 에는 `\z` 앵커가 없어서,
 * 그 절이 파일의 마지막이면 본문을 통째로 놓친다.
 */
function sectionBody(text: string, heading: string): string {
    const found = text.match(new RegExp(`^##\\s*${heading}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'm'));
    return found === null ? '' : found[1];
}

/** 미기입 자리표시자와 주석을 걸러낸 목록 항목 */
function bulletList(body: string): string[] {
    return body
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('- '))
        .map((line) => line.slice(2).trim())
        .filter((line) => line !== '' && !line.includes('{'));
}

export async function readMeta(path: string): Promise<DatasetMeta> {
    const text = await readFile(path, 'utf8');
    const rawMode = matchField(text, FIELD_PATTERNS.targetMode);
    const rawRepetitions = matchField(text, FIELD_PATTERNS.repetitions);

    return {
        purpose: sectionBody(text, '목적').trim().split('\n')[0] ?? '',
        passCriteria: bulletList(sectionBody(text, '통과 기준')),
        langsmithDataset: matchField(text, FIELD_PATTERNS.langsmithDataset),
        firstUploadedAt: matchField(text, FIELD_PATTERNS.firstUploadedAt),
        targetMode: rawMode === null ? null : rawMode.startsWith('B') ? 'B' : 'A',
        targetCommand: matchField(text, FIELD_PATTERNS.targetCommand),
        targetPrompt: matchField(text, FIELD_PATTERNS.targetPrompt),
        targetModel: matchField(text, FIELD_PATTERNS.targetModel),
        repetitions: rawRepetitions === null ? 1 : Number(rawRepetitions),
    };
}

/**
 * 첫 업로드에서 정한 LangSmith 데이터셋 이름을 meta.md 에 기록한다.
 * 이름이 조용히 바뀌면 이전 실험 이력과 끊기므로, 이미 있는 값은 덮어쓰지 않는다.
 */
export async function recordLangsmithDataset(path: string, datasetName: string): Promise<void> {
    const text = await readFile(path, 'utf8');
    const today = new Date().toISOString().slice(0, 10);

    const withName = text.match(FIELD_PATTERNS.langsmithDataset)
        ? text.replace(FIELD_PATTERNS.langsmithDataset, `- 데이터셋 이름: ${datasetName}`)
        : `${text.trimEnd()}\n\n## LangSmith\n\n- 데이터셋 이름: ${datasetName}\n- 첫 업로드: ${today}\n`;

    const withDate = withName.match(FIELD_PATTERNS.firstUploadedAt)
        ? withName.replace(FIELD_PATTERNS.firstUploadedAt, `- 첫 업로드: ${today}`)
        : withName;

    await writeFile(path, withDate, 'utf8');
}
