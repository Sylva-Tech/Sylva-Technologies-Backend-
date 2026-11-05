import { useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import ProductCard from '../components/ProductCard';
import { fetchProducts, fetchCategories } from '../services/api';

const brandOptions = ['Dell', 'HP', 'Lenovo', 'JBL', 'TP-Link', 'Crucial', 'Logitech', 'ASUS'];

function ShopPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const category = searchParams.get('category') || '';
  const brand = searchParams.get('brand') || '';
  const search = searchParams.get('search') || '';
  const sort = searchParams.get('sort') || (location.pathname === '/deals' ? 'featured' : 'newest');
  const availability = searchParams.get('availability') || 'all';

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    const loadProducts = async () => {
      try {
        setLoading(true);
        const data = await fetchProducts({
          page,
          limit: 12,
          category,
          brand,
          search,
          sort,
          inStock: availability === 'in-stock' ? 'true' : undefined,
          offer: location.pathname === '/deals' ? 'true' : undefined,
        });

        let nextProducts = data.products || [];

        if (sort === 'featured') {
          nextProducts = [...nextProducts].sort((a, b) => Number(b.featured || 0) - Number(a.featured || 0));
        }

        if (sort === 'name-asc') {
          nextProducts = [...nextProducts].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        }

        if (sort === 'price-asc') {
          nextProducts = [...nextProducts].sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
        }

        if (sort === 'price-desc') {
          nextProducts = [...nextProducts].sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
        }

        if (sort === 'newest') {
          nextProducts = [...nextProducts].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        }

        setProducts(nextProducts);
        setTotalPages(data.totalPages || 1);
      } catch (error) {
        console.error('Unable to load products:', error);
        setProducts([]);
      } finally {
        setLoading(false);
      }
    };

    loadProducts();
  }, [page, category, brand, search, sort, availability, location.pathname]);

  const updateFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setPage(1);
    setSearchParams(next);
  };

  const selectedCategoryName = useMemo(() => {
    return categories.find((item) => item.slug === category || item._id === category)?.name || '';
  }, [categories, category]);

  return (
    <section className="container section-block shop-layout">
      <aside className="filter-sidebar">
        <h3>Filters</h3>

        <div className="filter-group">
          <label>Category</label>
          <select value={category} onChange={(event) => updateFilter('category', event.target.value)}>
            <option value="">All Categories</option>
            {categories.map((item) => (
              <option key={item._id} value={item.slug || item._id}>{item.name}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>Brand</label>
          <select value={brand} onChange={(event) => updateFilter('brand', event.target.value)}>
            <option value="">All brands</option>
            {brandOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>

        <div className="filter-group">
          <label>Availability</label>
          <select value={availability} onChange={(event) => updateFilter('availability', event.target.value === 'all' ? '' : event.target.value)}>
            <option value="all">All products</option>
            <option value="in-stock">In stock only</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Price</label>
          <input type="range" min="0" max="200000" defaultValue="150000" />
        </div>
      </aside>

      <div className="shop-main">
        <div className="shop-toolbar">
          <div>
            <span className="eyebrow">Shop</span>
            <h2>{location.pathname === '/deals' ? 'Deals & offers' : selectedCategoryName ? selectedCategoryName : 'Shop all products'}</h2>
          </div>

          <select
            value={sort}
            onChange={(event) => updateFilter('sort', event.target.value === 'newest' ? '' : event.target.value)}
          >
            <option value="featured">Featured</option>
            <option value="newest">Newest</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
            <option value="name-asc">Name A-Z</option>
          </select>
        </div>

        {search && <p className="results-note">Showing results for “{search}”</p>}

        {loading ? (
          <div className="empty-state compact"><h3>Loading products...</h3><p>Finding the best matches for your search.</p></div>
        ) : (
          <>
            {products.length ? (
              <div className="product-grid shop-grid">
                {products.map((product) => (
                  <ProductCard key={product._id || product.slug} product={product} />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <h3>No products found</h3>
                <p>We couldn’t find any products matching your search. Try another keyword or clear a filter.</p>
              </div>
            )}

            {products.length > 0 && (
              <div className="pagination">
                <button disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Previous
                </button>
                <span>Page {page} of {totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export default ShopPage;
