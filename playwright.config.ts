import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4173',
    headless: true,
    viewport: { width: 1280, height: 720 }
  },
  reporter: [['list']]
});
