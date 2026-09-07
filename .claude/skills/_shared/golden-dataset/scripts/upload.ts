import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { Client } from 'langsmith';

import { formatErrors, readGoldenCsv, type GoldenCase } from './csv.ts';
import { listDatasets, resolveDataset, timestamp, type DatasetPaths } from './locate.ts';
import { findRemote, indexRemoteExamples, isUnchanged, toExample, type RemoteExample } from './mapping.ts';
import { readMeta, recordLangsmithDataset } from './meta.ts';

const USAGE = `
golden dataset upload — 확정 데이터셋을 LangSmith에 올립니다

  --dataset <이름>          올릴 데이터셋 (예: nist-policy). 생략하면 목록만 보여줍니다
  --langsmith-name <이름>   LangSmith에 쓸 이름. 생략하면 meta.md 기록이나 데이터셋 이름을 씁니다
  --apply                   실제로 올립니다. 없으면 미리보기만 합니다
  --root <경로>             탐색 시작 경로 (기본: 현재 디렉토리)
  --help                    이 도움말

기본은 미리보기입니다. 무엇이 올라갈지 확인한 뒤 --apply 를 붙이세요.
`.trim();

/** 이름 충돌로 사람의 결정이 필요할 때. 스킬이 이 코드를 보고 사용자에게 묻는다 */
const EXIT_NEEDS_DECISION = 2;

type Args = {
    dataset: string | null;
    langsmithName: string | null;
    apply: boolean;
    root: string;
    help: boolean;
};

function parseArgs(argv: string[]): Args {
    const args: Args = { dataset: null, langsmithName: null, apply: false, root: process.cwd(), help: false };

    argv.forEach((token, index) => {
        const next = argv[index + 1];
        if (token === '--dataset') args.dataset = next ?? null;
        if (token === '--langsmith-name') args.langsmithName = next ?? null;
        if (token === '--root' && next !== undefined) args.root = resolve(next);
        if (token === '--apply') args.apply = true;
        if (token === '--help' || token === '-h') args.help = true;
    });

    return args;
}

function requireApiKey(): void {
    if (process.env.LANGSMITH_API_KEY || process.env.LANGCHAIN_API_KEY) {
        return;
    }

    // 키 값은 어디에도 출력하지 않는다. 없다는 사실과 넣을 위치만 알린다
    console.error(
        [
            '.env 에 LANGSMITH_API_KEY 가 없습니다.',
            '',
            '프로젝트 루트의 .env 에 아래 줄을 추가한 뒤 다시 실행해 주세요.',
            '(.env 는 .gitignore 에 등록되어 있어 커밋되지 않습니다)',
            '',
            '  LANGSMITH_API_KEY=lsv2_...',
        ].join('\n'),
    );
    process.exit(1);
}

async function listRemoteExamples(client: Client, datasetId: string): Promise<RemoteExample[]> {
    const examples: RemoteExample[] = [];
    for await (const example of client.listExamples({ datasetId: datasetId })) {
        examples.push(example as RemoteExample);
    }
    return examples;
}

type Plan = {
    created: GoldenCase[];
    updated: { goldenCase: GoldenCase; exampleId: string }[];
    unchanged: GoldenCase[];
    /** id 없이 올라가 있던 예제를 질문으로 찾아 이어붙인 건수 */
    adopted: number;
    /** 원격에 있는 예제 중 id 가 없는 것의 총 개수 */
    legacyCount: number;
};

function buildPlan(activeCases: GoldenCase[], remoteExamples: RemoteExample[]): Plan {
    const index = indexRemoteExamples(remoteExamples);
    const plan: Plan = { created: [], updated: [], unchanged: [], adopted: 0, legacyCount: index.legacyCount };

    activeCases.forEach((goldenCase) => {
        const existing = findRemote(index, goldenCase);
        // id 없이 올라가 있던 예제를 질문으로 찾아냈다면, 갱신하면서 id 가 붙는다
        if (existing !== undefined && !index.byCaseId.has(goldenCase.id)) {
            plan.adopted += 1;
        }
        if (existing === undefined) {
            plan.created.push(goldenCase);
            return;
        }
        if (isUnchanged(existing, toExample(goldenCase))) {
            plan.unchanged.push(goldenCase);
            return;
        }
        plan.updated.push({ goldenCase: goldenCase, exampleId: existing.id });
    });

    return plan;
}

