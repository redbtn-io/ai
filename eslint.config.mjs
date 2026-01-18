import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import unusedImports from 'eslint-plugin-unused-imports';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: {
      // Remove unused imports automatically
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
      // Disable base rules that conflict
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      // Allow any for flexibility in AI library
      '@typescript-eslint/no-explicit-any': 'off',
      // Allow require for dynamic imports
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'examples/**', 'docs/**', 'test/**'],
  }
);
