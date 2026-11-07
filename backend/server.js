'use strict';
require('dotenv').config();
const { loadConfig } = require('./src/config');
const { createApp } = require('./src/app');
const { createSqlModels } = require('./src/models');
const { createGeminiClient } = require('./src/services/gemini-client');

async function main() {
  const config = loadConfig(); // throws in production without a strong JWT_SECRET
  if (config.jwtSecretEphemeral) console.warn('[config] JWT_SECRET chưa đặt: dùng khóa tạm thời, token sẽ mất hiệu lực khi khởi động lại.');
  if (!config.gemini.apiKey) console.warn('[config] GEMINI_API_KEY chưa đặt: /ai/chat sẽ trả 503 ai_unavailable.');

  const { models, pool } = await createSqlModels(config.db);
  const ai = createGeminiClient(config.gemini);
  const app = createApp({ models, config, ai });
  const server = app.listen(config.port, () => console.log(`PetCare AI Hub API: http://localhost:${config.port}/api/v1`));

  const stop = () => server.close(() => pool.close().finally(() => process.exit(0)));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => { console.error('Không khởi động được máy chủ:', e.message); process.exit(1); });
