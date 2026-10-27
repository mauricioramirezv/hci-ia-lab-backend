import tsParser from '@typescript-eslint/parser';
export default [{ignores:['**/dist/**','**/node_modules/**']},{files:['services/**/*.ts','scripts/**/*.ts'],languageOptions:{parser:tsParser,parserOptions:{ecmaVersion:'latest',sourceType:'module'}},rules:{'no-console':'error'}}];
