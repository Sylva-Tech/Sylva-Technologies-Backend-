import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import api from '../services/api';

function CheckoutPage() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
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
  const [statusMessage, setStatusMessage] = useState('');
  const [loading, setLoading] = useState(false);

  // Email verification state
  const [showVerificationPanel, setShowVerificationPanel] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState(
    user?.email || ''
  );
  const [verificationCode, setVerificationCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);

  // Store the order while verification is taking place
  const [pendingOrderPayload, setPendingOrderPayload] = useState(null);

  const handleChange = (event) => {
    setForm({
      ...form,
      [event.target.name]: event.target.value,
    });
  };

  const submitOrder = async (payload) => {
    const token = localStorage.getItem('sylva-token');

    const response = await api.post('/orders', payload, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const orderData = response.data?.data ?? response.data ?? {};

    clearCart();

    navigate('/profile', {
      state: {
        orderNumber: orderData.orderNumber,
      },
    });
  };

  /*
   * Send verification code to the logged-in user's email.
   */
  const sendVerificationCode = async () => {
    setError('');
    setStatusMessage('');

    const email = verificationEmail.trim();

    if (!email) {
      setError('Your account email address is required.');
      return;
    }

    try {
      setSendingCode(true);

      const response = await api.post(
        '/auth/resend-verification-code',
        { email }
      );

      const message =
        response.data?.message ||
        'A verification code has been sent to your email.';

      setCodeSent(true);
      setStatusMessage(message);
      setVerificationCode('');
    } catch (err) {
      const message =
        err.response?.data?.message ||
        'Unable to send the verification code right now. Please try again.';

      setError(message);
    } finally {
      setSendingCode(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    setError('');
    setStatusMessage('');
    setLoading(true);

    const payload = {
      items: cartItems.map((item) => ({
        product: item._id,
        quantity: item.quantity,
      })),
      customerDetails: form,
      paymentMethod: form.paymentMethod,
      notes: form.notes,
    };

    try {
      /*
       * If the customer is not verified, pause checkout and
       * ask them to verify their account.
       */
      if (user && !user.isVerified) {
        setPendingOrderPayload(payload);

        const accountEmail = user.email || form.email;

        setVerificationEmail(accountEmail);
        setShowVerificationPanel(true);
        setCodeSent(false);
        setVerificationCode('');

        return;
      }

      await submitOrder(payload);
    } catch (err) {
      const serverMessage =
        err.response?.data?.message ||
        'Unable to place order. Please try again.';

      if (
        serverMessage.toLowerCase().includes('verification required') ||
        serverMessage.toLowerCase().includes('verify your account')
      ) {
        setPendingOrderPayload(payload);

        const accountEmail = user?.email || form.email;

        setVerificationEmail(accountEmail);
        setShowVerificationPanel(true);
        setCodeSent(false);
        setVerificationCode('');

        return;
      }

      setError(serverMessage);
    } finally {
      setLoading(false);
    }
  };

  /*
   * Verify the email code and automatically continue
   * with the pending checkout order.
   */
  const verifyAndContinueOrder = async (event) => {
    event.preventDefault();

    setError('');
    setStatusMessage('');

    const code = verificationCode.trim();

    if (!code) {
      setError('Please enter the 6-digit verification code sent to your email.');
      return;
    }

    if (!/^\d{6}$/.test(code)) {
      setError('Please enter a valid 6-digit verification code.');
      return;
    }

    if (!verificationEmail.trim()) {
      setError('Your account email address is missing.');
      return;
    }

    try {
      setLoading(true);

      await api.post('/auth/verify-email-code', {
        email: verificationEmail.trim(),
        code,
      });

      const refreshedUser = await refreshUser();

      if (refreshedUser && refreshedUser.isVerified) {
        setShowVerificationPanel(false);
        setVerificationCode('');
        setCodeSent(false);

        /*
         * Automatically continue the checkout once
         * the account has been verified.
         */
        if (pendingOrderPayload) {
          await submitOrder(pendingOrderPayload);
          return;
        }

        setStatusMessage(
          'Email verified successfully. You can now place your order.'
        );

        return;
      }

      setError(
        'Your account could not be verified yet. Please check the email code and try again.'
      );
    } catch (err) {
      setError(
        err.response?.data?.message ||
          'Unable to verify your account right now.'
      );
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
            <input
              name="fullName"
              value={form.fullName}
              onChange={handleChange}
              required
            />
          </div>

          <div className="checkout-fields">
            <div className="form-group">
              <label>Phone</label>
              <input
                name="phone"
                value={form.phone}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                required
              />
            </div>
          </div>

          <div className="checkout-fields">
            <div className="form-group">
              <label>County</label>
              <input
                name="county"
                value={form.county}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-group">
              <label>Delivery Location</label>
              <input
                name="deliveryLocation"
                value={form.deliveryLocation}
                onChange={handleChange}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>Address or landmark</label>
            <input
              name="address"
              value={form.address}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group">
            <label>Payment Method</label>
            <select
              className="payment-select"
              name="paymentMethod"
              value={form.paymentMethod}
              onChange={handleChange}
            >
              <option>Cash on Delivery</option>
              <option>M-Pesa</option>
              <option>PayPal</option>
              <option>WhatsApp Order</option>
            </select>
          </div>

          <div
            className="checkout-payment-options"
            aria-label="Available payment methods"
          >
            <span>Available payment methods</span>
            <b>Cash on Delivery</b>
            <b>M-Pesa</b>
            <b className="paypal-wordmark">PayPal</b>
          </div>

          {form.paymentMethod === 'M-Pesa' && (
            <div className="payment-instructions">
              <strong>Pay via M-Pesa Till Number</strong>
              <span>
                {import.meta.env.VITE_MPESA_TILL_NUMBER ||
                  'Till number available from customer support'}
              </span>
              <small>
                Enter your M-Pesa transaction code after payment.
              </small>
            </div>
          )}

          {form.paymentMethod === 'PayPal' && (
            <div className="payment-instructions">
              <strong>PayPal payment</strong>
              <span>
                {import.meta.env.VITE_PAYPAL_EMAIL ||
                  'PayPal details available from customer support'}
              </span>
              <small>
                Complete payment, then add the transaction reference below.
              </small>
            </div>
          )}

          {(form.paymentMethod === 'M-Pesa' ||
            form.paymentMethod === 'PayPal') && (
            <div className="form-group">
              <label>Payment reference</label>
              <input
                name="paymentReference"
                value={form.paymentReference}
                onChange={handleChange}
                placeholder="Transaction code or PayPal reference"
                required
              />
            </div>
          )}

          <div className="form-group">
            <label>Order notes</label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows="3"
            />
          </div>

          {error && <p className="auth-error">{error}</p>}

          {statusMessage && (
            <p
              className="auth-success"
              style={{ marginBottom: '1rem' }}
            >
              {statusMessage}
            </p>
          )}

          {showVerificationPanel && (
            <div
              className="auth-card"
              style={{
                marginTop: '1rem',
                padding: '1rem',
                background: '#f4fbf8',
                border: '1px solid #cfe9d8',
              }}
            >
              <p
                style={{
                  margin: '0 0 0.5rem',
                  fontWeight: 700,
                  color: '#14532d',
                  fontSize: '1.1rem',
                }}
              >
                Verify your account
              </p>

              <p
                style={{
                  margin: '0 0 1rem',
                  color: '#14532d',
                  lineHeight: 1.5,
                }}
              >
                Verify your email before we complete your checkout.
                A 6-digit verification code will be sent to your
                account email.
              </p>

              <div className="form-group">
                <label>Email address</label>

                <input
                  type="email"
                  value={verificationEmail}
                  onChange={(event) =>
                    setVerificationEmail(event.target.value)
                  }
                  readOnly={Boolean(user?.email)}
                  placeholder="Enter your account email"
                  autoComplete="email"
                />

                {user?.email && (
                  <small
                    style={{
                      display: 'block',
                      marginTop: '0.4rem',
                      color: '#64748b',
                    }}
                  >
                    This is the email registered on your account.
                  </small>
                )}
              </div>

              {!codeSent && (
                <button
                  type="button"
                  className="primary-btn full-btn"
                  onClick={sendVerificationCode}
                  disabled={sendingCode}
                >
                  {sendingCode
                    ? 'Sending verification code...'
                    : 'Send verification code'}
                </button>
              )}

              {codeSent && (
                <>
                  <div className="form-group">
                    <label>Verification code</label>

                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={verificationCode}
                      onChange={(event) =>
                        setVerificationCode(
                          event.target.value.replace(/\D/g, '').slice(0, 6)
                        )
                      }
                      placeholder="Enter 6-digit code"
                      maxLength={6}
                    />
                  </div>

                  <button
                    type="button"
                    className="secondary-btn full-btn"
                    onClick={sendVerificationCode}
                    disabled={sendingCode || loading}
                  >
                    {sendingCode ? 'Sending...' : 'Resend code'}
                  </button>

                  <button
                    type="button"
                    className="primary-btn full-btn"
                    onClick={verifyAndContinueOrder}
                    disabled={loading}
                  >
                    {loading
                      ? 'Verifying and completing checkout...'
                      : 'Verify & Continue Checkout'}
                  </button>
                </>
              )}
            </div>
          )}

          {!showVerificationPanel && (
            <button
              className="primary-btn full-btn"
              type="submit"
              disabled={loading}
            >
              {loading ? 'Placing order...' : 'Place order'}
            </button>
          )}
        </form>

        <aside className="cart-summary">
          <h3>Order Summary</h3>

          {cartItems.map((item) => (
            <div key={item._id} className="summary-row">
              <span>
                {item.name} x {item.quantity}
              </span>

              <strong>
                KSh {(item.price * item.quantity).toLocaleString()}
              </strong>
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
