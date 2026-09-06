import path from 'node:path';

export class PathUtil {
    static projectRoot(): string {
        return process.cwd();
    }

    static resolveFromRoot(...segments: string[]): string {
        return path.resolve(PathUtil.projectRoot(), ...segments);
    }
}
