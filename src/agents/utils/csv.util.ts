import { writeFile } from 'node:fs/promises';

import { stringify } from 'csv-stringify/sync';

export class CsvUtil {
    static toCsv<T extends Record<string, unknown>>(rows: T[], columns?: (keyof T & string)[]): string {
        return stringify(rows, {
            header: true,
            columns: columns,
            bom: true,
        });
    }

    static async toCsvFile<T extends Record<string, unknown>>(
        filePath: string,
        rows: T[],
        columns?: (keyof T & string)[],
    ): Promise<void> {
        await writeFile(filePath, CsvUtil.toCsv(rows, columns), 'utf-8');
    }
}
