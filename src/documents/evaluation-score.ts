import dedent from 'dedent';
import { HumanMessage, SystemMessage } from 'langchain';
import type { EvaluationResult } from 'langsmith/evaluation';
import { evaluate } from 'langsmith/evaluation';
import { z } from 'zod';

import { model } from '../agents/model.js';
import { PdfUtil } from '../agents/utils/pdf.util.js';
import { RAG_DATASET_NAME, RAG_PDF_DIRECTORY } from './dataset.js';

const TARGET_RESPONSE_SCHEMA = z.object({
    answer: z.string().describe('The answer to the question, based only on the provided documents. Written in Korean.'),
});

// Target: document QA that answers with the full documents as context (no retrieval step)
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

// Judge: grades the answer on multiple criteria, each on a 1-5 scale
// Source retrieval is not evaluated because the current target has no retrieval step
const SCORE_SYSTEM_PROMPT = new SystemMessage(dedent`
You are an expert evaluator assessing the quality of responses from an AI agent. The agent answers user questions based on the provided documents.

You will be given the user question, the reference answer (ground truth), the agent's answer, and the documents the agent used.

Evaluate the agent's answer on the following criteria, each scored from 1 (worst) to 5 (best).

<criteria>
<correctness>
Is the answer factually accurate?
- 1: Completely wrong or contradicts the reference answer
- 2: Mostly incorrect with minor correct elements
- 3: Partially correct. Key facts are right but some errors present
- 4: Mostly correct with only minor inaccuracies
- 5: Fully correct and consistent with the reference answer
</correctness>

<groundedness>
Is the answer fully supported by the document content? Does it avoid hallucination?
- 1: Answer is entirely fabricated or unsupported by the documents
- 2: Most of the answer is not grounded in the documents
- 3: Partially grounded. Some claims are supported, others are hallucinated
- 4: Mostly grounded with only minor unsupported details
- 5: Every claim in the answer is directly supported by the documents
</groundedness>

<completeness>
Does the answer fully address all parts of the user's question?
- 1: Fails to address the question at all
- 2: Addresses only a small part of the question
- 3: Addresses the main point but misses important sub-questions or details
- 4: Covers most aspects with only minor omissions
- 5: Thoroughly addresses every part of the question
</completeness>

<relevance_conciseness>
Is the answer focused on the question without unnecessary or off-topic information?
- 1: Entirely off-topic or overwhelmed with irrelevant information
- 2: Mostly irrelevant with excessive tangential content
- 3: Relevant but includes a noticeable amount of unnecessary information
- 4: Mostly focused with only minor irrelevant details
- 5: Perfectly focused. Every sentence directly serves the user's question
</relevance_conciseness>
</criteria>

<overall>
After scoring all criteria, give an overall grade for the agent's response, on a scale from 0 (worst) to 5 (best).
This is a holistic judgment, not a mechanical average of the criteria.
An answer that is factually wrong or hallucinated must receive a low overall grade even if the other criteria score well.
</overall>

<instructions>
- Score every criterion independently. A high score on one criterion must not influence another.
- Decide the overall grade last, after all criteria are scored.
- Explain your reasoning in a step-by-step manner before deciding each score.
- Write the reasoning in Korean.
</instructions>
`);

const SCORE_USER_PROMPT = (question: string, referenceAnswer: string, submittedAnswer: string) =>
    new HumanMessage(dedent`
<question>
${question}
</question>

<reference_answer>
${referenceAnswer}
</reference_answer>

<agent_answer>
${submittedAnswer}
</agent_answer>

<documents>
${documentContext}
</documents>
`);

// Each criterion has its own reasoning, generated before its score
const CRITERION_SCHEMA = z.object({
    reasoning: z.string().describe('Step-by-step reasoning for the score, written in Korean.'),
    score: z.number().int().min(1).max(5).describe('Integer score from 1 (worst) to 5 (best).'),
});

const OVERALL_SCHEMA = z.object({
    reasoning: z.string().describe('Step-by-step reasoning for the overall grade, written in Korean.'),
    score: z
        .number()
        .int()
        .min(0)
        .max(5)
        .describe("The overall grade for the agent's response, on a scale from 0 to 5."),
});

// overall comes last so the model grades it after reasoning through all criteria
const SCORE_RESPONSE_SCHEMA = z.object({
    correctness: CRITERION_SCHEMA,
    groundedness: CRITERION_SCHEMA,
    completeness: CRITERION_SCHEMA,
    relevance_conciseness: CRITERION_SCHEMA,
    overall: OVERALL_SCHEMA,
});

interface CorrectnessArgs {
    inputs: Record<string, any>;
    outputs: Record<string, any>;
    referenceOutputs?: Record<string, any>;
}

const scoreJudge = async (args: CorrectnessArgs): Promise<EvaluationResult[]> => {
    const verdict = await model.withStructuredOutput(SCORE_RESPONSE_SCHEMA).invoke([
        SCORE_SYSTEM_PROMPT,
        SCORE_USER_PROMPT(
            String(args.inputs.question),
            String(args.referenceOutputs?.answer), // Golden answer (Langsmith Dataset outputs)
            String(args.outputs.answer), // Target result
        ),
    ]);

    return [
        // 'correctness_score' keeps the 1-5 scale separate from the binary 'correctness' metric
        { key: 'correctness_score', score: verdict.correctness.score, comment: verdict.correctness.reasoning },
        { key: 'groundedness', score: verdict.groundedness.score, comment: verdict.groundedness.reasoning },
        { key: 'completeness', score: verdict.completeness.score, comment: verdict.completeness.reasoning },
        {
            key: 'relevance_conciseness',
            score: verdict.relevance_conciseness.score,
            comment: verdict.relevance_conciseness.reasoning,
        },
        { key: 'overall', score: verdict.overall.score, comment: verdict.overall.reasoning },
    ];
};

async function main(): Promise<void> {
    await evaluate(target, {
        data: RAG_DATASET_NAME,
        evaluators: [scoreJudge],
        experimentPrefix: 'rag-score',
    });

    console.log('Evaluation complete. Check results at LangSmith Experiments page.');
}

await main();
