import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.turbo/**', 'docs/reference/**'] },
  ...tseslint.configs.recommended,
  {
    // Imported prototype code is being tightened module by module. TypeScript remains strict.
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['apps/api/src/modules/capability/**/*.ts', 'apps/api/src/common/types/**/*.ts',
      'apps/api/src/common/filters/**/*.ts', 'apps/api/src/common/interceptors/response.interceptor.ts',
      'apps/api/src/modules/customer/customer-visibility.ts', 'apps/api/src/modules/workspace/**/*.ts',
      'apps/api/src/modules/approval/**/*.ts', 'apps/api/src/modules/integration/platform*.ts',
      'apps/api/src/modules/auth/**/*.ts', 'apps/api/src/modules/system/users/**/*.ts',
      'apps/api/src/modules/system/departments/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'error', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
);
