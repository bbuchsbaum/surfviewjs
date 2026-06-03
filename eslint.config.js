import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'demo-dist/**',
      'docs/**',
      'coverage/**',
      'node_modules/**',
      'cruft/**',
      '**/*.d.ts',
      'gulpfile.js'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Shipped library source.
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2021 }
    }
  },
  {
    // Tests run under Vitest (node + jsdom) with globals enabled.
    files: ['tests/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...globals.vitest }
    }
  },
  {
    // Build / tooling config files run under Node.
    files: ['*.{js,ts}', 'vite.*.js', 'playwright.config.ts'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    // Project-wide rule tuning. Correctness rules stay at the recommended
    // error level; the two pervasive-but-intentional categories below are
    // relaxed so the gate fails on real bugs, not on existing tech debt.
    rules: {
      // `any` appears throughout the Three.js interop boundary and is tracked
      // by TypeScript rather than lint. Ratchet to 'warn'/'error' over time.
      '@typescript-eslint/no-explicit-any': 'off',
      // Surface unused bindings without blocking; allow intentional `_`-prefixed
      // throwaways (args, vars, caught errors).
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }]
    }
  }
);
