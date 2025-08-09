const mongoose = require('mongoose');
const linkSchema = new mongoose.Schema({
  url: { type: String, required: true },
  thankYouUrl: { type: String, default: '' },
  note: { type: String, default: '' },
  targetRevenue: { type: Number, required: true, default: 0 },
  currentRevenue: { type: Number, required: true, default: 0 },
  timezone: { type: String, default: 'UTC' },
  active: { type: Boolean, required: true, default: true },
  milestonesNotified: { type: [Number], default: [] },
  milestoneBaseRevenue: { type: Number, default: 0 },
  lastDailyPrompt: { type: String, default: '' },
}, { timestamps: true });
module.exports = mongoose.models.Link || mongoose.model('Link', linkSchema);
