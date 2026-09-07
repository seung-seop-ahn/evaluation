import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import type { DatasetMeta } from './meta.ts';

const run = promisify(execFile);

export type TargetOutput = {
    answer: string;
    tools: string[];
};

export type Target = (question: string) => Promise<TargetOutput>;

/**
 * stdout 이 { answer, tools } 형태의 JSON 이면 그대로 쓰고,
 * 아니면 전체를 답변으로 본다. tool 호출은 JSON 을 내보내야만 측정할 수 있다.
 */
function parseCommandOutput(stdout: string): TargetOutput {
    const trimmed = stdout.trim();
    const jsonStart = trimmed.lastIndexOf('{');

    if (jsonStart !== -1) {
        try {
            const parsed = JSON.parse(trimmed.slice(jsonStart)) as { answer?: unknown; tools?: unknown };
            if (typeof parsed.answer === 'string') {
                return {
                    answer: parsed.answer,
                    tools: Array.isArray(parsed.tools) ? parsed.tools.map(String) : [],
                };
            }
        } catch {
            // JSON 이 아니면 아래로 흘려보낸다
        }
    }

    return { answer: trimmed, tools: [] };
}

/**
 * 질문을 셸 문자열에 이어붙이지 않고 인자로 넘긴다.
 * 데이터셋의 질문에 따옴표나 세미콜론이 들어가도 명령이 깨지거나 주입되지 않는다.
 */
function buildCommandRunner(template: string): Target {
    const script = template.replaceAll('"{question}"', '"$1"').replaceAll('{question}', '"$1"');

    return async (question: string) => {
        const { stdout } = await run('sh', ['-c', script, '_', question], {
            maxBuffer: 10 * 1024 * 1024,
            timeout: 120_000,
        });
        return parseCommandOutput(stdout);
    };
}

async function buildModelRunner(meta: DatasetMeta): Promise<Target> {
    if (meta.targetPrompt === null) {
        throw new Error('meta.md 의 평가 대상에 프롬프트 경로가 없습니다. 방식 B 는 프롬프트가 있어야 합니다.');
    }
    if (!process.env.OPENAI_API_KEY) {
        throw new Error(
            [
                '.env 에 OPENAI_API_KEY 가 없습니다.',
                '',
                '프로젝트 루트의 .env 에 추가한 뒤 다시 실행해 주세요.',
                '(.env 는 .gitignore 에 등록되어 있어 커밋되지 않습니다)',
                '',
                '  OPENAI_API_KEY=sk-...',
            ].join('\n'),
        );
    }

    const systemPrompt = await readFile(meta.targetPrompt, 'utf8');
    const { ChatOpenAI } = await import('@langchain/openai');
    const model = new ChatOpenAI({ model: meta.targetModel ?? 'gpt-4o-mini', temperature: 0 });

    return async (question: string) => {
        const reply = await model.invoke([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: question },
        ]);
        return { answer: String(reply.content), tools: [] };
    };
}

export async function buildTarget(meta: DatasetMeta): Promise<Target> {
    if (meta.targetMode === 'B') {
        return buildModelRunner(meta);
    }

    if (meta.targetCommand === null) {
        throw new Error('meta.md 의 평가 대상에 실행 명령이 없습니다.');
    }
    return buildCommandRunner(meta.targetCommand);
}

export function describeTarget(meta: DatasetMeta): string {
    if (meta.targetMode === 'B') {
        return `방식 B (Claude/모델 직접 수행) · 프롬프트 ${meta.targetPrompt} · 모델 ${meta.targetModel ?? 'gpt-4o-mini'}`;
    }
    return `방식 A (코드 실행) · ${meta.targetCommand}`;
}
