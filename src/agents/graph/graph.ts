import { END, START, StateGraph } from '@langchain/langgraph';

import { DatasetResponse } from '../dataset.define.js';
import { AnalyzePurposeNode } from './node/analyze-purpose.node.js';
import { GenerateDatasetNode } from './node/generate-dataset.node.js';
import { DatasetGraphState } from './state.js';

export const CreateGraph = () => {
    return new StateGraph(DatasetGraphState)
        .addNode('analyzePurpose', new AnalyzePurposeNode().run)
        .addNode('generateDataset', new GenerateDatasetNode().run)
        .addEdge(START, 'analyzePurpose')
        .addEdge('analyzePurpose', 'generateDataset')
        .addEdge('generateDataset', END)
        .compile();
};

export namespace Graph {
    export class Dataset {
        private graph = CreateGraph();

        async run(input: string): Promise<DatasetResponse> {
            const result = await this.graph.invoke({
                input: input,
            });

            return {
                dataset: result.dataset,
            };
        }
    }
}
