require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');

const categorySeed = [
  { name: 'Laptops', slug: 'laptops', description: 'Business and personal laptop devices.' },
  { name: 'Desktops', slug: 'desktops', description: 'Desktop computing systems.' },
  { name: 'Accessories', slug: 'accessories', description: 'Daily-use accessories and peripherals.' },
  { name: 'Networking', slug: 'networking', description: 'Routers, switches and connectivity gear.' },
  { name: 'Components', slug: 'components', description: 'Parts for upgrades and repairs.' },
  { name: 'Audio', slug: 'audio', description: 'Speakers, headphones and audio gear.' },
  { name: 'Refurbished Laptops', slug: 'refurbished-laptops', description: 'Affordable quality refurbished laptops.' },
];

const productSeed = [
  {
    name: 'Dell Latitude 5420',
    slug: 'dell-latitude-5420',
    sku: 'DL5420-01',
    brand: 'Dell',
    category: 'Laptops',
    subcategory: 'Business Laptops',
    description: 'A reliable business laptop built for productivity and portability.',
    shortDescription: '14-inch business laptop with strong performance.',
    price: 54000,
    oldPrice: 62000,
    stock: 8,
    condition: 'Refurbished',
    featured: true,
    isNew: false,
    images: ['https://images.unsplash.com/...'],
    specifications: {
      processor: 'Core i5 11th Gen',
      ram: '16GB',
      storage: '512GB SSD',
      display: '14-inch FHD',
      graphics: 'Intel Iris Xe',
      operatingSystem: 'Windows 11 Pro',
      warranty: '6 Months',
    },
  },
  {
    name: 'HP ProBook 450 G8',
    slug: 'hp-probook-450-g8',
    sku: 'HP450G8-01',
    brand: 'HP',
    category: 'Laptops',
    subcategory: 'Business Laptops',
    description: 'A sleek business laptop with dependable performance for office work.',
    shortDescription: 'Professional laptop for office and business use.',
    price: 59000,
    oldPrice: 68000,
    stock: 6,
    condition: 'Refurbished',
    featured: true,
    isNew: false,
    images: ['https://images.unsplash.com/...'],
    specifications: {
      processor: 'Core i7 11th Gen',
      ram: '16GB',
      storage: '1TB SSD',
      display: '15.6-inch FHD',
      graphics: 'Intel UHD',
      operatingSystem: 'Windows 11 Pro',
      warranty: '6 Months',
    },
  },
  {
    name: 'Lenovo ThinkCentre M70t',
    slug: 'lenovo-thinkcentre-m70t',
    sku: 'LENM70T-01',
    brand: 'Lenovo',
    category: 'Desktops',
    subcategory: 'Office Desktop',
    description: 'Compact desktop workstation for everyday business and productivity tasks.',
    shortDescription: 'Compact desktop with reliable energy-efficient performance.',
    price: 48000,
    oldPrice: 56000,
    stock: 11,
    condition: 'New',
    featured: false,
    isNew: true,
    images: ['https://images.unsplash.com/...'],
    specifications: {
      processor: 'Intel Core i5',
      ram: '8GB',
      storage: '512GB SSD',
      graphics: 'Intel UHD',
      operatingSystem: 'Windows 11',
      warranty: '12 Months',
    },
  },
  {
    name: 'JBL Flip 6',
    slug: 'jbl-flip-6',
    sku: 'JBLFLIP6-01',
    brand: 'JBL',
    category: 'Audio',
    subcategory: 'Bluetooth Speakers',
    description: 'Portable speaker delivering powerful sound and deep bass for indoor and outdoor use.',
    shortDescription: 'Portable portable speaker with punchy sound.',
    price: 18000,
    oldPrice: 21500,
    stock: 14,
    condition: 'New',
    featured: true,
    isNew: true,
    images: ['https://images.unsplash.com/...'],
    specifications: {
      connectivity: 'Bluetooth 5.3',
      battery: '12 Hours',
      output: 'Portable stereo',
      warranty: '12 Months',
    },
  },
  {
    name: 'TP-Link Archer AX23',
    slug: 'tp-link-archer-ax23',
    sku: 'TPLAX23-01',
    brand: 'TP-Link',
    category: 'Networking',
    subcategory: 'Routers',
    description: 'Dual-band Wi-Fi 6 router designed for homes and small offices.',
    shortDescription: 'Fast Wi-Fi 6 router for reliable connectivity.',
    price: 15000,
    oldPrice: 17500,
    stock: 10,
    condition: 'New',
    featured: false,
    isNew: true,
    images: ['https://images.unsplash.com/...'],
    specifications: {
      speed: 'AX1800',
      coverage: 'Up to 200 sq m',
      ports: '4 x LAN, 1 x WAN',
      warranty: '12 Months',
    },
  },
  {
    name: 'Crucial 16GB DDR4 RAM',
    slug: 'crucial-16gb-ddr4-ram',
    sku: 'CRUCIAL16-01',
    brand: 'Crucial',
    category: 'Components',
    subcategory: 'RAM',
    description: 'High-performance RAM upgrade for faster multitasking and smooth system responsiveness.',
    shortDescription: 'DDR4 RAM upgrade for everyday computing.',
    price: 7000,
    oldPrice: 8500,
    stock: 20,
    condition: 'New',
    featured: false,
    isNew: true,
    images: ['https://images.unsplash.com/...'],
    specifications: {
      type: 'DDR4',
      capacity: '16GB',
      speed: '3200MHz',
      warranty: '12 Months',
    },
  },
];

const run = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is required before running the seed script.');
    }

    await mongoose.connect(process.env.MONGODB_URI);

    const categories = await Category.insertMany(
      categorySeed.map((item) => ({
        ...item,
        isActive: true,
      }))
    );

    const categoryMap = categories.reduce((acc, category) => {
      acc[category.name] = category._id;
      return acc;
    }, {});

    const preparedProducts = productSeed.map((item) => ({
      ...item,
      category: categoryMap[item.category],
      isActive: true,
      discount: item.oldPrice ? Math.max(0, Math.round(((item.oldPrice - item.price) / item.oldPrice) * 100)) : 0,
    }));

    await Product.deleteMany({});
    await Product.insertMany(preparedProducts);

    console.log('Seed data inserted successfully');
    process.exit(0);
  } catch (error) {
    console.error('Failed to seed database:', error.message);
    process.exit(1);
  }
};

run();
