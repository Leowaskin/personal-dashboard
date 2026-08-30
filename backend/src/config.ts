import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(5001),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().default('http://localhost:5001/auth/google/callback'),
  YOUR_WHATSAPP_NUMBER: z.string().optional(),
  OLLAMA_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('llama3'),
  FIRECRAWL_API_KEY: z.string().min(1).optional(),
  BRAVE_SEARCH_API_KEY: z.string().min(1).optional(),
  DATABASE_PATH: z.string().default(path.join(backendDir, 'data', 'dashboard.sqlite')),
  ENABLE_WHATSAPP: z.enum(['true', 'false']).default('true'),
});

export const config = envSchema.parse(process.env);
export const paths = {
  backendDir,
  token: path.join(backendDir, 'token.json'),
  legacyTasks: path.join(backendDir, 'tasks.json'),
};
