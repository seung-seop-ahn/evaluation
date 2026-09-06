import dedent from 'dedent';
import { HumanMessage } from 'langchain';

import { DATASET_RESPONSE_SCHEMA, DATASET_SYSTEM_PROMPT } from '../../dataset.define.js';
import { model } from '../../model.js';
import { DatasetGraphState } from '../state.js';

export const DATASET_USER_PROMPT_WITH_PURPOSE = (input: string, purpose: string) =>
    new HumanMessage(dedent`
Generate question-answer pairs from the following input.
Use the purpose to decide which questions are worth creating.

<purpose>
${purpose}
</purpose>

<input>
${input}
</input>
`);

export class GenerateDatasetNode {
    run: typeof DatasetGraphState.Node = async (state) => {
        const response = await model
            .withStructuredOutput(DATASET_RESPONSE_SCHEMA)
            .invoke([DATASET_SYSTEM_PROMPT, DATASET_USER_PROMPT_WITH_PURPOSE(state.input, state.purpose)]);

        return {
            dataset: response.dataset,
        };
    };
}
