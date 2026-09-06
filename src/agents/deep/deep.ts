import type { InteropZodType } from '@langchain/core/utils/types';
import { createDeepAgent } from 'deepagents';
import { SystemMessage, toolStrategy } from 'langchain';

import {
    DATASET_RESPONSE_SCHEMA,
    DATASET_SYSTEM_PROMPT,
    DATASET_USER_PROMPT,
    DatasetResponse,
} from '../dataset.define.js';
import {
    EVALUATION_RESPONSE_SCHEMA,
    EVALUATION_SYSTEM_PROMPT,
    EVALUATION_USER_PROMPT,
    EvaluationResponse,
} from '../evaluation.define.js';
import { model } from '../model.js';

export const CreateDeepAgent = <T extends Record<string, any>>(
    systemPrompt?: SystemMessage,
    format?: InteropZodType<T>,
) => {
    const responseFormat = format ? toolStrategy(format) : undefined;

    return createDeepAgent({
        model: model,
        tools: [],
        middleware: [],
        responseFormat: responseFormat,
        systemPrompt: systemPrompt,
    });
};

export namespace DeepAgent {
    export class Dataset {
        private dataset = CreateDeepAgent(DATASET_SYSTEM_PROMPT, DATASET_RESPONSE_SCHEMA);

        async run(input: string): Promise<DatasetResponse> {
            const result = await this.dataset.invoke({
                messages: [DATASET_USER_PROMPT(input)],
            });

            return result.structuredResponse;
        }
    }

    export class Evaluate {
        private evaluate = CreateDeepAgent(EVALUATION_SYSTEM_PROMPT, EVALUATION_RESPONSE_SCHEMA);

        async run(question: string, referenceAnswer: string, submittedAnswer: string): Promise<EvaluationResponse> {
            const result = await this.evaluate.invoke({
                messages: [EVALUATION_USER_PROMPT(question, referenceAnswer, submittedAnswer)],
            });

            return result.structuredResponse;
        }
    }
}
