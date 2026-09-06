import { pathToFileURL } from 'node:url';

import { Client } from 'langsmith';

import { Agent } from '../agents/agent/agent.js';
import { PathUtil } from '../agents/utils/path.util.js';
import { PdfUtil } from '../agents/utils/pdf.util.js';

export const RAG_DATASET_NAME = 'rag';
export const RAG_PDF_DIRECTORY = PathUtil.resolveFromRoot('src', 'documents', 'pdf');

// const datasetAgent = new DeepAgent.Dataset();
// const datasetAgent = new Graph.Dataset();
const datasetAgent = new Agent.Dataset();

async function main(): Promise<void> {
    const client = new Client();

    const exists = await client.hasDataset({ datasetName: RAG_DATASET_NAME });

    const dataset = exists
        ? await client.readDataset({ datasetName: RAG_DATASET_NAME })
        : await client.createDataset(RAG_DATASET_NAME, {
              description: 'Golden dataset generated from PDF documents',
          });

    // Collect already uploaded questions to upload only new examples (upsert)
    const existingQuestions = new Set<string>();
    if (exists) {
        for await (const example of client.listExamples({ datasetId: dataset.id })) {
            existingQuestions.add(String(example.inputs.question));
        }
    }

    const documents = await PdfUtil.loadFromDirectory(RAG_PDF_DIRECTORY);

    for (const document of documents) {
        console.log(`Generating examples from "${document.file}"...`);
        const result = await datasetAgent.run(document.text);

        const newExamples = result.dataset.filter((example) => !existingQuestions.has(example.question));
        if (newExamples.length === 0) {
            console.log(`"${document.file}": already up to date. (Generated: ${result.dataset.length})`);
            continue;
        }

        await client.createExamples(
            newExamples.map((example) => ({
                dataset_id: dataset.id,
                inputs: { question: example.question },
                outputs: { answer: example.answer },
                // Source passage and file are not grading criteria, so keep them in metadata
                metadata: { file: document.file, source: example.source ?? null },
            })),
        );

        newExamples.forEach((example) => existingQuestions.add(example.question));
        console.log(
            `"${document.file}": ${newExamples.length} examples uploaded. (Generated: ${result.dataset.length})`,
        );
    }
}

// Run only when executed directly, so importing RAG_DATASET_NAME from evaluation.ts does not trigger the upload
const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
    await main();
}
