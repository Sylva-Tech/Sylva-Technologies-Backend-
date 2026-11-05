import { useState } from 'react';
import api from '../services/api';

function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus('');
    setError('');

    try {
      await api.post('/contact', form);
      setForm({ name: '', email: '', phone: '', message: '' });
      setStatus('Thanks. Your message has been sent and our team will get back to you.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'We could not send your message right now.');
    }
  };

  return (
    <section className="container section-block contact-page">
      <div className="information-hero">
        <p className="eyebrow">We are here to help</p>
        <h1>Contact Sylva Technologies</h1>
        <p>Ask about a product, delivery, compatibility, upgrades or an order. Send a message and our team will help you find the next practical step.</p>
      </div>
      <div className="contact-layout">
        <div className="contact-details">
          <h2>Visit or reach us</h2>
          <p>sylvatechnologies@outlook.com</p>
          <p>0700 932 014</p>
          <p className="contact-note">For faster assistance, include the product name, order number or device details relevant to your question.</p>
        </div>
        <form className="auth-card contact-form" onSubmit={handleSubmit}>
          <div className="form-group"><label>Name</label><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></div>
          <div className="form-group"><label>Email</label><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></div>
          <div className="form-group"><label>Phone</label><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div>
          <div className="form-group"><label>Message</label><textarea rows="5" value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} required /></div>
          {status && <p className="success-message">{status}</p>}
          {error && <p className="auth-error">{error}</p>}
          <button className="primary-btn full-btn" type="submit">Send message</button>
        </form>
      </div>
    </section>
  );
}

export default ContactPage;