async function writeUploadReport(paths: DatasetPaths, datasetName: string, plan: Plan): Promise<string> {
    await mkdir(paths.reportsDirectory, { recursive: true });
    const reportPath = join(paths.reportsDirectory, `upload-${timestamp()}.md`);

    const lines = [
        `# ${paths.name} 업로드 · ${new Date().toISOString()}`,
        '',
        `LangSmith 데이터셋: ${datasetName}`,
        '',
        '되돌려야 할 때 아래 id 목록이 유일한 근거입니다.',
        '',
        '## 신규 생성',
        ...(plan.created.length === 0 ? ['없음'] : plan.created.map((item) => `- ${item.id}`)),
        '',
        '## 갱신',
        ...(plan.updated.length === 0
            ? ['없음']
            : plan.updated.map((item) => `- ${item.goldenCase.id} (example ${item.exampleId})`)),
        '',
    ];

    await writeFile(reportPath, lines.join('\n'), 'utf8');
    return reportPath;
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
                : ['어느 데이터셋을 올릴까요? --dataset 으로 지정하세요.', '', ...available.map((paths) => `  ${paths.name}  (${paths.goldenCsv})`)].join('\n'),
        );
        return;
    }

    const paths = await resolveDataset(args.root, args.dataset);
    const { cases, errors } = await readGoldenCsv(paths.goldenCsv);

    // 깨진 데이터를 외부에 올리면 되돌리는 비용이 훨씬 크다. 네트워크 호출 전에 멈춘다
    if (errors.length > 0) {
        console.error(`스키마 검증 실패 — ${errors.length}건. 업로드하지 않았습니다.\n`);
        console.error(formatErrors(errors));
        process.exit(1);
    }

    const activeCases = cases.filter((goldenCase) => goldenCase.status === 'active');
    const skipped = cases.length - activeCases.length;
    console.log(`스키마 검증 통과 (${cases.length}행, 오류 0)`);
    console.log(`활성 케이스 ${activeCases.length}건${skipped === 0 ? '' : ` (active 아님 ${skipped}건 제외)`}\n`);

    if (activeCases.length === 0) {
        console.log('올릴 케이스가 없습니다.');
        return;
    }

    requireApiKey();

    const meta = await readMeta(paths.meta).catch(() => null);
    const recordedName = meta?.langsmithDataset ?? null;
    const datasetName = args.langsmithName ?? recordedName ?? paths.name;

    const client = new Client();
    const exists = await client.hasDataset({ datasetName: datasetName });

    // meta.md 에 기록이 없는데 같은 이름이 이미 있으면 사람이 정해야 한다
    if (exists && recordedName === null && args.langsmithName === null) {
        const dataset = await client.readDataset({ datasetName: datasetName });
        const remote = await listRemoteExamples(client, dataset.id);
        const projectName = basename(resolve(args.root));

        console.log(
            [
                `LangSmith에 "${datasetName}" 데이터셋이 이미 있습니다.`,
                `예제 ${remote.length}건.`,
                '',
                '어떻게 할지 정해 주세요.',
                `  이어서 추가  →  --langsmith-name ${datasetName}`,
                `  새 이름으로  →  --langsmith-name ${projectName}-${paths.name}`,
            ].join('\n'),
        );
        process.exit(EXIT_NEEDS_DECISION);
    }

    const dataset = exists
        ? await client.readDataset({ datasetName: datasetName })
        : args.apply
          ? await client.createDataset(datasetName, { description: `Golden dataset: ${paths.name}` })
          : null;

    const remoteExamples = dataset === null ? [] : await listRemoteExamples(client, dataset.id);
    const plan = buildPlan(activeCases, remoteExamples);

    console.log(`LangSmith 데이터셋 "${datasetName}"`);
    console.log(`  상태        ${exists ? '기존' : '신규 생성됨'}`);
    console.log(`  신규 추가   ${plan.created.length}건`);
    console.log(`  기존 유지   ${plan.unchanged.length}건`);
    console.log(`  내용 변경   ${plan.updated.length}건`);
    if (plan.legacyCount > 0) {
        console.log('');
        console.log(`  참고: 원격에 id 없는 예제가 ${plan.legacyCount}건 있습니다 (이 스킬 이전에 올린 것).`);
        console.log(`        그중 ${plan.adopted}건은 질문이 같아 새로 만들지 않고 이어붙입니다.`);
    }
    console.log('');

    if (!args.apply) {
        console.log('미리보기입니다. 아직 아무것도 올라가지 않았습니다.');
        console.log(`실제로 올리려면 --apply 를 붙여 다시 실행하세요.`);
        return;
    }

    if (dataset === null) {
        throw new Error('데이터셋을 만들지 못했습니다.');
    }

    if (plan.created.length > 0) {
        await client.createExamples(
            plan.created.map((goldenCase) => ({ dataset_id: dataset.id, ...toExample(goldenCase) })),
        );
    }

    // 기존 예제를 삭제하지 않는다. 은퇴는 CSV 의 status 변경이고 여기서는 갱신만 한다
    if (plan.updated.length > 0) {
        await client.updateExamples(
            plan.updated.map(({ goldenCase, exampleId }) => ({ id: exampleId, ...toExample(goldenCase) })),
        );
    }

    if (recordedName === null) {
        await recordLangsmithDataset(paths.meta, datasetName).catch(() => {
            console.warn(`meta.md 에 이름을 기록하지 못했습니다: ${paths.meta}`);
        });
    }

    const reportPath = await writeUploadReport(paths, datasetName, plan);
    console.log(`업로드 완료. 신규 ${plan.created.length}건, 갱신 ${plan.updated.length}건.`);
    console.log(`이력: ${reportPath}`);
}

await main();
