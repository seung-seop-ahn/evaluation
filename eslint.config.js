import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['node_modules'] },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    prettierConfig,
    {
        plugins: {
            'simple-import-sort': simpleImportSort,
        },
        rules: {
            'simple-import-sort/imports': 'error',
            'simple-import-sort/exports': 'error',
            // langchain 제네릭 제약(Record<string, any>)과 namespace 기반 구조를 사용 중이라 허용
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-namespace': 'off',
        },
    },
);
