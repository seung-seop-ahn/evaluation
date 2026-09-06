import dedent from 'dedent';
import { AIMessage, createAgent, HumanMessage, SystemMessage } from 'langchain';
import type { EvaluationResult } from 'langsmith/evaluation';
import { evaluate } from 'langsmith/evaluation';

import { model } from '../agents/model.js';
import { TOOLS_DATASET_NAME } from './dataset.js';
import { convertCurrency, getCurrentTime, tavilySearch } from './toolkit.js';

const TARGET_SYSTEM_PROMPT = new SystemMessage(dedent`
You are a helpful assistant.

<instructions>
- Use the provided tools when the question needs external, real-time, or computed information.
    - MUST use tavily_search when the question is about the weather.
- Answer directly without tools when the question can be answered from general knowledge.
- Write the answer in Korean.
</instructions>
`);

const agent = createAgent({
    model: model,
    tools: [tavilySearch, convertCurrency, getCurrentTime],
    middleware: [],
    systemPrompt: TARGET_SYSTEM_PROMPT,
});

// Target: runs the agent and reports which tools were actually called along with the answer
const target = async (inputs: Record<string, any>) => {
    const result = await agent.invoke({
        messages: [new HumanMessage(String(inputs.question))],
    });

    const toolsUsed = new Set<string>();
    for (const message of result.messages) {
        if (message instanceof AIMessage) {
            for (const toolCall of message.tool_calls ?? []) {
                toolsUsed.add(toolCall.name);
            }
        }
    }

    const lastMessage = result.messages.at(-1);

    return {
        answer: lastMessage?.text ?? '',
        tools: [...toolsUsed],
    };
};

interface ToolUsageArgs {
    inputs: Record<string, any>;
    outputs: Record<string, any>;
    referenceOutputs?: Record<string, any>;
}

// Code-based judge: the tools actually called must exactly match the expected tools
const toolUsageJudge = (args: ToolUsageArgs): EvaluationResult => {
    const expected = [...((args.referenceOutputs?.tools as string[] | undefined) ?? [])].sort();
    const used = [...((args.outputs.tools as string[] | undefined) ?? [])].sort();

    const matched = expected.length === used.length && expected.every((tool, index) => tool === used[index]);

    return {
        key: 'tool_usage',
        score: matched,
        comment: `expected: [${expected.join(', ')}] / used: [${used.join(', ')}]`,
    };
};

async function main(): Promise<void> {
    await evaluate(target, {
        data: TOOLS_DATASET_NAME,
        evaluators: [toolUsageJudge],
        experimentPrefix: 'tools',
    });

    console.log('Evaluation complete. Check results at LangSmith Experiments page.');
}

await main();
