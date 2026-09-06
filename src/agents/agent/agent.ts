import type { InteropZodType } from '@langchain/core/utils/types';
import { createAgent, SystemMessage } from 'langchain';

import { DATASET_RESPONSE_SCHEMA, DATASET_SYSTEM_PROMPT, DATASET_USER_PROMPT } from '../dataset.define.js';
import { EVALUATION_RESPONSE_SCHEMA, EVALUATION_SYSTEM_PROMPT, EVALUATION_USER_PROMPT } from '../evaluation.define.js';
import { model } from '../model.js';
import { CsvUtil } from '../utils/csv.util.js';
import { PathUtil } from '../utils/path.util.js';

export const CreateAgent = <T extends Record<string, any>>(systemPrompt: SystemMessage, format: InteropZodType<T>) => {
    return createAgent({
        model: model,
        tools: [],
        middleware: [],
        responseFormat: format,
        systemPrompt: systemPrompt,
    });
};

export namespace Agent {
    export class Dataset {
        private dataset = CreateAgent(DATASET_SYSTEM_PROMPT, DATASET_RESPONSE_SCHEMA);

        async run(input: string) {
            const result = await this.dataset.invoke({
                messages: [DATASET_USER_PROMPT(input)],
            });

            return result.structuredResponse;
        }

        async runToCsvFile(input: string, filePath = PathUtil.resolveFromRoot('golden-dataset.csv')) {
            const { dataset } = await this.run(input);

            await CsvUtil.toCsvFile(filePath, dataset);

            return {
                filePath: filePath,
                pairCount: dataset.length,
            };
        }
    }

    export class Evaluate {
        private evaluate = CreateAgent(EVALUATION_SYSTEM_PROMPT, EVALUATION_RESPONSE_SCHEMA);

        async run(question: string, referenceAnswer: string, submittedAnswer: string) {
            const result = await this.evaluate.invoke({
                messages: [EVALUATION_USER_PROMPT(question, referenceAnswer, submittedAnswer)],
            });

            return result.structuredResponse;
        }
    }
}
