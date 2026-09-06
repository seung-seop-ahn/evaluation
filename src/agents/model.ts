import { ChatOpenAI } from '@langchain/openai';

export const model = new ChatOpenAI({
    model: 'gpt-5',
    apiKey: process.env.API_KEY,
    reasoning: {
        effort: 'high',
    },
});
