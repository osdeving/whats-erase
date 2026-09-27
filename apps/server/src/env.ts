import { z } from 'zod';

const httpUrl = z.string().url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
  message: 'Use uma URL HTTP ou HTTPS.',
});

const evolutionBaseUrl = httpUrl.refine((value) => {
  const parsed = new URL(value);
  return !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
}, 'Nao use credenciais, query string ou fragmento na URL da Evolution.');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  DATABASE_URL: z.string().min(1),
  APP_ENCRYPTION_KEY: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  BUNDLED_EVOLUTION_URL: evolutionBaseUrl.default('http://localhost:8080'),
  PUBLIC_EVOLUTION_URL: httpUrl.default('http://localhost:8080'),
  BUNDLED_EVOLUTION_API_KEY: z.string().min(1).optional(),
  WEBHOOK_URL: httpUrl.default('http://localhost:3000/api/webhooks/evolution'),
  WORKER_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(1_000),
  LOG_LEVEL: z.string().default('info'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Configuracao de ambiente invalida: ${details}`);
  }

  const decodedKey = Buffer.from(parsed.data.APP_ENCRYPTION_KEY, 'base64');
  if (decodedKey.length !== 32) {
    throw new Error('APP_ENCRYPTION_KEY precisa ser uma chave de 32 bytes em base64. Rode ./scripts/setup.sh.');
  }

  return parsed.data;
}
