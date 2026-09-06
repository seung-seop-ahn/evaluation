import { TavilySearch } from '@langchain/tavily';
import { tool } from 'langchain';
import { z } from 'zod';

// Real web search tool. Requires TAVILY_API_KEY in .env
export const tavilySearch = new TavilySearch({
    maxResults: 3,
});

// Deterministic mock tools: this evaluation grades tool selection, not answer accuracy
export const convertCurrency = tool(
    ({ amount, from, to }) => {
        const MOCK_RATES: Record<string, number> = { USD: 1, KRW: 1350, EUR: 0.9 };
        const converted = (amount / MOCK_RATES[from]) * MOCK_RATES[to];
        return `${amount} ${from} is about ${converted.toFixed(2)} ${to}. (mock rate)`;
    },
    {
        name: 'convert_currency',
        description: 'Convert an amount of money between currencies (USD, KRW, EUR).',
        schema: z.object({
            amount: z.number().describe('Amount to convert.'),
            from: z.enum(['USD', 'KRW', 'EUR']).describe('Source currency code.'),
            to: z.enum(['USD', 'KRW', 'EUR']).describe('Target currency code.'),
        }),
    },
);

export const getCurrentTime = tool(
    ({ timezone }) => `The current time in ${timezone} is 2026-09-06 14:00. (mock clock)`,
    {
        name: 'get_current_time',
        description: 'Get the current date and time for a timezone or city.',
        schema: z.object({
            timezone: z.string().describe('Timezone or city name.'),
        }),
    },
);
