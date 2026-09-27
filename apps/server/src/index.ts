import { buildApp } from './app.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const app = await buildApp(env);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Encerrando WhatsErase');
  await app.close();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
