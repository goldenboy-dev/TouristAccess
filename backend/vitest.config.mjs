import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // Pinned so the money-related assertions are exact numbers instead of
    // whatever the developer happens to have in their .env.
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      ADULT_PRICE: '10000',
      ALERT_FREE_PP_CRITICAL: '20',
      ALERT_FREE_PP_WARNING: '10',
      ALERT_FREE_PCT_LIMIT: '25',
      HISTORY_DAYS: '30',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
    },
    coverage: {
      include: ['src/**/*.js'],
      reporter: ['text', 'html'],
    },
  },
});
