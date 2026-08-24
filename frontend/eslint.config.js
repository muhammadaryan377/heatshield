import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
    },
  },
  {
    files: [
      'src/pages/Agriculture*.tsx',
      'src/components/agriculture/**/*.{ts,tsx}',
      'src/lib/agricultureApi.ts',
      'src/types/agriculture.ts',
    ],
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      // Agriculture map/provider effects intentionally key off selected IDs and
      // primitive coordinates so Google Maps instances are not recreated when
      // equivalent object references change. Rules-of-hooks remains enforced.
      'react-hooks/exhaustive-deps': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^refreshAnalysis$' }],
    },
  },
)
