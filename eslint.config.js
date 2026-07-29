import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'public/sw.js'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
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
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        {
          // toISOString() yields the UTC date. In a product where midnight is a deadline
          // and a day is a unit of moral accounting, a member at UTC-5 would see the day
          // roll over at 19:00. Use getLocalDateString(tz) from @/lib/date.
          //
          // Mirror note: the same rule is stated in the header of src/lib/date.ts, and
          // the behaviour it protects is asserted in src/lib/date.test.ts.
          selector: "MemberExpression[property.name='toISOString']",
          message:
            'Do not derive a calendar date from toISOString() — it is UTC. Use getLocalDateString(tz) from @/lib/date.',
        },
      ],
    },
  },
  {
    // Money is bigint minor units end to end. Float helpers are how major units sneak
    // back in; the mirror of this rule lives in the runtime guards in src/lib/money.ts.
    files: ['src/lib/money.ts', 'src/features/ledger/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Money is bigint minor units. Use parseMoney() from @/lib/money.' },
      ],
      'no-restricted-properties': [
        'error',
        { property: 'toFixed', message: 'Money is bigint minor units. Use formatMoney() from @/lib/money.' },
      ],
    },
  },
  {
    // Tests are where UTC instants are legitimately named: asserting that local
    // midnight in New York is 05:00Z, and demonstrating the toISOString() bug itself,
    // both require saying "UTC" out loud. The ban protects application code, which has
    // no reason to.
    files: ['tests/**/*.ts', 'src/**/*.test.ts', 'scripts/**/*.{ts,mjs}', '*.config.{ts,js}'],
    languageOptions: { globals: globals.node },
    rules: { 'no-restricted-syntax': 'off' },
  },
);
