const express = require('express');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Brand = require('../models/Brand');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

const buildSlug = (value) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

// Seed a broad, editable electronics catalogue without overwriting existing admin changes.
router.post('/admin/seed-catalog', protect, adminOnly, async (req, res) => {
  try {
    const roots = [
      { name: 'Computers', slug: 'computers', description: 'Laptops, desktops, monitors and computer systems.', image: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=1200&q=85' },
      { name: 'Electronics', slug: 'electronics', description: 'Everyday electronics, displays, audio and smart devices.', image: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?auto=format&fit=crop&w=1200&q=85' },
      { name: 'Cameras & Photography', slug: 'cameras-photography', description: 'Digital cameras, action cameras, lenses and photography gear.', image: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=1200&q=85' },
      { name: 'Networking', slug: 'networking', description: 'Routers, switches, access points and network accessories.', image: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1200&q=85' },
      { name: 'Computer Accessories', slug: 'computer-accessories', description: 'Keyboards, mice, docks, webcams and everyday peripherals.', image: 'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?auto=format&fit=crop&w=1200&q=85' },
      { name: 'Computer Components', slug: 'computer-components', description: 'Processors, memory, storage, graphics cards and PC parts.', image: 'https://images.unsplash.com/photo-1591799264318-7e6ef8ddb7ea?auto=format&fit=crop&w=1200&q=85' },
      { name: 'Printers & Scanners', slug: 'printers-scanners', description: 'Printers, scanners, ink, toner and office printing supplies.', image: 'https://images.unsplash.com/photo-1612815154858-60aa4c59eaa6?auto=format&fit=crop&w=1200&q=85' },
      { name: 'Gaming', slug: 'gaming', description: 'Gaming consoles, controllers, headsets and gaming accessories.', image: 'https://images.unsplash.com/photo-1593305841991-05c297ba4575?auto=format&fit=crop&w=1200&q=85' },
      { name: 'Storage & Data', slug: 'storage-data', description: 'External drives, USB flash drives, memory cards and backups.', image: 'https://images.unsplash.com/photo-1597872200969-2b65d56bd16b?auto=format&fit=crop&w=1200&q=85' },
      { name: 'Power & Protection', slug: 'power-protection', description: 'UPS units, surge protectors, chargers and power banks.', image: 'https://images.unsplash.com/photo-1609592806596-b43badae4b2f?auto=format&fit=crop&w=1200&q=85' },
    ];
    const children = [
      ['Computers', 'Laptops', 'laptops', 'Portable computers for work, school and home.'],
      ['Computers', 'Desktops', 'desktops', 'Desktop computers, towers and business PCs.'],
      ['Computers', 'Monitors', 'monitors', 'Computer monitors for productivity, gaming and design.'],
      ['Computers', 'All-in-One PCs', 'all-in-one-pcs', 'Space-saving computers with integrated displays.'],
      ['Computers', 'Workstations', 'workstations', 'High-performance systems for professional workloads.'],
      ['Computers', 'Mini PCs', 'mini-pcs', 'Compact computers for offices and home setups.'],
      ['Electronics', 'Televisions & Displays', 'televisions-displays', 'TVs, display devices and presentation screens.'],
      ['Electronics', 'Speakers & Audio', 'speakers-audio', 'Speakers, headphones, microphones and audio systems.'],
      ['Electronics', 'Smart Devices', 'smart-devices', 'Smart-home devices and connected electronics.'],
      ['Electronics', 'Projectors', 'projectors', 'Projectors and accessories for meetings and home viewing.'],
      ['Cameras & Photography', 'Digital Cameras', 'digital-cameras', 'Mirrorless, DSLR, compact and bridge cameras.'],
      ['Cameras & Photography', 'Action Cameras', 'action-cameras', 'Action cameras and compact adventure video cameras.'],
      ['Cameras & Photography', 'Lenses & Filters', 'camera-lenses-filters', 'Camera lenses, filters and optical accessories.'],
      ['Cameras & Photography', 'Tripods & Lighting', 'tripods-lighting', 'Tripods, stabilisers, flashes and photography lighting.'],
      ['Networking', 'Routers', 'routers', 'Wi-Fi routers and mobile broadband routers.'],
      ['Networking', 'Switches', 'network-switches', 'Managed and unmanaged Ethernet switches.'],
      ['Networking', 'Access Points & Wi-Fi', 'access-points-wifi', 'Wireless access points, mesh systems and Wi-Fi extenders.'],
      ['Networking', 'Cables & Adapters', 'network-cables-adapters', 'Ethernet cables, adapters and network connectors.'],
      ['Computer Accessories', 'Keyboards & Mice', 'keyboards-mice', 'Wired and wireless keyboards, mice and combos.'],
      ['Computer Accessories', 'Docks & Hubs', 'docks-hubs', 'USB-C docks, hubs and port adapters.'],
      ['Computer Accessories', 'Webcams & Headsets', 'webcams-headsets', 'Webcams, headsets and remote-work accessories.'],
      ['Computer Components', 'Memory (RAM)', 'memory-ram', 'Desktop and laptop memory modules.'],
      ['Computer Components', 'SSD & Hard Drives', 'ssd-hard-drives', 'Solid-state drives and hard disk drives.'],
      ['Computer Components', 'Processors & Graphics', 'processors-graphics', 'CPUs, GPUs and graphics components.'],
      ['Printers & Scanners', 'Printers', 'printers', 'Inkjet, laser and multifunction printers.'],
      ['Printers & Scanners', 'Ink & Toner', 'ink-toner', 'Printer cartridges, toner and printing consumables.'],
      ['Gaming', 'Consoles & Controllers', 'consoles-controllers', 'Gaming consoles, controllers and accessories.'],
      ['Gaming', 'Gaming Headsets', 'gaming-headsets', 'Headsets and audio gear for gaming.'],
      ['Storage & Data', 'External Drives', 'external-drives', 'Portable SSDs and external hard drives.'],
      ['Storage & Data', 'USB Drives & Memory Cards', 'usb-drives-memory-cards', 'USB flash drives, SD cards and card readers.'],
      ['Power & Protection', 'UPS & Surge Protection', 'ups-surge-protection', 'Backup power, UPS units and surge protectors.'],
      ['Power & Protection', 'Chargers & Power Banks', 'chargers-power-banks', 'Device chargers, power banks and charging cables.'],
    ];
    const categoryBySlug = new Map();
    let createdCategories = 0;
    for (const item of roots) {
      const existing = await Category.findOne({ slug: item.slug }).select('_id').lean();
      const saved = await Category.findOneAndUpdate(
        { slug: item.slug },
        { $setOnInsert: { ...item, parentCategory: null, isActive: true } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      if (!existing) createdCategories += 1;
      categoryBySlug.set(item.slug, saved._id);
    }
    for (const [parentName, name, slug, description] of children) {
      const parentSlug = roots.find(item => item.name === parentName)?.slug;
      const existing = await Category.findOne({ slug }).select('_id').lean();
      const saved = await Category.findOneAndUpdate(
        { slug },
        { $setOnInsert: { name, slug, description, image: roots.find(item => item.slug === parentSlug)?.image || '', parentCategory: categoryBySlug.get(parentSlug), isActive: true } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      if (!existing) createdCategories += 1;
      categoryBySlug.set(slug, saved._id);
    }

    const brands = [
      ['Acer','Laptops, desktops and displays for work, study and gaming.','https://cdn.simpleicons.org/acer/83B81A'],
      ['Apple','Mac computers, iPad devices and accessories.','https://cdn.simpleicons.org/apple/111111'],
      ['ASUS','Laptops, monitors, networking gear and PC components.','https://cdn.simpleicons.org/asus/00539B'],
      ['Canon','Digital cameras, lenses, printers and imaging equipment.','https://cdn.simpleicons.org/canon/BC0024'],
      ['Dell','Business laptops, desktops, monitors and workstations.','https://cdn.simpleicons.org/dell/007DB8'],
      ['DJI','Drones, gimbals and aerial imaging equipment.','https://cdn.simpleicons.org/dji/111111'],
      ['Epson','Printers, scanners, projectors and imaging solutions.','https://cdn.simpleicons.org/epson/003399'],
      ['Fujifilm','Mirrorless cameras, lenses and photography equipment.','https://cdn.simpleicons.org/fujifilm/ED1A3B'],
      ['GoPro','Action cameras and accessories for adventure recording.','https://cdn.simpleicons.org/gopro/00AEEF'],
      ['HP','Laptops, desktops, printers and business accessories.','https://cdn.simpleicons.org/hp/0096D6'],
      ['Huawei','Networking devices, laptops and connected electronics.','https://cdn.simpleicons.org/huawei/CF0A2C'],
      ['JBL','Speakers, headphones and portable audio products.','https://cdn.simpleicons.org/jbl/FF6600'],
      ['Kingston','Memory modules, SSDs and removable storage.','https://cdn.simpleicons.org/kingston/000000'],
      ['Lenovo','ThinkPad, ThinkBook, Yoga, Legion and desktop computers.','https://cdn.simpleicons.org/lenovo/E2231A'],
      ['Leica','Premium cameras, lenses and optical equipment.','https://cdn.simpleicons.org/leica/D50000'],
      ['Logitech','Keyboards, mice, webcams, headsets and collaboration gear.','https://cdn.simpleicons.org/logitech/00B8FC'],
      ['Microsoft','Windows devices, Surface hardware and productivity accessories.','https://cdn.simpleicons.org/microsoft/5E5E5E'],
      ['MSI','Gaming laptops, motherboards, graphics cards and monitors.','https://cdn.simpleicons.org/msi/FF0000'],
      ['Nikon','DSLR and mirrorless cameras, lenses and imaging equipment.','https://cdn.simpleicons.org/nikon/FFE100'],
      ['Panasonic','Cameras, projectors and consumer electronics.','https://cdn.simpleicons.org/panasonic/0041C0'],
      ['Philips','Monitors, displays, audio and personal electronics.','https://cdn.simpleicons.org/philips/0B5ED7'],
      ['Razer','Gaming laptops, keyboards, mice and headsets.','https://cdn.simpleicons.org/razer/44D62C'],
      ['Samsung','Monitors, storage, displays and consumer electronics.','https://cdn.simpleicons.org/samsung/1428A0'],
      ['SanDisk','USB drives, memory cards and portable storage.','https://cdn.simpleicons.org/sandisk/ED1C24'],
      ['Seagate','Internal and external hard drives and storage systems.','https://cdn.simpleicons.org/seagate/6EBE44'],
      ['Sony','Cameras, lenses, headphones, TVs and entertainment electronics.','https://cdn.simpleicons.org/sony/111111'],
      ['Synology','Network-attached storage and data management systems.','https://cdn.simpleicons.org/synology/000000'],
      ['Tamron','Interchangeable camera lenses for photography and video.','https://cdn.simpleicons.org/tamron/111111'],
      ['TP-Link','Routers, switches, mesh Wi-Fi and smart-home networking.','https://cdn.simpleicons.org/tplink/4ACBD6'],
      ['Ubiquiti','Wireless networking, access points and network infrastructure.','https://cdn.simpleicons.org/ubiquiti/0559C9'],
      ['Western Digital','Hard drives, SSDs and data storage solutions.','https://cdn.simpleicons.org/westerndigital/2478B8'],
      ['Xiaomi','Smart devices, phones, home electronics and accessories.','https://cdn.simpleicons.org/xiaomi/FF6900'],
      ['Zyxel','Routers, switches, access points and network security devices.','https://cdn.simpleicons.org/zyxel/0076C0'],
      ['Brother','Printers, scanners, label printers and office equipment.','https://cdn.simpleicons.org/brother/000000'],
      ['BenQ','Monitors, projectors and visual display technology.','https://cdn.simpleicons.org/benq/FFFFFF'],
      ['Hikvision','Security cameras, video recorders and surveillance equipment.','https://cdn.simpleicons.org/hikvision/005BAC'],
      ['Dahua','Security cameras, recorders and video surveillance equipment.','https://cdn.simpleicons.org/dahua/EA1D25'],
      ['Insta360','360-degree and action cameras for immersive video.','https://cdn.simpleicons.org/insta360/000000'],
      ['Olympus','Imaging and optical equipment, including camera systems.','https://cdn.simpleicons.org/olympus/111111'],
      ['Sigma','Camera lenses and photography accessories.','https://cdn.simpleicons.org/sigma/111111'],
    ];
    let createdBrands = 0;
    for (const [name, description, logo] of brands) {
      const slug = buildSlug(name);
      const existing = await Brand.findOne({ slug }).select('_id').lean();
      await Brand.findOneAndUpdate(
        { slug },
        { $setOnInsert: { name, slug, description, logo, isActive: true } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      if (!existing) createdBrands += 1;
    }

    return res.json({
      success: true,
      message: 'Starter catalogue added. Existing category and brand records were preserved.',
      createdCategories,
      createdBrands,
      totalCategories: roots.length + children.length,
      totalBrands: brands.length,
    });
  } catch (error) {
    console.error('Unable to seed starter catalogue:', error);
    return res.status(500).json({ message: 'Unable to seed the starter catalogue.' });
  }
});

// Safely place existing products into the new catalogue hierarchy using their names and current category labels.
// This never creates, deletes, hides, or changes prices/stock/approval for products.
router.post('/admin/organize-existing-products', protect, adminOnly, async (req, res) => {
  try {
    const allCategories = await Category.find({ isActive: true }).select('_id name slug parentCategory').lean();
    const bySlug = new Map(allCategories.map((item) => [item.slug, item]));
    const byId = new Map(allCategories.map((item) => [String(item._id), item]));
    const rules = [
      { slug: 'laptops', terms: [/\blaptop\b/i, /\bnotebook\b/i, /thinkpad/i, /elitebook/i, /probook/i, /latitude/i, /pavilion/i, /macbook/i, /chromebook/i] },
      { slug: 'desktops', terms: [/\bdesktop\b/i, /\btower pc\b/i, /\ball.in.one pc\b/i, /\bmini pc\b/i] },
      { slug: 'monitors', terms: [/\bmonitor\b/i, /\bdisplay\b/i, /\bcomputer screen\b/i] },
      { slug: 'printers', terms: [/\bprinter\b/i, /\bmultifunction\b/i, /\bplotter\b/i] },
      { slug: 'ink-toner', terms: [/\btoner\b/i, /\bink cartridge\b/i, /\bink bottle\b/i] },
      { slug: 'routers', terms: [/\brouter\b/i, /\bmodem\b/i, /\bmifi\b/i, /\b4g\b.*\brouter\b/i, /\b5g\b.*\brouter\b/i] },
      { slug: 'network-switches', terms: [/network switch(es)?/i, /ethernet switch(es)?/i, /managed switch(es)?/i, /unmanaged switch(es)?/i] },
      { slug: 'access-points-wifi', terms: [/access point/i, /wifi extender/i, /mesh wifi/i] },
      { slug: 'network-cables-adapters', terms: [/ethernet cable/i, /network cable/i, /rj45/i, /network adapter/i] },
      { slug: 'keyboards-mice', terms: [/\bkeyboard\b/i, /\bmouse\b/i, /\bmice\b/i] },
      { slug: 'docks-hubs', terms: [/\bdock(ing)? station\b/i, /\busb.?c hub\b/i, /\bport replicator\b/i] },
      { slug: 'webcams-headsets', terms: [/\bwebcam\b/i, /\bheadset\b/i, /\bearphones?\b/i, /\bheadphones?\b/i, /\bmicrophone\b/i] },
      { slug: 'memory-ram', terms: [/\bram\b/i, /memory module/i, /ddr[345]/i] },
      { slug: 'ssd-hard-drives', terms: [/\bssd\b/i, /solid.state drive/i, /internal hard drive/i, /\bhdd\b/i] },
      { slug: 'processors-graphics', terms: [/\bprocessor\b/i, /\bcpu\b/i, /\bgpu\b/i, /graphics card/i, /\bnvidia geforce\b/i, /\bamd radeon\b/i] },
      { slug: 'external-drives', terms: [/external drive/i, /portable ssd/i, /external hard drive/i] },
      { slug: 'usb-drives-memory-cards', terms: [/\busb flash\b/i, /\bflash drive\b/i, /memory card/i, /\bsd card\b/i] },
      { slug: 'consoles-controllers', terms: [/\bplaystation\b/i, /\bxbox\b/i, /\bnintendo switch\b/i, /game controller/i, /gamepad/i] },
      { slug: 'gaming-headsets', terms: [/gaming headset/i, /gaming headphones/i] },
      { slug: 'speakers-audio', terms: [/\bspeaker(s)?\b/i, /soundbar/i, /\bbluetooth audio\b/i] },
      { slug: 'digital-cameras', terms: [/\bcamera\b/i, /\bdslr\b/i, /mirrorless/i] },
      { slug: 'action-cameras', terms: [/\baction camera\b/i, /gopro/i, /insta360/i] },
      { slug: 'camera-lenses-filters', terms: [/camera lens/i, /\blens(es)?\b/i, /camera filter/i] },
      { slug: 'projectors', terms: [/\bprojector\b/i] },
      { slug: 'ups-surge-protection', terms: [/\bups\b/i, /surge protector/i, /voltage regulator/i] },
      { slug: 'chargers-power-banks', terms: [/\bcharger\b/i, /power bank/i, /charging cable/i] },
      { slug: 'televisions-displays', terms: [/\btelevision\b/i, /\btv\b/i, /smart tv/i] },
      { slug: 'smart-devices', terms: [/smart home/i, /smart plug/i, /smart device/i] },
    ];
    const products = await Product.find({}).select('_id name category subcategory').lean();
    let updated = 0;
    let unchanged = 0;
    let unmatched = 0;
    const examples = [];
    for (const product of products) {
      const currentCategory = byId.get(String(product.category));
      const haystack = [product.name, product.subcategory, currentCategory?.name].filter(Boolean).join(' ');
      const rule = rules.find((candidate) => candidate.terms.some((term) => term.test(haystack)));
      const target = rule ? bySlug.get(rule.slug) : null;
      if (!target || (currentCategory && String(currentCategory._id) === String(target._id) && product.subcategory === target.name)) {
        if (!target) unmatched += 1;
        else unchanged += 1;
        continue;
      }
      await Product.updateOne({ _id: product._id }, { $set: { category: target._id, subcategory: target.name } });
      updated += 1;
      if (examples.length < 8) examples.push({ name: product.name, category: target.name });
    }
    return res.json({ success: true, message: 'Existing products were organised into matching categories. All product records and commercial details were preserved.', totalProducts: products.length, updated, unchanged, unmatched, examples });
  } catch (error) {
    console.error('Unable to organise existing products:', error);
    return res.status(500).json({ message: 'Unable to organise existing products.' });
  }
});

router.get('/admin/all', protect, adminOnly, async (req, res) => {
  try {
    const categories = await Category.find({}).sort({ name: 1 });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: 'Unable to fetch categories for administration.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const categories = await Category.find({
      isActive: true,
    }).sort({ name: 1 });

    res.json(categories);
  } catch (error) {
    res.status(500).json({
      message: error.message || 'Unable to fetch categories.',
    });
  }
});

router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const {
      name,
      description,
      image,
      parentCategory,
      isActive,
    } = req.body;

    if (!name) {
      return res.status(400).json({
        message: 'Category name is required.',
      });
    }

    const slug = buildSlug(name);

    const existing = await Category.findOne({ slug });

    if (existing) {
      return res.status(400).json({
        message: 'Category already exists.',
      });
    }

    const category = await Category.create({
      name,
      slug,
      description: description || '',
      image: image || '',
      parentCategory: parentCategory || null,
      isActive: isActive !== false,
    });

    res.status(201).json(category);
  } catch (error) {
    res.status(500).json({
      message: error.message || 'Unable to create category.',
    });
  }
});

router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({
        message: 'Category not found.',
      });
    }

    if (req.body.name && req.body.name !== category.name) {
      category.name = req.body.name;
      category.slug = buildSlug(req.body.name);
    }

    if (req.body.description !== undefined) {
      category.description = req.body.description;
    }

    if (req.body.image !== undefined) {
      category.image = req.body.image;
    }

    if (req.body.parentCategory !== undefined) {
      category.parentCategory = req.body.parentCategory || null;
    }

    if (req.body.isActive !== undefined) {
      category.isActive = Boolean(req.body.isActive);
    }

    const updated = await category.save();

    res.json(updated);
  } catch (error) {
    res.status(500).json({
      message: error.message || 'Unable to update category.',
    });
  }
});

router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({
        message: 'Category not found.',
      });
    }

    const [productCount, childCount] = await Promise.all([
      Product.countDocuments({ category: category._id }),
      Category.countDocuments({ parentCategory: category._id }),
    ]);

    if (productCount || childCount) {
      return res.status(409).json({
        message: 'This category still has products or subcategories. Deactivate it instead, or move those records before deleting.',
        productCount,
        childCount,
      });
    }

    await category.deleteOne();

    res.json({
      message: 'Category deleted successfully.',
    });
  } catch (error) {
    res.status(500).json({
      message: error.message || 'Unable to delete category.',
    });
  }
});

module.exports = router;
