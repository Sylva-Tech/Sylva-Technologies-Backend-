import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { fetchCategories, fetchProductBySlug } from '../services/api';

const emptyForm = { name: '', sku: '', brand: '', category: '', price: '', oldPrice: '', stock: '', shortDescription: '', description: '', condition: 'New', warranty: '', images: '', featured: false, isNew: false, flashSale: false, offer: false, offerMessage: '', offerStartDate: '', offerEndDate: '' };

function AdminProductFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = Boolean(id);
  const [form, setForm] = useState(emptyForm);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => setCategories([]));
    if (editing) {
      api.get(`/products/${id}`).then(({ data }) => setForm({ ...emptyForm, ...data, category: data.category?._id || data.category, images: (data.images || []).join('\n') })).catch(() => setError('Unable to load this product.')).finally(() => setLoading(false));
    }
  }, [id, editing]);

  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  const save = async (event) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    const payload = { ...form, price: Number(form.price), oldPrice: Number(form.oldPrice || 0), stock: Number(form.stock || 0), images: form.images.split('\n').map((url) => url.trim()).filter(Boolean) };
    try {
      const token = localStorage.getItem('sylva-token');
      const config = { headers: { Authorization: `Bearer ${token}` } };
      if (editing) await api.put(`/products/${id}`, payload, config);
      else await api.post('/products', payload, config);
      navigate('/admin/products');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save product. Please check the fields and try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <section className="container section-block"><p>Loading product...</p></section>;
  return <section className="container section-block admin-page"><div className="admin-page-head"><div><p className="eyebrow">Catalog control</p><h1>{editing ? 'Edit product' : 'Add product'}</h1></div><Link to="/admin/products" className="secondary-btn">Back to products</Link></div>
    <form className="admin-product-form" onSubmit={save}>
      <fieldset><legend>Product information</legend><div className="admin-form-grid"><label>Product name<input name="name" value={form.name} onChange={update} required /></label><label>SKU<input name="sku" value={form.sku} onChange={update} required disabled={editing} /></label><label>Brand<input name="brand" value={form.brand} onChange={update} required /></label><label>Category<select name="category" value={form.category} onChange={update} required><option value="">Select category</option>{categories.map((category) => <option key={category._id} value={category._id}>{category.name}</option>)}</select></label></div></fieldset>
      <fieldset><legend>Pricing and inventory</legend><div className="admin-form-grid"><label>Price<input type="number" min="0" name="price" value={form.price} onChange={update} required /></label><label>Old price<input type="number" min="0" name="oldPrice" value={form.oldPrice} onChange={update} /></label><label>Stock<input type="number" min="0" name="stock" value={form.stock} onChange={update} required /></label><label>Condition<select name="condition" value={form.condition} onChange={update}><option>New</option><option>Refurbished</option><option>Used</option></select></label><label>Warranty<input name="warranty" value={form.warranty} onChange={update} placeholder="e.g. 6 months" /></label></div></fieldset>
      <fieldset><legend>Description</legend><label>Short description<textarea name="shortDescription" value={form.shortDescription} onChange={update} rows="2" maxLength="180" /></label><label>Full description<textarea name="description" value={form.description} onChange={update} rows="5" required /></label><label>Specifications<textarea name="specifications" value={typeof form.specifications === 'string' ? form.specifications : JSON.stringify(form.specifications || {}, null, 2)} onChange={(event) => setForm({ ...form, specifications: event.target.value })} rows="4" placeholder="Processor: Core i5\nRAM: 8GB\nStorage: 256GB SSD" /></label></fieldset>
      <fieldset><legend>Media and promotions</legend><label>Image URLs, one per line<textarea name="images" value={form.images} onChange={update} rows="3" placeholder="https://..." /></label><label>Offer message<input name="offerMessage" value={form.offerMessage} onChange={update} placeholder="Powerful performance for everyday work" /></label><div className="admin-check-grid"><label><input type="checkbox" name="featured" checked={form.featured} onChange={update} /> Featured</label><label><input type="checkbox" name="isNew" checked={form.isNew} onChange={update} /> New arrival</label><label><input type="checkbox" name="flashSale" checked={form.flashSale} onChange={update} /> Flash sale</label><label><input type="checkbox" name="offer" checked={form.offer} onChange={update} /> Active offer</label></div><div className="admin-form-grid"><label>Offer starts<input type="datetime-local" name="offerStartDate" value={form.offerStartDate ? form.offerStartDate.slice(0, 16) : ''} onChange={update} /></label><label>Offer ends<input type="datetime-local" name="offerEndDate" value={form.offerEndDate ? form.offerEndDate.slice(0, 16) : ''} onChange={update} /></label></div></fieldset>
      {error && <p className="auth-error">{error}</p>}<button className="primary-btn" type="submit" disabled={saving}>{saving ? 'Saving product...' : 'Save product'}</button>
    </form>
  </section>;
}

export default AdminProductFormPage;
