import { HumanMessage, SystemMessage } from 'langchain';
import type { EvaluationResult } from 'langsmith/evaluation';
import { evaluate } from 'langsmith/evaluation';
import { z } from 'zod';

import { Agent } from '../agents/agent/agent.js';
import { model } from '../agents/model.js';
import { CALCULATOR_DATASET_NAME } from './dataset.js';

const TARGET_RESPONSE_SCHEMA = z.object({
    answer: z.string().describe('The result of the calculation as a plain number string. e.g. "8"'),
});

const llmTarget = async (inputs: Record<string, any>) => {
    const response = await model
        .withStructuredOutput(TARGET_RESPONSE_SCHEMA)
        .invoke([
            new SystemMessage(
                'You are a calculator. Compute the given expression and answer with only the numeric result.',
            ),
            new HumanMessage(String(inputs.question)),
        ]);

    return {
        answer: response.answer,
    };
};

interface CorrectnessArgs {
    inputs: Record<string, any>;
    outputs: Record<string, any>;
    referenceOutputs?: Record<string, any>;
}

const llmJudge = async (args: CorrectnessArgs): Promise<EvaluationResult> => {
    const verdict = await new Agent.Evaluate().run(
        String(args.inputs.question),
        String(args.referenceOutputs?.answer), // Golden answer (Langsmith Dataset outputs)
        String(args.outputs.answer), // Target result (llmTarget)
    );

    return {
        key: 'correctness',
        score: verdict.correct,
        comment: verdict.reasoning,
    };
};

const numericMatchJudge = (args: CorrectnessArgs): EvaluationResult => {
    return {
        key: 'numeric_match',
        score: Number(args.outputs.answer) === Number(args.referenceOutputs?.answer),
    };
};

async function main(): Promise<void> {
    await evaluate(llmTarget, {
        data: CALCULATOR_DATASET_NAME,
        evaluators: [llmJudge, numericMatchJudge],
        experimentPrefix: 'calculator-llm',
        maxConcurrency: 2,
        numRepetitions: 1,
    });

    console.log('Evaluation complete. Check results at LangSmith Experiments page.');
}

await main();
