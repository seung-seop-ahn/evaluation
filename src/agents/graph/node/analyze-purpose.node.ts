import dedent from 'dedent';
import { HumanMessage, SystemMessage } from 'langchain';
import { z } from 'zod';

import { model } from '../../model.js';
import { DatasetGraphState } from '../state.js';

export const PURPOSE_SYSTEM_PROMPT = new SystemMessage(dedent`
You are an AI assistant that analyzes an input before question-answer pairs are generated from it.

<instructions>
- Read the input carefully.
- Describe what the input is about and what it is used for.
- Describe which topics in the input are worth asking questions about.
- Write the analysis in Korean.
</instructions>
`);

export const PURPOSE_USER_PROMPT = (input: string) =>
    new HumanMessage(dedent`
Analyze the following input.

<input>
${input}
</input>
`);

export const PURPOSE_RESPONSE_SCHEMA = z.object({
    purpose: z
        .string()
        .describe('What the input is about, what it is used for, and which topics are worth asking questions about.'),
});
export type PurposeResponse = z.infer<typeof PURPOSE_RESPONSE_SCHEMA>;

export class AnalyzePurposeNode {
    run: typeof DatasetGraphState.Node = async (state) => {
        const response = await model
            .withStructuredOutput(PURPOSE_RESPONSE_SCHEMA)
            .invoke([PURPOSE_SYSTEM_PROMPT, PURPOSE_USER_PROMPT(state.input)]);

        return {
            purpose: response.purpose,
        };
    };
}
