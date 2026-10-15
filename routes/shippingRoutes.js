const express = require('express');
const ShippingRate = require('../models/ShippingRate');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

const COUNTY_DEFAULTS = ["Baringo","Bomet","Bungoma","Busia","Elgeyo-Marakwet","Embu","Garissa","Homa Bay","Isiolo","Kajiado","Kakamega","Kericho","Kiambu","Kilifi","Kirinyaga","Kisii","Kisumu","Kitui","Kwale","Laikipia","Lamu","Machakos","Makueni","Mandera","Marsabit","Meru","Migori","Mombasa","Murang'a","Nairobi","Nakuru","Nandi","Narok","Nyamira","Nyandarua","Nyeri","Samburu","Siaya","Taita-Taveta","Tana River","Tharaka-Nithi","Trans Nzoia","Turkana","Uasin Gishu","Vihiga","Wajir","West Pokot"];
const DEFAULT_RATE = county => ({
  country: 'Kenya',
  county,
  fee: county === 'Nairobi' ? 200 : 500,
  deliveryMinDays: county === 'Nairobi' ? 1 : 2,
  deliveryMaxDays: county === 'Nairobi' ? 1 : 4,
  active: true,
});

async function ensureDefaultRates() {
  const existingCount = await ShippingRate.countDocuments({ country: 'Kenya' });
  if (existingCount >= COUNTY_DEFAULTS.length) return;
  const operations = COUNTY_DEFAULTS.map(county => ({
    updateOne: {
      filter: { country: 'Kenya', county },
      update: { $setOnInsert: DEFAULT_RATE(county) },
      upsert: true,
    },
  }));
  if (operations.length) await ShippingRate.bulkWrite(operations);
}

router.get('/quote', async (req, res) => {
  try {
    const country = String(req.query.country || '').trim();
    const county = String(req.query.county || '').trim();
    if (!country || !county) return res.status(400).json({ success: false, message: 'Choose a country and county to calculate delivery.' });
    if (country.toLowerCase() !== 'kenya') {
      return res.status(422).json({ success: false, message: 'Online shipping rates are currently configured for Kenya only. Please contact support for international delivery.' });
    }
    const canonicalCounty = COUNTY_DEFAULTS.find(item => item.toLowerCase() === county.toLowerCase());
    if (!canonicalCounty) return res.status(422).json({ success: false, message: 'Choose a valid Kenyan county.' });
    await ensureDefaultRates();
    const rate = await ShippingRate.findOne({ country: 'Kenya', county: canonicalCounty, active: true }).lean();
    if (!rate) return res.status(422).json({ success: false, message: 'Delivery is not currently available for this county. Please contact support.' });
    return res.json({ success: true, quote: { country: rate.country, county: rate.county, fee: rate.fee, deliveryMinDays: rate.deliveryMinDays, deliveryMaxDays: rate.deliveryMaxDays, estimate: rate.deliveryMinDays === rate.deliveryMaxDays ? `Within ${rate.deliveryMinDays} day${rate.deliveryMinDays === 1 ? '' : 's'}` : `${rate.deliveryMinDays}–${rate.deliveryMaxDays} days` } });
  } catch (error) {
    console.error('Shipping quote failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to calculate shipping. Please try again.' });
  }
});

router.get('/rates', protect, adminOnly, async (_req, res) => {
  try {
    await ensureDefaultRates();
    const rates = await ShippingRate.find({ country: 'Kenya' }).sort({ county: 1 }).lean();
    return res.json({ success: true, rates });
  } catch (error) {
    console.error('Shipping rates load failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load shipping rates.' });
  }
});

router.put('/rates/:id', protect, adminOnly, async (req, res) => {
  try {
    const fee = Number(req.body?.fee);
    const deliveryMinDays = Number(req.body?.deliveryMinDays);
    const deliveryMaxDays = Number(req.body?.deliveryMaxDays);
    const active = req.body?.active;
    if (!Number.isFinite(fee) || fee < 0 || !Number.isInteger(deliveryMinDays) || deliveryMinDays < 1 || !Number.isInteger(deliveryMaxDays) || deliveryMaxDays < deliveryMinDays || typeof active !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Enter a non-negative fee, valid delivery day range, and active status.' });
    }
    const rate = await ShippingRate.findByIdAndUpdate(req.params.id, { $set: { fee, deliveryMinDays, deliveryMaxDays, active } }, { new: true, runValidators: true });
    if (!rate) return res.status(404).json({ success: false, message: 'Shipping rate not found.' });
    return res.json({ success: true, rate, message: 'Shipping rate saved.' });
  } catch (error) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid shipping rate ID.' });
    console.error('Shipping rate update failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to save shipping rate.' });
  }
});

module.exports = router;
module.exports.ensureDefaultRates = ensureDefaultRates;
module.exports.getQuote = async customerDetails => {
  const country = String(customerDetails?.country || '').trim();
  const county = String(customerDetails?.county || '').trim();
  if (country.toLowerCase() !== 'kenya' || !county) throw new Error('Choose Kenya and a county to calculate shipping.');
  const canonicalCounty = COUNTY_DEFAULTS.find(item => item.toLowerCase() === county.toLowerCase());
  if (!canonicalCounty) throw new Error('Choose a valid Kenyan county.');
  await ensureDefaultRates();
  const rate = await ShippingRate.findOne({ country: 'Kenya', county: canonicalCounty, active: true }).lean();
  if (!rate) throw new Error('Delivery is not available for the selected county. Please contact support.');
  return { fee: rate.fee, deliveryMinDays: rate.deliveryMinDays, deliveryMaxDays: rate.deliveryMaxDays, county: rate.county, country: rate.country };
};
