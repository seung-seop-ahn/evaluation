import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFParse } from 'pdf-parse';

export interface PdfDocument {
    file: string;
    text: string;
}

export class PdfUtil {
    static async loadFromDirectory(directory: string): Promise<PdfDocument[]> {
        const files = (await readdir(directory)).filter((file) => file.toLowerCase().endsWith('.pdf'));

        return Promise.all(files.map((file) => PdfUtil.loadFile(path.join(directory, file))));
    }

    static async loadFile(filePath: string): Promise<PdfDocument> {
        const parser = new PDFParse({ data: await readFile(filePath) });

        try {
            const result = await parser.getText();
            return { file: path.basename(filePath), text: result.text };
        } finally {
            await parser.destroy();
        }
    }
}
