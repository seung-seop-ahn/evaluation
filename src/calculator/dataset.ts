import { Client } from 'langsmith';

export const CALCULATOR_DATASET_NAME = 'calculator';

interface CalculatorExample {
    question: string;
    answer: string;
}

const CALCULATOR_EXAMPLES: CalculatorExample[] = [
    { question: '3 + 5', answer: '8' },
    { question: '10 - 4', answer: '6' },
    { question: '6 * 7', answer: '42' },
    { question: '20 / 4', answer: '5' },
    { question: '12 + 30', answer: '42' },
];

async function main(): Promise<void> {
    const client = new Client();

    const exists = await client.hasDataset({ datasetName: CALCULATOR_DATASET_NAME });

    const dataset = exists
        ? await client.readDataset({ datasetName: CALCULATOR_DATASET_NAME })
        : await client.createDataset(CALCULATOR_DATASET_NAME, {
              description: 'Four Basic Operations Golden Dataset',
          });

    // Collect already uploaded questions to upload only new examples
    const existingQuestions = new Set<string>();
    if (exists) {
        for await (const example of client.listExamples({ datasetId: dataset.id })) {
            existingQuestions.add(String(example.inputs.question));
        }
    }

    const newExamples = CALCULATOR_EXAMPLES.filter((example) => !existingQuestions.has(example.question));
    if (newExamples.length === 0) {
        console.log(`'${CALCULATOR_DATASET_NAME}' is already up to date. (Examples: ${existingQuestions.size})`);
        return;
    }

    await client.createExamples(
        newExamples.map((example) => ({
            dataset_id: dataset.id,
            inputs: { question: example.question },
            outputs: { answer: example.answer },
        })),
    );

    console.log(`'${CALCULATOR_DATASET_NAME}' upsert complete. (New: ${newExamples.length})`);
}

await main();
