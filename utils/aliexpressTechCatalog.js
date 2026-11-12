const TECH_TERMS = /\b(laptop|notebook|desktop|computer|pc|macbook|mac|chromebook|smartphone|iphone|android|mobile phone|tablet|ipad|router|modem|switch|network|wifi|wi-fi|ethernet|server|nas|ssd|hdd|hard drive|flash drive|usb|memory card|ram|memory|motherboard|processor|cpu|gpu|graphics card|monitor|display|projector|printer|scanner|keyboard|mouse|webcam|headset|headphone|earphone|earbud|speaker|microphone|soundbar|camera|cctv|security camera|surveillance|power bank|charger|charging cable|adapter|hub|dock|computer case|pc case|cooling fan|ups|uninterruptible power|smartwatch|smart watch|wearable|television|tv|electronics|electronic accessory|gaming console|game controller|joystick|graphics tablet|drawing tablet)\b/i;

const NON_TECH_TERMS = /\b(dress|clothing|fashion|jewelry|jewellery|cosmetic|makeup|skincare|perfume|sofa|furniture|curtain|bedding|kitchenware|cookware|toy|doll|pet food|dog clothes|cat clothes|garden tool|plant pot|carpet|rug|wall art|wedding decor)\b/i;

const TECH_CATEGORY_TERMS = /\b(computer|laptop|desktop|phone|mobile|tablet|network|electronic|printer|monitor|storage|camera|audio|gaming|smart|security|power|protection|ups|office equipment)\b/i;

const isTechProduct = (value) => TECH_TERMS.test(String(value || '')) && !NON_TECH_TERMS.test(String(value || ''));
const isTechCategory = (value) => TECH_CATEGORY_TERMS.test(String(value || ''));

module.exports = { isTechProduct, isTechCategory };
