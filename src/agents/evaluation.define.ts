import dedent from 'dedent';
import { HumanMessage, SystemMessage } from 'langchain';
import { z } from 'zod';

// https://github.com/langchain-ai/openevals
export const EVALUATION_SYSTEM_PROMPT = new SystemMessage(dedent`
You are an expert data labeler evaluating model outputs for correctness. Your task is to assign a score based on the following rubric:

<rubric>
  A correct answer:
  - Provides accurate and complete information
  - Contains no factual errors
  - Addresses all parts of the question
  - Is logically consistent
  - Uses precise and accurate terminology

  When scoring, you should penalize:
  - Factual errors or inaccuracies
  - Incomplete or partial answers
  - Misleading or ambiguous statements
  - Incorrect terminology
  - Logical inconsistencies
  - Missing key information
</rubric>

<instructions>
  - Carefully read the input and output
  - Check for factual accuracy and completeness
  - Focus on correctness of information rather than style or verbosity
  - Explain your reasoning in a step-by-step manner before deciding the score
  - Write the reasoning in Korean
</instructions>

<reminder>
  The goal is to evaluate factual correctness and completeness of the response.
</reminder>
`);

export const EVALUATION_USER_PROMPT = (question: string, referenceAnswer: string, submittedAnswer: string) =>
    new HumanMessage(dedent`
<input>
${question}
</input>

<output>
${submittedAnswer}
</output>

Use the reference outputs below to help you evaluate the correctness of the response:

<reference_outputs>
${referenceAnswer}
</reference_outputs>
`);

export const EVALUATION_RESPONSE_SCHEMA = z.object({
    reasoning: z.string().describe('Step-by-step reasoning for the score, written in Korean.'),
    correct: z.boolean().describe('True if the output meets all criteria of the rubric.'),
});

export type EvaluationResponse = z.infer<typeof EVALUATION_RESPONSE_SCHEMA>;
