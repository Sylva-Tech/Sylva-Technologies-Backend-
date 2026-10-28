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
    const subCounty = String(req.query.subCounty || '').trim();
    const ward = String(req.query.ward || '').trim();
    if (!country || !county) return res.status(400).json({ success: false, message: 'Choose a country and county to calculate delivery.' });
    if (country.toLowerCase() !== 'kenya') {
      return res.status(422).json({ success: false, message: 'Online shipping rates are currently configured for Kenya only. Please contact support for international delivery.' });
    }
    const canonicalCounty = COUNTY_DEFAULTS.find(item => item.toLowerCase() === county.toLowerCase());
    if (!canonicalCounty) return res.status(422).json({ success: false, message: 'Choose a valid Kenyan county.' });
    await ensureDefaultRates();
    const rate = await ShippingRate.findOne({ country: 'Kenya', county: canonicalCounty, active: true }).lean();
    if (!rate) return res.status(422).json({ success: false, message: 'Delivery is not currently available for this county. Please contact support.' });
    const normalize = value => String(value || '').trim().toLocaleLowerCase();
    const overrides = Array.isArray(rate.regionalRates) ? rate.regionalRates : [];
    const regional = (ward && subCounty ? overrides.find(item => item.active && normalize(item.subCounty) === normalize(subCounty) && normalize(item.ward) === normalize(ward)) : null)
      || (subCounty ? overrides.find(item => item.active && normalize(item.subCounty) === normalize(subCounty) && !normalize(item.ward)) : null);
    const applicable = regional || rate;
    const scope = regional ? (regional.ward ? 'ward' : 'subCounty') : 'county';
    return res.json({ success: true, quote: { country: rate.country, county: rate.county, subCounty: regional?.subCounty || subCounty, ward: regional?.ward || ward, scope, fee: applicable.fee, deliveryMinDays: applicable.deliveryMinDays, deliveryMaxDays: applicable.deliveryMaxDays, estimate: applicable.deliveryMinDays === applicable.deliveryMaxDays ? `Within ${applicable.deliveryMinDays} day${applicable.deliveryMinDays === 1 ? '' : 's'}` : `${applicable.deliveryMinDays}–${applicable.deliveryMaxDays} days` } });
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


router.post('/rates/:id/regions', protect, adminOnly, async (req, res) => {
  try {
    const subCounty = String(req.body?.subCounty || '').trim();
    const ward = String(req.body?.ward || '').trim();
    const fee = Number(req.body?.fee);
    const deliveryMinDays = Number(req.body?.deliveryMinDays);
    const deliveryMaxDays = Number(req.body?.deliveryMaxDays);
    const active = req.body?.active !== false;
    if (!subCounty || !Number.isFinite(fee) || fee < 0 || !Number.isInteger(deliveryMinDays) || deliveryMinDays < 1 || !Number.isInteger(deliveryMaxDays) || deliveryMaxDays < deliveryMinDays) {
      return res.status(400).json({ success: false, message: 'Choose a sub-county and enter a valid fee and delivery range.' });
    }
    const rate = await ShippingRate.findById(req.params.id);
    if (!rate) return res.status(404).json({ success: false, message: 'County shipping rate not found.' });
    const normalize = value => String(value || '').trim().toLocaleLowerCase();
    const existing = rate.regionalRates.find(item => normalize(item.subCounty) === normalize(subCounty) && normalize(item.ward) === normalize(ward));
    if (existing) {
      existing.fee = fee;
      existing.deliveryMinDays = deliveryMinDays;
      existing.deliveryMaxDays = deliveryMaxDays;
      existing.active = active;
    } else {
      rate.regionalRates.push({ subCounty, ward, fee, deliveryMinDays, deliveryMaxDays, active });
    }
    await rate.save();
    return res.json({ success: true, rate: rate.toObject(), message: 'Regional shipping rate saved.' });
  } catch (error) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid shipping rate ID.' });
    console.error('Regional shipping rate save failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to save regional shipping rate.' });
  }
});

router.put('/rates/:id/regions/:regionId', protect, adminOnly, async (req, res) => {
  try {
    const rate = await ShippingRate.findById(req.params.id);
    if (!rate) return res.status(404).json({ success: false, message: 'County shipping rate not found.' });
    const region = rate.regionalRates.id(req.params.regionId);
    if (!region) return res.status(404).json({ success: false, message: 'Regional shipping rate not found.' });
    const fee = Number(req.body?.fee);
    const deliveryMinDays = Number(req.body?.deliveryMinDays);
    const deliveryMaxDays = Number(req.body?.deliveryMaxDays);
    if (!Number.isFinite(fee) || fee < 0 || !Number.isInteger(deliveryMinDays) || deliveryMinDays < 1 || !Number.isInteger(deliveryMaxDays) || deliveryMaxDays < deliveryMinDays || typeof req.body?.active !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Enter a valid fee, delivery range, and enabled status.' });
    }
    region.fee = fee;
    region.deliveryMinDays = deliveryMinDays;
    region.deliveryMaxDays = deliveryMaxDays;
    region.active = req.body.active;
    await rate.save();
    return res.json({ success: true, rate: rate.toObject(), message: 'Regional shipping rate updated.' });
  } catch (error) {
    if (error.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid shipping rate or region ID.' });
    console.error('Regional shipping rate update failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to update regional shipping rate.' });
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
    const rate = await ShippingRate.findByIdAndUpdate(req.params.id, { $set: { fee, deliveryMinDays, deliveryMaxDays, active } }, { returnDocument: 'after', runValidators: true });
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
  const subCounty = String(customerDetails?.subCounty || '').trim();
  const ward = String(customerDetails?.ward || '').trim();
  if (country.toLowerCase() !== 'kenya' || !county) throw new Error('Choose Kenya and a county to calculate shipping.');
  const canonicalCounty = COUNTY_DEFAULTS.find(item => item.toLowerCase() === county.toLowerCase());
  if (!canonicalCounty) throw new Error('Choose a valid Kenyan county.');
  await ensureDefaultRates();
  const rate = await ShippingRate.findOne({ country: 'Kenya', county: canonicalCounty, active: true }).lean();
  if (!rate) throw new Error('Delivery is not available for the selected county. Please contact support.');
  const normalize = value => String(value || '').trim().toLocaleLowerCase();
  const overrides = Array.isArray(rate.regionalRates) ? rate.regionalRates : [];
  const regional = (ward && subCounty ? overrides.find(item => item.active && normalize(item.subCounty) === normalize(subCounty) && normalize(item.ward) === normalize(ward)) : null)
    || (subCounty ? overrides.find(item => item.active && normalize(item.subCounty) === normalize(subCounty) && !normalize(item.ward)) : null);
  const applicable = regional || rate;
  return { fee: applicable.fee, deliveryMinDays: applicable.deliveryMinDays, deliveryMaxDays: applicable.deliveryMaxDays, county: rate.county, subCounty: regional?.subCounty || subCounty, ward: regional?.ward || ward, scope: regional ? (regional.ward ? 'ward' : 'subCounty') : 'county', country: rate.country };
};
