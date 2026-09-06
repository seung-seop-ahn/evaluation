import dedent from 'dedent';
import { HumanMessage, SystemMessage } from 'langchain';
import { z } from 'zod';

export const DATASET_SYSTEM_PROMPT = new SystemMessage(dedent`
You are an AI assistant that generates question-answer pairs from a given input.

<instructions>
- Read the input carefully and create question-answer pairs from it.
- Only create pairs whose answers are directly supported by the input.
- When the input has a sentence or passage that contains the answer, copy it word for word into the source field.
- Write every question and answer in Korean.
</instructions>
`);

export const DATASET_USER_PROMPT = (input: string) =>
    new HumanMessage(dedent`
Generate question-answer pairs from the following input.

<input>
${input}
</input>
`);

export const DATASET_RESPONSE_SCHEMA = z.object({
    dataset: z
        .array(
            z.object({
                question: z.string().describe('A question that can be answered using only the given input.'),
                answer: z
                    .string()
                    .describe('The correct answer to the question. It must be based only on the given input.'),
                source: z
                    .string()
                    .optional()
                    .describe(
                        'The exact sentence or passage from the input that contains the answer. Copy it word for word, without changing anything. Leave this field empty if the input has no such passage.',
                    ),
            }),
        )
        .describe('Generated question and answer pairs.'),
});
export type DatasetResponse = z.infer<typeof DATASET_RESPONSE_SCHEMA>;
