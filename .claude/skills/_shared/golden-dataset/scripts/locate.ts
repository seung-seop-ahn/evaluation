import { readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

export type DatasetPaths = {
    name: string;
    directory: string;
    goldenCsv: string;
    meta: string;
    candidates: string;
    reportsDirectory: string;
};

async function findFiles(root: string, matches: (fileName: string) => boolean): Promise<string[]> {
    const found: string[] = [];

    const walk = async (directory: string): Promise<void> => {
        const entries = await readdir(directory, { withFileTypes: true });
        await Promise.all(
            entries.map(async (entry) => {
                if (entry.isDirectory()) {
                    if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) {
                        return;
                    }
                    await walk(join(directory, entry.name));
                    return;
                }
                if (matches(entry.name)) {
                    found.push(join(directory, entry.name));
                }
            }),
        );
    };

    await walk(root);
    return found.sort();
}

export async function listDatasets(root: string): Promise<DatasetPaths[]> {
    const files = await findFiles(root, (fileName) => fileName.endsWith('.golden.csv'));
    return files.map((file) => toPaths(file));
}

export async function resolveDataset(root: string, name: string): Promise<DatasetPaths> {
    const target = `${name}.golden.csv`;
    const files = await findFiles(root, (fileName) => fileName === target);

    if (files.length === 0) {
        const available = await listDatasets(root);
        const hint =
            available.length === 0
                ? '이 프로젝트에서 golden.csv 파일을 찾지 못했습니다.'
                : `찾은 데이터셋: ${available.map((paths) => paths.name).join(', ')}`;
        throw new Error(`"${name}" 데이터셋을 찾지 못했습니다.\n${hint}`);
    }

    if (files.length > 1) {
        throw new Error(`"${name}" 이름의 파일이 여러 곳에 있습니다.\n${files.map((file) => `  ${file}`).join('\n')}`);
    }

    return toPaths(files[0]);
}

function toPaths(goldenCsv: string): DatasetPaths {
    const directory = dirname(goldenCsv);
    const name = basename(goldenCsv, '.golden.csv');

    return {
        name: name,
        directory: directory,
        goldenCsv: goldenCsv,
        meta: join(directory, `${name}.meta.md`),
        candidates: join(directory, `${name}.candidates.md`),
        reportsDirectory: join(directory, 'reports'),
    };
}

export function timestamp(): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate()),
        '-',
        pad(now.getHours()),
        pad(now.getMinutes()),
        // 초까지 넣어야 같은 분에 두 번 실행해도 직전 실행 기록을 덮어쓰지 않는다
        pad(now.getSeconds()),
    ].join('');
}
