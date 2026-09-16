import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import api from '../services/api';

function CheckoutPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { cartItems, subtotal, clearCart } = useCart();
  const [form, setForm] = useState({
    fullName: user?.name || '',
    phone: user?.phone || '',
    email: user?.email || '',
    county: '',
    deliveryLocation: '',
    address: '',
    paymentMethod: 'Cash on Delivery',
    paymentReference: '',
    notes: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (event) => {
    setForm({ ...form, [event.target.name]: event.target.value });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const token = localStorage.getItem('sylva-token');
      const response = await api.post(
        '/orders',
        {
          items: cartItems.map((item) => ({ product: item._id, quantity: item.quantity })),
          customerDetails: form,
          paymentMethod: form.paymentMethod,
          notes: form.notes,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      clearCart();
      navigate('/profile', { state: { orderNumber: response.data.orderNumber } });
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to place order. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (cartItems.length === 0) {
    return (
      <section className="container section-block cart-empty">
        <h2>Your cart is empty</h2>
        <p>Add products before checking out.</p>
      </section>
    );
  }

  return (
    <section className="container section-block checkout-page">
      <div className="section-head">
        <h2>Checkout</h2>
        <p>Tell us where to deliver your order.</p>
      </div>

      <div className="checkout-layout">
        <form className="auth-card checkout-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Full Name</label>
            <input name="fullName" value={form.fullName} onChange={handleChange} required />
          </div>
          <div className="checkout-fields">
            <div className="form-group">
              <label>Phone</label>
              <input name="phone" value={form.phone} onChange={handleChange} required />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" name="email" value={form.email} onChange={handleChange} required />
            </div>
          </div>
          <div className="checkout-fields">
            <div className="form-group">
              <label>County</label>
              <input name="county" value={form.county} onChange={handleChange} required />
            </div>
            <div className="form-group">
              <label>Delivery Location</label>
              <input name="deliveryLocation" value={form.deliveryLocation} onChange={handleChange} required />
            </div>
          </div>
          <div className="form-group">
            <label>Address or landmark</label>
            <input name="address" value={form.address} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label>Payment Method</label>
            <select name="paymentMethod" value={form.paymentMethod} onChange={handleChange}>
              <option>Cash on Delivery</option>
              <option>M-Pesa</option>
              <option>PayPal</option>
              <option>WhatsApp Order</option>
            </select>
          </div>
          {form.paymentMethod === 'M-Pesa' && <div className="payment-instructions"><strong>Pay via M-Pesa Till Number</strong><span>{import.meta.env.VITE_MPESA_TILL_NUMBER || 'Till number available from customer support'}</span><small>Enter your M-Pesa transaction code after payment.</small></div>}
          {form.paymentMethod === 'PayPal' && <div className="payment-instructions"><strong>PayPal payment</strong><span>{import.meta.env.VITE_PAYPAL_EMAIL || 'PayPal details available from customer support'}</span><small>Complete payment, then add the transaction reference below.</small></div>}
          {(form.paymentMethod === 'M-Pesa' || form.paymentMethod === 'PayPal') && <div className="form-group"><label>Payment reference</label><input name="paymentReference" value={form.paymentReference} onChange={handleChange} placeholder="Transaction code or PayPal reference" required /></div>}
          <div className="form-group">
            <label>Order notes</label>
            <textarea name="notes" value={form.notes} onChange={handleChange} rows="3" />
          </div>
          {error && <p className="auth-error">{error}</p>}
          <button className="primary-btn full-btn" type="submit" disabled={loading}>
            {loading ? 'Placing order...' : 'Place order'}
          </button>
        </form>

        <aside className="cart-summary">
          <h3>Order Summary</h3>
          {cartItems.map((item) => (
            <div key={item._id} className="summary-row">
              <span>{item.name} x {item.quantity}</span>
              <strong>KSh {(item.price * item.quantity).toLocaleString()}</strong>
            </div>
          ))}
          <div className="summary-row total">
            <span>Total</span>
            <strong>KSh {subtotal.toLocaleString()}</strong>
          </div>
        </aside>
      </div>
    </section>
  );
}

export default CheckoutPage;