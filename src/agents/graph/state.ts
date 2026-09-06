import { StateSchema } from '@langchain/langgraph';
import { z } from 'zod';

import { DATASET_RESPONSE_SCHEMA } from '../dataset.define.js';

export const DatasetGraphState = new StateSchema({
    input: z.string(),
    purpose: z.string().default(''),
    dataset: DATASET_RESPONSE_SCHEMA.shape.dataset.default(() => []),
});
