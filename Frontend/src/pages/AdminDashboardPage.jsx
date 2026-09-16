import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchProducts } from '../services/api';
import api from '../services/api';

function AdminDashboardPage() {
  const cards = [
    { title: 'Orders', value: '24', detail: 'Awaiting fulfillment' },
    { title: 'Revenue', value: '$18.4k', detail: 'This month' },
    { title: 'Customers', value: '1,284', detail: 'Active accounts' },
  ];
  const [products, setProducts] = useState([]);
  const [saving, setSaving] = useState('');

  useEffect(() => {
    fetchProducts({ limit: 48 }).then((data) => setProducts(data.products || [])).catch(() => setProducts([]));
  }, []);

  const updateProduct = (id, field, value) => {
    setProducts((current) => current.map((product) => (product._id === id ? { ...product, [field]: value } : product)));
  };

  const saveOffer = async (product) => {
    setSaving(product._id);
    try {
      const token = localStorage.getItem('sylva-token');
      const response = await api.put(`/products/${product._id}`, {
        flashSale: Boolean(product.flashSale),
        offer: Boolean(product.offer),
        offerMessage: product.offerMessage || '',
        price: Number(product.price),
        oldPrice: Number(product.oldPrice || 0),
        offerStartDate: product.offerStartDate || null,
        offerEndDate: product.offerEndDate || null,
      }, { headers: { Authorization: `Bearer ${token}` } });
      setProducts((current) => current.map((item) => (item._id === product._id ? response.data : item)));
    } catch (error) {
      console.error('Unable to save offer:', error);
    } finally {
      setSaving('');
    }
  };

  return (
    <section className="container section-block dashboard-shell">
      <div className="section-head">
        <h2>Admin Dashboard</h2>
      </div>

      <div className="dashboard-grid">
        {cards.map((card) => (
          <div key={card.title} className="dashboard-card">
            <h3>{card.title}</h3>
            <p style={{ fontSize: '2rem', fontWeight: 800, color: '#0d7d53' }}>{card.value}</p>
            <p>{card.detail}</p>
          </div>
        ))}
      </div>

      <div className="admin-offers">
        <div className="section-head"><h2>Live offer controls</h2><p>Choose products and set the offer shown in the moving banner.</p><Link to="/admin/ads" className="text-action">Manage live ads</Link></div>
        <div className="admin-offer-list">{products.map((product) => <article className="admin-offer-row" key={product._id}>
          <div className="admin-offer-product"><img src={product.images?.[0]} alt="" /><strong>{product.name}</strong><span>{product.brand}</span></div>
          <label><input type="checkbox" checked={Boolean(product.flashSale)} onChange={(event) => updateProduct(product._id, 'flashSale', event.target.checked)} /> Flash sale</label>
          <label><input type="checkbox" checked={Boolean(product.offer)} onChange={(event) => updateProduct(product._id, 'offer', event.target.checked)} /> Offer</label>
          <input value={product.offerMessage || ''} placeholder="Offer message" onChange={(event) => updateProduct(product._id, 'offerMessage', event.target.value)} />
          <input type="number" value={product.price || 0} aria-label="Offer price" onChange={(event) => updateProduct(product._id, 'price', event.target.value)} />
          <input type="number" value={product.oldPrice || 0} aria-label="Old price" onChange={(event) => updateProduct(product._id, 'oldPrice', event.target.value)} />
          <input type="datetime-local" value={product.offerStartDate ? product.offerStartDate.slice(0, 16) : ''} aria-label="Offer start date" onChange={(event) => updateProduct(product._id, 'offerStartDate', event.target.value)} />
          <input type="datetime-local" value={product.offerEndDate ? product.offerEndDate.slice(0, 16) : ''} aria-label="Offer end date" onChange={(event) => updateProduct(product._id, 'offerEndDate', event.target.value)} />
          <button className="primary-btn small-btn" type="button" onClick={() => saveOffer(product)} disabled={saving === product._id}>{saving === product._id ? 'Saving...' : 'Save offer'}</button>
        </article>)}</div>
      </div>
    </section>
  );
}

export default AdminDashboardPage;