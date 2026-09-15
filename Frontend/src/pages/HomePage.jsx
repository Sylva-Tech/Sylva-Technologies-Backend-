import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import ProductCard from '../components/ProductCard';
import { fetchProducts, fetchCategories } from '../services/api';

const defaultCategories = [
  { name: 'Laptops', slug: 'laptops', icon: 'L' },
  { name: 'Desktops', slug: 'desktops', icon: 'D' },
  { name: 'Accessories', slug: 'accessories', icon: 'A' },
  { name: 'Networking', slug: 'networking', icon: 'N' },
  { name: 'Components', slug: 'components', icon: 'C' },
  { name: 'Audio', slug: 'audio', icon: 'S' },
];

function HomePage() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState(defaultCategories);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [productRes, categoryRes] = await Promise.all([
          fetchProducts({ featured: true, limit: 4 }),
          fetchCategories(),
        ]);

        setProducts(productRes.products || []);
        setCategories(categoryRes.length ? categoryRes : defaultCategories);
      } catch (error) {
        console.error('Unable to load homepage data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  return (
    <>
      <section className="hero-section">
        <div className="container hero-grid">
          <div>
            <p className="eyebrow">Trusted IT products for Kenya</p>
            <h1>Technology that works as hard as you do.</h1>
            <p className="hero-text">
              Shop dependable computers, networking gear, components and accessories with clear advice, honest product details and support from a local technology team.
            </p>
            <div className="hero-actions">
              <Link to="/shop" className="primary-btn">Shop Now</Link>
              <Link to="/shop" className="secondary-btn">Browse categories</Link>
            </div>
          </div>

          <div className="hero-visual">
            <div className="hero-card highlight-card">
              <span>New arrivals</span>
              <strong>Business laptops</strong>
              <small>From KSh 45,000</small>
            </div>
            <div className="hero-card accent-card">
              <span>Fast delivery</span>
              <strong>Nationwide support</strong>
              <small>Helpful advice before and after your order</small>
            </div>
          </div>
        </div>
      </section>

      <section className="container section-block">
        <div className="section-head">
          <h2>Featured Categories</h2>
        </div>
        <div className="category-grid">
          {categories.map((item) => (
            <Link key={item.slug || item.name} to={`/shop?category=${item.slug || item.name.toLowerCase()}`} className="category-card">
              <div className="category-icon">{item.icon || item.name.charAt(0)}</div>
              <h3>{item.name}</h3>
              <span>Explore range</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="container section-block value-section">
        <div className="section-head section-head-split">
          <div>
            <p className="eyebrow">Shopping made clearer</p>
            <h2>Good technology starts with good guidance.</h2>
          </div>
          <p>Whether you are upgrading a home setup or equipping a growing business, we help you compare practical options without the jargon.</p>
        </div>
        <div className="value-grid">
          <article><strong>01</strong><h3>Choose with confidence</h3><p>See condition, warranty, specifications and everyday use cases before you add a product to your cart.</p></article>
          <article><strong>02</strong><h3>Get the right fit</h3><p>We stock options for study, office work, connectivity, entertainment and upgrades across different budgets.</p></article>
          <article><strong>03</strong><h3>Keep moving</h3><p>From order updates to practical support, our local team stays close when you need help after purchase.</p></article>
        </div>
      </section>

      <section className="container section-block">
        <div className="section-head section-head-split">
          <div><p className="eyebrow">Curated for real life</p><h2>Featured Products</h2></div>
          <Link to="/shop" className="text-action">View all products</Link>
        </div>
        {loading ? (
          <p>Loading products...</p>
        ) : products.length ? (
          <div className="product-grid">
            {products.map((product) => (
              <ProductCard key={product._id || product.slug} product={product} />
            ))}
          </div>
        ) : (
          <div className="empty-state"><h3>New products are on the way</h3><p>Browse the shop to see our current catalogue.</p></div>
        )}
      </section>

      <section className="trust-strip">
        <div className="container trust-grid">
          <div><h3>Quality Products</h3></div>
          <div><h3>Competitive Prices</h3></div>
          <div><h3>Reliable Support</h3></div>
          <div><h3>Easy Ordering</h3></div>
        </div>
      </section>
    </>
  );
}

export default HomePage;
