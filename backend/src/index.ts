import 'dotenv/config';
import pino from 'pino';
import { app } from './app.js';
import { config } from './config.js';
import { importLegacyTasks } from './repository.js';
import { startScheduler } from './scheduler.js';
import { startWhatsApp, stopWhatsApp } from './whatsapp.js';

const logger = pino();
const imported = importLegacyTasks();
if (imported.imported) logger.info(imported, 'Imported legacy tasks as onboarding drafts');

const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, 'Personal agent API ready'));
const scheduler = startScheduler();
startWhatsApp();

async function shutdown() {
  clearInterval(scheduler);
  await stopWhatsApp();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
