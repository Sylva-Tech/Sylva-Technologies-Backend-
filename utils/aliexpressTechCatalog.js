const TECH_TERMS = /\b(laptops?|notebooks?|desktops?|computers?|pcs?|macbooks?|mac|chromebooks?|smartphones?|iphones?|android|mobile phones?|tablets?|ipads?|routers?|modems?|switches?|networks?|wifi|wi-fi|ethernet|servers?|nas|ssds?|hdds?|hard drives?|flash drives?|usb|memory cards?|memory modules?|computer memory|ram|ddr[345]|motherboards?|processors?|cpus?|gpus?|graphics cards?|monitors?|displays?|projectors?|printers?|scanners?|keyboards?|mice|mouse|webcams?|headsets?|headphones?|earphones?|earbuds?|speakers?|microphones?|soundbars?|cameras?|cctv|security cameras?|surveillance|power banks?|chargers?|charging cables?|adapters?|hubs?|docks?|computer cases?|pc cases?|cooling fans?|ups|uninterruptible power|smartwatches?|smart watches?|wearables?|televisions?|tvs?|electronics|electronic accessories|gaming consoles?|game controllers?|joysticks?|graphics tablets?|drawing tablets?|hdmi|type-c|power supplies?|laptop batteries?)\b/i;

const NON_TECH_TERMS = /\b(dress|clothing|fashion|jewelry|jewellery|cosmetic|makeup|skincare|perfume|sofa|furniture|curtain|bedding|kitchenware|cookware|toy|doll|pet food|dog clothes|cat clothes|garden tool|plant pot|carpet|rug|wall art|wedding decor)\b/i;

const TECH_CATEGORY_TERMS = /\b(computers?|laptops?|desktops?|phones?|mobiles?|tablets?|networks?|electronics?|printers?|monitors?|storage|cameras?|audio|gaming|smart|security|power|protection|ups|office equipment)\b/i;

const isTechProduct = (value) => TECH_TERMS.test(String(value || '')) && !NON_TECH_TERMS.test(String(value || ''));
const isTechCategory = (value) => TECH_CATEGORY_TERMS.test(String(value || ''));

module.exports = { isTechProduct, isTechCategory };
