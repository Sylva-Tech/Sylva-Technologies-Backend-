import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ArrowRight, Headphones, ShieldCheck, ShoppingBag, Truck } from 'lucide-react';
import ProductCard from '../components/ProductCard';
import LiveOfferBanner from '../components/LiveOfferBanner';
import LiveAds from '../components/LiveAds';
import { fetchAdvertisements, fetchProducts } from '../services/api';

const sidebarGroups = [
  { title: 'Computers', items: [{ name: 'Dell', image: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=600&q=80' }, { name: 'Lenovo', image: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=600&q=80' }, { name: 'HP', image: 'https://images.unsplash.com/photo-1541807084-5c52b6b3adef?auto=format&fit=crop&w=600&q=80' }] },
  { title: 'Accessories', items: [{ name: 'Logitech', image: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=600&q=80' }, { name: 'Corsair', image: 'https://images.unsplash.com/photo-1511467687858-23d96c32e4ae?auto=format&fit=crop&w=600&q=80' }, { name: 'Razer', image: 'https://images.unsplash.com/photo-1591799264318-7e6ef8ddb7ea?auto=format&fit=crop&w=600&q=80' }] },
  { title: 'Networking', items: [{ name: 'TP-Link', image: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=600&q=80' }, { name: 'Cisco', image: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&w=600&q=80' }, { name: 'Ubiquiti', image: 'https://images.unsplash.com/photo-1526379095098-d400fd0bf935?auto=format&fit=crop&w=600&q=80' }] },
  { title: 'Components', items: [{ name: 'Intel', image: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=600&q=80' }, { name: 'AMD', image: 'https://images.unsplash.com/photo-1555618566-8b4f7f9eb0a6?auto=format&fit=crop&w=600&q=80' }, { name: 'NVIDIA', image: 'https://images.unsplash.com/photo-1591488320449-011701bb6704?auto=format&fit=crop&w=600&q=80' }] },
  { title: 'Audio', items: [{ name: 'JBL', image: 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=600&q=80' }] },
];

const tickerItems = ['FLASH SALE — LIMITED TIME OFFERS', 'LAPTOP DEALS AVAILABLE NOW', 'SHOP QUALITY COMPUTERS', 'NEW AUDIO PRODUCTS AVAILABLE', 'NETWORKING DEALS', 'SHOP SYLVA TECHNOLOGIES TODAY'];
const productText = (product) => `${product.name || ''} ${product.brand || ''} ${(product.category && product.category.name) || ''} ${product.subcategory || ''}`.toLowerCase();

function ProductSection({ title, products, className = '' }) {
  if (!products.length) return null;
  return <section className={`store-section ${className}`}>
    <div className="section-heading"><h2>{title}</h2><Link to="/shop">View all <ArrowRight size={15} /></Link></div>
    <div className="product-grid home-grid">{products.map((product) => <ProductCard key={product._id || product.slug} product={product} />)}</div>
  </section>;
}

function HomePage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ads, setAds] = useState([]);

  useEffect(() => {
    Promise.all([fetchProducts({ limit: 48 }), fetchAdvertisements()])
      .then(([productData, adData]) => { setProducts(productData.products || []); setAds(adData || []); })
      .catch((error) => console.error('Unable to load homepage data:', error))
      .finally(() => setLoading(false));
  }, []);

  const latest = [...products].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const trending = products.filter((product) => product.featured || product.flashSale || Number(product.discount || 0) > 0).slice(0, 8);
  const liveDeals = products.filter((product) => product.flashSale || product.featured || Number(product.discount || 0) > 0).slice(0, 6);
  const markedNew = products.filter((product) => product.isNew);
  const newArrivals = (markedNew.length ? markedNew : latest).slice(0, 8);
  const featured = products.filter((product) => product.featured).slice(0, 8);
  const sectionProducts = (matcher) => products.filter((product) => matcher(productText(product))).slice(0, 8);

  return <div className="homepage-shell">
    <div className="container home-top">
      <LiveOfferBanner products={products} />
      <ProductSection title="Trending Now" products={trending.length ? trending : latest.slice(0, 8)} className="top-products" />
      <ProductSection title="New Arrivals" products={newArrivals} />
    </div>
    <div className="container home-shell">
      <aside className="home-sidebar"><h3>Shop by Category</h3>{sidebarGroups.map((group) => <div key={group.title} className="sidebar-group"><h4>{group.title}</h4><div className="brand-grid">{group.items.map((item) => <Link key={item.name} to={`/shop?brand=${encodeURIComponent(item.name)}`} className="brand-card"><img src={item.image} alt={item.name} /><span>{item.name}</span></Link>)}</div></div>)}</aside>
      <main className="home-main">
        <LiveAds ads={ads} />
        <section className="live-deals-section"><div className="section-heading"><h2>Available Now</h2><span className="live-pill"><span /> Live Deals</span></div>{loading ? <div className="empty-state compact">Loading products...</div> : <div className="product-grid home-grid">{liveDeals.slice(0, 4).map((product) => <ProductCard key={product._id || product.slug} product={product} />)}</div>}</section>
        <div className="promo-ticker" aria-label="Promotional offers"><div className="ticker-track">{[...tickerItems, ...tickerItems].map((item, index) => <span key={`${item}-${index}`} className="ticker-item">{item}</span>)}</div></div>
        <ProductSection title="Featured Products" products={featured.length ? featured : latest.slice(0, 8)} />
        <ProductSection title="Laptops" products={sectionProducts((text) => text.includes('laptop') || text.includes('notebook'))} />
        <ProductSection title="Accessories" products={sectionProducts((text) => text.includes('accessor') || text.includes('mouse') || text.includes('keyboard') || text.includes('monitor'))} />
        <ProductSection title="Networking" products={sectionProducts((text) => text.includes('router') || text.includes('network') || text.includes('switch') || text.includes('wifi'))} />
        <ProductSection title="Audio" products={sectionProducts((text) => text.includes('speaker') || text.includes('headphone') || text.includes('audio'))} />
        <section className="upgrade-cta"><div><span className="eyebrow">Your next setup starts here</span><h2>Ready to upgrade your technology?</h2><Link to="/shop" className="primary-btn">Shop now <ArrowRight size={16} /></Link></div><img src="https://images.unsplash.com/photo-1541807084-5c52b6b3adef?auto=format&fit=crop&w=900&q=80" alt="Laptop ready for work" /></section>
        <section className="why-shop"><div className="section-heading"><h2>Why shop with us</h2></div><div className="why-shop__grid"><div><ShieldCheck size={22} /><strong>Quality products</strong><span>Checked for value and reliability.</span></div><div><ShoppingBag size={22} /><strong>Easy ordering</strong><span>Cart, checkout or WhatsApp.</span></div><div><Truck size={22} /><strong>Convenient delivery</strong><span>Simple support from order to arrival.</span></div><div><Headphones size={22} /><strong>Customer support</strong><span>Real help when you need it.</span></div></div></section>
      </main>
    </div>
  </div>;
}

export default HomePage;
