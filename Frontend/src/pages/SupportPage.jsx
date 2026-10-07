import { useState } from 'react';
import api from '../services/api';

const initialForm = {
  name: '',
  email: '',
  phone: '',
  subject: '',
  message: '',
};

function SupportPage() {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = (field, value) => {
    setForm((currentForm) => ({ ...currentForm, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setStatus('');

    const nextForm = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      subject: form.subject.trim(),
      message: form.message.trim(),
    };

    if (!nextForm.name || !nextForm.email || !nextForm.subject || !nextForm.message) {
      setError('Please complete all required fields before sending your message.');
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(nextForm.email)) {
      setError('Please enter a valid email address.');
      return;
    }

    try {
      setIsSubmitting(true);
      await api.post('/contact', nextForm);
      setStatus('Your message has been sent successfully. Our support team will get back to you soon.');
      setForm(initialForm);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          'We could not send your message right now. Please try again later.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="container section-block support-page">
      <div className="support-header information-hero">
        <p className="eyebrow">Customer Care</p>
        <h1>Customer Support</h1>
        <p>
          We’re here to help with product questions, delivery updates, compatibility advice,
          and after-sales support for your Sylva Technologies order.
        </p>
      </div>

      <div className="support-grid">
        <aside className="support-info">
          <h2>Sylva Technologies</h2>
          <div className="support-contact-item">
            <span>Location</span>
            <strong>Bihi Towers, Moi Avenue</strong>
          </div>
          <div className="support-contact-item">
            <span>Email</span>
            <a href="mailto:sylvatechnologies@outlook.com">sylvatechnologies@outlook.com</a>
          </div>
        </aside>

        <form className="auth-card support-form" onSubmit={handleSubmit} noValidate>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="support-name">Customer name</label>
              <input
                id="support-name"
                type="text"
                value={form.name}
                onChange={(event) => updateField('name', event.target.value)}
                placeholder="Your full name"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="support-email">Customer email</label>
              <input
                id="support-email"
                type="email"
                value={form.email}
                onChange={(event) => updateField('email', event.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="support-phone">Phone number</label>
            <input
              id="support-phone"
              type="tel"
              value={form.phone}
              onChange={(event) => updateField('phone', event.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="form-group">
            <label htmlFor="support-subject">Subject</label>
            <input
              id="support-subject"
              type="text"
              value={form.subject}
              onChange={(event) => updateField('subject', event.target.value)}
              placeholder="How can we help?"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="support-message">Message</label>
            <textarea
              id="support-message"
              rows="6"
              value={form.message}
              onChange={(event) => updateField('message', event.target.value)}
              placeholder="Tell us what you need help with..."
              required
            />
          </div>

          {status && <p className="success-message">{status}</p>}
          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="primary-btn full-btn" disabled={isSubmitting}>
            {isSubmitting ? 'Sending...' : 'Send Message'}
          </button>
        </form>
      </div>
    </section>
  );
}

export default SupportPage;
