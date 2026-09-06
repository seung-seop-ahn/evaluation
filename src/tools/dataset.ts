import { pathToFileURL } from 'node:url';

import { Client } from 'langsmith';

export const TOOLS_DATASET_NAME = 'tools';

interface ToolUsageExample {
    question: string;
    tools: string[];
}

// Each example defines which tools the agent is expected to call for the question
// An empty array means the question should be answered without any tool
const TOOL_USAGE_EXAMPLES: ToolUsageExample[] = [
    { question: '오늘 서울 날씨 어때? 검색해서 알려줘.', tools: ['tavily_search'] },
    { question: '최근에 OpenAI가 발표한 최신 모델 이름이 뭐야?', tools: ['tavily_search'] },
    { question: '100달러는 원화로 얼마야?', tools: ['convert_currency'] },
    { question: '지금 뉴욕은 몇 시야?', tools: ['get_current_time'] },
    {
        question: '지금 파리 시간을 알려주고, 50유로가 몇 달러인지도 계산해줘.',
        tools: ['get_current_time', 'convert_currency'],
    },
    { question: '대한민국의 수도는 어디야?', tools: [] },
];

async function main(): Promise<void> {
    const client = new Client();

    const exists = await client.hasDataset({ datasetName: TOOLS_DATASET_NAME });

    const dataset = exists
        ? await client.readDataset({ datasetName: TOOLS_DATASET_NAME })
        : await client.createDataset(TOOLS_DATASET_NAME, {
              description: 'Golden dataset for grading tool usage',
          });

    // Collect already uploaded questions to upload only new examples (upsert)
    const existingQuestions = new Set<string>();
    if (exists) {
        for await (const example of client.listExamples({ datasetId: dataset.id })) {
            existingQuestions.add(String(example.inputs.question));
        }
    }

    const newExamples = TOOL_USAGE_EXAMPLES.filter((example) => !existingQuestions.has(example.question));
    if (newExamples.length === 0) {
        console.log(`'${TOOLS_DATASET_NAME}' is already up to date. (Examples: ${existingQuestions.size})`);
        return;
    }

    await client.createExamples(
        newExamples.map((example) => ({
            dataset_id: dataset.id,
            inputs: { question: example.question },
            outputs: { tools: example.tools },
        })),
    );

    console.log(`'${TOOLS_DATASET_NAME}' upsert complete. (New: ${newExamples.length})`);
}

// Run only when executed directly, so importing TOOLS_DATASET_NAME from evaluate.ts does not trigger the upload
const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
    await main();
}
