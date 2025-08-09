const crypto = require('crypto');
const Link = require('../models/Link');
const Sale = require('../models/Sale');
const { MONGODB_URI } = require('../config');

let useMemory = !MONGODB_URI;
const memory = { links: [], sales: [] };

const eligibleSort = (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0);

function isMongo() {
  return !useMemory && !!MONGODB_URI;
}

/* ----------------------------- In-Memory Helpers ----------------------------- */

function memFindByIdFlexible(idMaybe) {
  const s = String(idMaybe || '').trim();
  if (!s) return null;
  // exact
  let hit = memory.links.find(l => String(l._id) === s);
  if (hit) return hit;
  // suffix (what you see in /list)
  hit = memory.links.find(l => String(l._id).endsWith(s));
  if (hit) return hit;
  // prefix
  hit = memory.links.find(l => String(l._id).startsWith(s));
  return hit || null;
}

/* --------------------------------- mem API ---------------------------------- */

const memAPI = {
  async createLink(data) {
    const id = crypto.randomUUID();
    const doc = {
      _id: id,
      createdAt: new Date(),
      updatedAt: new Date(),
      milestonesNotified: [],
      milestoneBaseRevenue: Number(data?.milestoneBaseRevenue || 0),
      lastDailyPrompt: '',
      ...data,
    };
    memory.links.push(doc);
    return doc;
  },

  async updateLink(idMaybe, patch) {
    const link = memFindByIdFlexible(idMaybe);
    if (!link) return null;
    const idx = memory.links.findIndex(l => String(l._id) === String(link._id));
    if (idx === -1) return null;
    memory.links[idx] = { ...memory.links[idx], ...patch, updatedAt: new Date() };
    return memory.links[idx];
  },

  async deleteLink(idMaybe) {
    const link = memFindByIdFlexible(idMaybe);
    if (!link) return 0;
    const idx = memory.links.findIndex(l => String(l._id) === String(link._id));
    if (idx === -1) return 0;
    memory.links.splice(idx, 1);
    return 1;
  },

  async listLinks() { return [...memory.links].sort(eligibleSort); },

  async getLink(idMaybe) {
    return memFindByIdFlexible(idMaybe);
  },

  async firstEligibleLink() {
    const list = [...memory.links]
      .filter(l => l.active && Number(l.currentRevenue) < Number(l.targetRevenue))
      .sort(eligibleSort);
    return list[0] || null;
  },

  async createSale(data) {
    const id = crypto.randomUUID();
    const doc = { _id: id, createdAt: new Date(), updatedAt: new Date(), ...data };
    memory.sales.push(doc);
    return doc;
  },

  async listSales(limit = 10000) {
    return [...memory.sales].sort((a,b)=>b.createdAt - a.createdAt).slice(0, limit);
  },

  isMemory() { return true; }
};

/* ------------------------------ Mongo Helpers ------------------------------- */

/**
 * Resolve a real ObjectId for a link, accepting:
 * - full ObjectId
 * - any suffix of the id (what you display in /list)
 * - any prefix of the id
 */
async function mongoResolveLinkId(idMaybe) {
  const s = String(idMaybe || '').trim();
  if (!s) return null;

  // Try exact first (will also try cast)
  try {
    const exact = await Link.findById(s).select('_id').lean();
    if (exact) return String(exact._id);
  } catch (_) {
    // ignore cast error; we'll try flexible matching next
  }

  // Fallback: scan ids and match suffix/prefix
  const all = await Link.find({}).select('_id').lean();
  const hit =
    all.find(d => String(d._id).endsWith(s)) ||
    all.find(d => String(d._id).startsWith(s));
  return hit ? String(hit._id) : null;
}

/* -------------------------------- mongo API --------------------------------- */

const mongoAPI = {
  async createLink(data) {
    return (await Link.create(data)).toObject();
  },

  async updateLink(idMaybe, patch) {
    const realId = await mongoResolveLinkId(idMaybe);
    if (!realId) return null;
    return await Link.findByIdAndUpdate(realId, patch, { new: true }).lean();
  },

  async deleteLink(idMaybe) {
    const realId = await mongoResolveLinkId(idMaybe);
    if (!realId) return 0;
    const r = await Link.deleteOne({ _id: realId });
    return r.deletedCount || 0;
  },

  async listLinks() {
    return await Link.find({}).sort({ createdAt: 1 }).lean();
  },

  async getLink(idMaybe) {
    const realId = await mongoResolveLinkId(idMaybe);
    if (!realId) return null;
    try { return await Link.findById(realId).lean(); } catch { return null; }
  },

  async firstEligibleLink() {
    return await Link.findOne({
      active: true,
      $expr: { $lt: ['$currentRevenue', '$targetRevenue'] }
    }).sort({ createdAt: 1 }).lean();
  },

  async createSale(data) {
    return (await Sale.create(data)).toObject();
  },

  async listSales(limit = 10000) {
    return await Sale.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  },

  isMemory() { return false; }
};

/* ----------------------------- Export Dispatcher ---------------------------- */

let API = useMemory ? memAPI : mongoAPI;

function swapToMemory() { useMemory = true; API = memAPI; }
function swapToMongo()  { useMemory = false; API = mongoAPI; }

module.exports = {
  DB: API,
  swapToMemory,
  swapToMongo,
  isMongo,
  useMemory: () => useMemory
};
