import type { EvaluationResult } from 'langsmith/evaluation';
import { evaluate } from 'langsmith/evaluation';

import { CALCULATOR_DATASET_NAME } from './dataset.js';

function calculate(question: string): string {
    const [left, operator, right] = question.split(' ');
    const a = Number(left);
    const b = Number(right);

    switch (operator) {
        case '+':
            return String(a + b);
        case '-':
            return String(a - b);
        case '*':
            return String(a * b);
        case '/':
            return String(a / b);
        default:
            throw new Error(`Not supported operator: ${operator}`);
    }
}

const manualTarget = (inputs: Record<string, any>) => {
    return {
        answer: calculate(inputs.question),
    };
};

interface CorrectnessArgs {
    inputs: Record<string, any>;
    outputs: Record<string, any>;
    referenceOutputs?: Record<string, any>;
}

const manualJudge = (args: CorrectnessArgs): EvaluationResult => {
    const outputs = args.outputs.answer; // Target result (manualTarget)
    const referenceOutputs = args.referenceOutputs?.answer; // Golden answer (Langsmith Dataset outputs)

    return {
        key: 'correctness',
        score: outputs === referenceOutputs,
    };
};

const numericMatchJudge = (args: CorrectnessArgs): EvaluationResult => {
    return {
        key: 'numeric_match',
        score: Number(args.outputs.answer) === Number(args.referenceOutputs?.answer),
    };
};

async function main(): Promise<void> {
    await evaluate(manualTarget, {
        data: CALCULATOR_DATASET_NAME,
        evaluators: [manualJudge, numericMatchJudge],
        experimentPrefix: 'calculator-manual',
        maxConcurrency: 2,
        numRepetitions: 1,
    });

    console.log('Evaluation complete. Check results at LangSmith Experiments page.');
}

await main();
