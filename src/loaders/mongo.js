const mongoose = require('mongoose');
const { MONGODB_URI } = require('../config');
const { swapToMongo, swapToMemory } = require('../services/store');

async function connectMongo() {
  if (!MONGODB_URI) {
    console.warn('[DB] MONGODB_URI not set — using in-memory store');
    swapToMemory();
    return;
  }
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 4000 });
    swapToMongo();
    console.log('[DB] Connected to MongoDB');
  } catch (err) {
    console.error('[DB] Mongo connect failed — falling back to in-memory store:', err.message);
    swapToMemory();
  }
}

module.exports = { connectMongo };
