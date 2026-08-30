import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['dist/**', 'node_modules/**'],
    environment: 'node',
    env: {
      DATABASE_PATH: './data/test.sqlite',
      ENABLE_WHATSAPP: 'false',
      FRONTEND_URL: 'http://localhost:5173',
    },
  },
});
