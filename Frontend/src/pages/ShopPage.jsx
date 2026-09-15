import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ProductCard from '../components/ProductCard';
import { fetchProducts, fetchCategories } from '../services/api';

function ShopPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const category = searchParams.get('category') || '';
  const brand = searchParams.get('brand') || '';
  const search = searchParams.get('search') || '';
  const sort = searchParams.get('sort') || 'latest';

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    const loadProducts = async () => {
      try {
        setLoading(true);
        const data = await fetchProducts({ page, limit: 8, category, brand, search, sort });
        setProducts(data.products || []);
        setTotalPages(data.totalPages || 1);
      } catch (error) {
        console.error('Unable to load products:', error);
      } finally {
        setLoading(false);
      }
    };

    loadProducts();
  }, [page, category, brand, search, sort]);

  const updateFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setPage(1);
    setSearchParams(next);
  };

  return (
    <section className="container section-block shop-layout">
      <aside className="filter-sidebar">
        <h3>Filters</h3>
        <div className="filter-group">
          <label>Category</label>
          <select value={category} onChange={(event) => updateFilter('category', event.target.value)}>
            <option value="">All Categories</option>
            {categories.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>Brand</label>
          <select value={brand} onChange={(event) => updateFilter('brand', event.target.value)}>
            <option value="">All brands</option>
            <option value="Dell">Dell</option>
            <option value="HP">HP</option>
            <option value="Lenovo">Lenovo</option>
            <option value="JBL">JBL</option>
            <option value="TP-Link">TP-Link</option>
            <option value="Crucial">Crucial</option>
          </select>
        </div>
        <div className="filter-group">
          <label>Price Range</label>
          <input type="range" min="0" max="200000" defaultValue="150000" />
        </div>
      </aside>

      <div className="shop-main">
        <div className="shop-toolbar">
          <h2>Shop Products</h2>
          <select value={sort} onChange={(event) => updateFilter('sort', event.target.value === 'latest' ? '' : event.target.value)}>
            <option value="latest">Latest</option>
            <option value="price-asc">Price low to high</option>
            <option value="price-desc">Price high to low</option>
          </select>
        </div>

        {search && <p className="results-note">Showing results for “{search}”</p>}
        {loading ? (
          <p>Loading products...</p>
        ) : (
          <>
            {products.length ? <div className="product-grid shop-grid">
              {products.map((product) => (
                <ProductCard key={product._id || product.slug} product={product} />
              ))}
            </div> : <div className="empty-state"><h3>No products found</h3><p>Try another search or clear one of the filters.</p></div>}

            <div className="pagination">
              <button disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </button>
              <span>Page {page} of {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export default ShopPage;
