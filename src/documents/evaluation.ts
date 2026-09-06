import dedent from 'dedent';
import { HumanMessage, SystemMessage } from 'langchain';
import type { EvaluationResult } from 'langsmith/evaluation';
import { evaluate } from 'langsmith/evaluation';
import { z } from 'zod';

import { Agent } from '../agents/agent/agent.js';
import { model } from '../agents/model.js';
import { PdfUtil } from '../agents/utils/pdf.util.js';
import { RAG_DATASET_NAME, RAG_PDF_DIRECTORY } from './dataset.js';

const TARGET_RESPONSE_SCHEMA = z.object({
    answer: z.string().describe('The answer to the question, based only on the provided documents. Written in Korean.'),
});

const documents = await PdfUtil.loadFromDirectory(RAG_PDF_DIRECTORY);
const documentContext = documents
    .map((document) => `<document name="${document.file}">\n${document.text}\n</document>`)
    .join('\n\n');

const TARGET_SYSTEM_PROMPT = new SystemMessage(dedent`
You are an assistant that answers questions using only the provided documents.

<instructions>
- Answer based only on the content of the documents.
- If the documents do not contain the answer, say you do not know.
- Write the answer in Korean.
</instructions>

<documents>
${documentContext}
</documents>
`);

const target = async (inputs: Record<string, any>) => {
    const response = await model
        .withStructuredOutput(TARGET_RESPONSE_SCHEMA)
        .invoke([TARGET_SYSTEM_PROMPT, new HumanMessage(String(inputs.question))]);

    return {
        answer: response.answer,
    };
};

// const evaluateAgent = new DeepAgent.Evaluate();
const evaluateAgent = new Agent.Evaluate();

interface CorrectnessArgs {
    inputs: Record<string, any>;
    outputs: Record<string, any>;
    referenceOutputs?: Record<string, any>;
}

const llmJudge = async (args: CorrectnessArgs): Promise<EvaluationResult> => {
    const verdict = await evaluateAgent.run(
        String(args.inputs.question),
        String(args.referenceOutputs?.answer), // Golden answer (Langsmith Dataset outputs)
        String(args.outputs.answer), // Target result
    );

    return {
        key: 'correctness',
        score: verdict.correct,
        comment: verdict.reasoning,
    };
};

async function main(): Promise<void> {
    await evaluate(target, {
        data: RAG_DATASET_NAME,
        evaluators: [llmJudge],
        experimentPrefix: 'rag',
    });

    console.log('Evaluation complete. Check results at LangSmith Experiments page.');
}

await main();
