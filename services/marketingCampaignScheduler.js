const mongoose = require('mongoose');
const MarketingCampaign = require('../models/MarketingCampaign');

let timer = null;
let running = false;

// Mark query operators as trusted because Mongoose filter sanitization treats
// untrusted operator-shaped objects as values (and Date paths then reject them).
function buildDueCampaignFilter(now = new Date()) {
  return {
    status: 'scheduled',
    facebookScheduled: mongoose.trusted({ $ne: true }),
    scheduledAt: mongoose.trusted({ $lte: now }),
  };
}

// Durable hand-off: due campaigns are atomically moved to ready_to_publish.
// No social network is contacted until its official publishing integration is configured.
async function processDueMarketingCampaigns() {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const due = await MarketingCampaign.find(buildDueCampaignFilter(now))
      .select('_id').sort({ scheduledAt: 1 }).limit(25).lean();

    for (const item of due) {
      const claimed = await MarketingCampaign.findOneAndUpdate(
        { _id: item._id, ...buildDueCampaignFilter(now) },
        {
          $set: { status: 'ready_to_publish' },
          $push: { activity: { action: 'ready_to_publish', note: 'Schedule reached. Waiting for an enabled official platform publisher.', at: now } },
        },
        { new: true }
      ).select('_id').lean();

      if (claimed) {
        console.log('Marketing campaign ready for publishing:', String(claimed._id));
      }
    }
  } catch (error) {
    console.error('Marketing campaign scheduler error:', error.message);
  } finally {
    running = false;
  }
}

function startMarketingCampaignScheduler() {
  if (timer) return;
  // Polling the database makes scheduled campaigns survive API restarts and deploys.
  timer = setInterval(processDueMarketingCampaigns, 30 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
  processDueMarketingCampaigns();
  console.log('Sylva Marketing Studio scheduler started (Africa/Nairobi).');
}

module.exports = { startMarketingCampaignScheduler, processDueMarketingCampaigns, buildDueCampaignFilter };
