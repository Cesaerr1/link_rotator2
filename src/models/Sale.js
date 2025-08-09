const mongoose = require('mongoose');

const saleSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true }, // negative allowed (adjustments)
    host: { type: String, default: '' },
    linkId: { type: mongoose.Schema.Types.ObjectId, required: false },
    at: { type: Date, default: Date.now },
    source: { type: String, enum: ['pixel', 'manual', 'adjustment'], default: 'pixel' },
    note: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Sale || mongoose.model('Sale', saleSchema);
