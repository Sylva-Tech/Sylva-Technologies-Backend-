import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { fetchCategories, fetchProducts } from '../services/api';

function AdminProductsPage() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [productData, categoryData] = await Promise.all([fetchProducts({ limit: 100, search }), fetchCategories()]);
      setProducts(productData.products || []);
      setCategories(categoryData || []);
    } catch {
      setMessage('Unable to load products. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const remove = async (product) => {
    if (!window.confirm(`Are you sure you want to delete ${product.name}?`)) return;
    try {
      const token = localStorage.getItem('sylva-token');
      await api.delete(`/products/${product._id}`, { headers: { Authorization: `Bearer ${token}` } });
      setProducts((current) => current.filter((item) => item._id !== product._id));
    } catch {
      setMessage('Unable to delete this product.');
    }
  };

  return <section className="container section-block admin-page">
    <div className="admin-page-head"><div><p className="eyebrow">Catalog control</p><h1>Products</h1></div><div className="admin-page-actions"><Link className="secondary-btn" to="/admin/products/import">Import products</Link><Link className="primary-btn" to="/admin/products/new">+ Add product</Link></div></div>
    <div className="admin-filter-bar"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products, brands or SKU" /><button className="secondary-btn" type="button" onClick={load}>Search</button></div>
    {message && <p className="auth-error">{message}</p>}
    {loading ? <p>Loading products...</p> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Product</th><th>Brand</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead><tbody>{products.map((product) => <tr key={product._id}><td><div className="admin-product-cell"><img src={product.images?.[0]} alt="" /><strong>{product.name}</strong></div></td><td>{product.brand}</td><td>{product.category?.name || '-'}</td><td>KSh {Number(product.price || 0).toLocaleString()}</td><td>{product.stock}</td><td><span className={product.stock > 0 ? 'in-stock' : 'out-of-stock'}>{product.stock > 0 ? 'In stock' : 'Out of stock'}</span>{product.featured && <small> Featured</small>}{product.flashSale && <small> Flash sale</small>}</td><td><Link to={`/product/${product.slug}`}>View</Link> <Link to={`/admin/products/${product._id}/edit`}>Edit</Link> <button className="table-delete" type="button" onClick={() => remove(product)}>Delete</button></td></tr>)}</tbody></table>{!products.length && <div className="empty-state">No products found.</div>}</div>}
    <p className="admin-category-count">{categories.length} active categories available</p>
  </section>;
}

export default AdminProductsPage;
