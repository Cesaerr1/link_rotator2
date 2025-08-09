require('dotenv').config();
const { PORT } = require('./config');
const makeApp = require('./app');
const { connectMongo } = require('./loaders/mongo');
const { initTelegram } = require('./loaders/telegram');
const { startSchedulers } = require('./loaders/schedule');

(async () => {
  await connectMongo();
  const app = makeApp();
  const server = app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
  initTelegram();
  startSchedulers();
  const shutdown = () => { server.close(()=>process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
