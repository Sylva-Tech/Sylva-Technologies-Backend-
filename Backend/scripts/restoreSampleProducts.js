require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');

const samples = [
  { name: 'Dell Latitude 5420', sku: 'DL5420-01', brand: 'Dell', category: 'Laptops', description: 'A reliable business laptop built for productivity and portability.', shortDescription: '14-inch business laptop with Core i5 performance.', price: 54000, oldPrice: 62000, stock: 8, condition: 'Refurbished', featured: true, flashSale: true, offer: true, offerMessage: 'Perfect for work and business', images: ['https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=900&q=80'], specifications: { processor: 'Core i5 11th Gen', ram: '16GB', storage: '512GB SSD', display: '14-inch FHD', warranty: '6 Months' } },
  { name: 'HP ProBook 450 G8', sku: 'HP450G8-01', brand: 'HP', category: 'Laptops', description: 'A dependable business laptop for office work, study and daily computing.', shortDescription: 'Professional laptop for office and business use.', price: 59000, oldPrice: 68000, stock: 6, condition: 'Refurbished', featured: true, offer: true, offerMessage: 'Reliable everyday computing', images: ['https://images.unsplash.com/photo-1541807084-5c52b6b3adef?auto=format&fit=crop&w=900&q=80'], specifications: { processor: 'Core i7 11th Gen', ram: '16GB', storage: '1TB SSD', display: '15.6-inch FHD', warranty: '6 Months' } },
  { name: 'Lenovo ThinkCentre M70t', sku: 'LENM70T-01', brand: 'Lenovo', category: 'Desktops', description: 'Compact desktop workstation for everyday business and productivity tasks.', shortDescription: 'Compact desktop with reliable performance.', price: 48000, oldPrice: 56000, stock: 11, condition: 'New', featured: true, isNew: true, flashSale: true, offer: true, offerMessage: 'Power meets performance', images: ['https://images.unsplash.com/photo-1587831990711-23ca6441447b?auto=format&fit=crop&w=900&q=80'], specifications: { processor: 'Intel Core i5', ram: '8GB', storage: '512GB SSD', warranty: '12 Months' } },
  { name: 'JBL Flip 6', sku: 'JBLFLIP6-01', brand: 'JBL', category: 'Audio', description: 'Portable speaker delivering powerful sound and deep bass indoors or outdoors.', shortDescription: 'Portable speaker with punchy sound.', price: 18000, oldPrice: 21500, stock: 14, condition: 'New', featured: true, isNew: true, flashSale: true, offer: true, offerMessage: 'Powerful sound anywhere', images: ['https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=900&q=80'], specifications: { connectivity: 'Bluetooth 5.3', battery: '12 Hours', warranty: '12 Months' } },
  { name: 'TP-Link Archer AX23', sku: 'TPLAX23-01', brand: 'TP-Link', category: 'Networking', description: 'Dual-band Wi-Fi 6 router designed for homes and small offices.', shortDescription: 'Fast Wi-Fi 6 for reliable connectivity.', price: 15000, oldPrice: 17500, stock: 10, condition: 'New', featured: true, isNew: true, flashSale: true, offer: true, offerMessage: 'Upgrade your Wi-Fi', images: ['https://images.unsplash.com/photo-1606904825846-647eb07f5be2?auto=format&fit=crop&w=900&q=80'], specifications: { speed: 'AX1800', ports: '4 x LAN, 1 x WAN', warranty: '12 Months' } },
  { name: 'Crucial 16GB DDR4 RAM', sku: 'CRUCIAL16-01', brand: 'Crucial', category: 'Components', description: 'High-performance RAM upgrade for faster multitasking and smooth system responsiveness.', shortDescription: 'DDR4 RAM upgrade for everyday computing.', price: 7000, oldPrice: 8500, stock: 20, condition: 'New', featured: true, isNew: true, offer: true, offerMessage: 'Make your computer feel faster', images: ['https://images.unsplash.com/photo-1562976540-1502c2145186?auto=format&fit=crop&w=900&q=80'], specifications: { type: 'DDR4', capacity: '16GB', speed: '3200MHz', warranty: '12 Months' } },
  { name: 'Logitech Wireless Mouse M185', sku: 'LOGM185-01', brand: 'Logitech', category: 'Accessories', description: 'A compact wireless mouse with reliable plug-and-play control for work and study.', shortDescription: 'Smooth and precise wireless control.', price: 2200, oldPrice: 2800, stock: 25, condition: 'New', featured: true, isNew: true, flashSale: true, offer: true, offerMessage: 'Smooth and precise control', images: ['https://images.unsplash.com/photo-1527814050087-3793815479db?auto=format&fit=crop&w=900&q=80'], specifications: { connectivity: '2.4GHz wireless', battery: '12 Months', warranty: '12 Months' } },
];

const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');

async function restore() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI);
  const categoryMap = {};
  for (const name of ['Laptops', 'Desktops', 'Accessories', 'Networking', 'Components', 'Audio']) {
    const category = await Category.findOneAndUpdate({ slug: slugify(name) }, { $setOnInsert: { name, slug: slugify(name), description: `${name} products.` }, $set: { isActive: true } }, { upsert: true, new: true });
    categoryMap[name] = category._id;
  }
  for (const sample of samples) {
    const { category, ...data } = sample;
    await Product.findOneAndUpdate({ sku: sample.sku }, { ...data, slug: slugify(sample.name), category: categoryMap[category], discount: Math.max(0, Math.round(((sample.oldPrice - sample.price) / sample.oldPrice) * 100)), isActive: true }, { upsert: true, new: true, setDefaultsOnInsert: true });
  }
  console.log(`Restored ${samples.length} sample products with active offers.`);
  await mongoose.disconnect();
}

restore().catch(async (error) => { console.error('Failed to restore sample products:', error.message); await mongoose.disconnect(); process.exit(1); });
