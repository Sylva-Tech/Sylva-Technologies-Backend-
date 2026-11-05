import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Store,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

import './SellerLoginPage.css';

function SellerLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const [form, setForm] = useState({
    email: '',
    password: '',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const registrationSuccess =
    location.state?.registrationSuccess || '';

  const handleChange = (event) => {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));

    setError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    const email = form.email.trim();

    if (!email) {
      setError('Please enter your email address.');
      return;
    }

    if (!form.password) {
      setError('Please enter your password.');
      return;
    }

    setLoading(true);

    try {
      const loggedInUser = await login(
        email,
        form.password
      );

      /*
       * APPROVED SELLER
       *
       * Approved sellers have:
       * role = seller
       * sellerStatus = approved
       */
      if (
        loggedInUser?.role === 'seller' &&
        loggedInUser?.sellerStatus === 'approved'
      ) {
        navigate('/seller/dashboard', {
          replace: true,
        });

        return;
      }

      /*
       * PENDING SELLER APPLICATION
       *
       * Pending sellers can log in and view
       * their application status.
       */
      if (
        loggedInUser?.sellerStatus === 'pending'
      ) {
        navigate('/seller/application', {
          replace: true,
        });

        return;
      }

      /*
       * REJECTED SELLER APPLICATION
       *
       * Rejected sellers have their role changed
       * back to customer by the backend.
       *
       * Therefore sellerStatus is used to identify
       * their rejected seller application.
       */
      if (
        loggedInUser?.sellerStatus === 'rejected'
      ) {
        navigate('/seller/application', {
          replace: true,
        });

        return;
      }

      /*
       * ACCOUNT DOES NOT HAVE A SELLER APPLICATION
       */
      localStorage.removeItem('sylva-token');

      setError(
        'This account does not have an active seller application. Please create a seller account first.'
      );
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          'Unable to sign in. Please check your email and password and try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="seller-login-page">
      <div className="seller-login-shell">

        {/* LEFT BRAND PANEL */}
        <section className="seller-login-brand">
          <Link
            to="/sell"
            className="seller-login-logo"
          >
            <span className="seller-login-logo-mark">
              ST
            </span>

            <span className="seller-login-logo-text">
              <strong>SYLVA</strong>
              <small>TECHNOLOGIES</small>
            </span>
          </Link>

          <div className="seller-login-brand-content">
            <span className="seller-login-eyebrow">
              SELLER CENTRE
            </span>

            <h1>
              Manage your
              <span>technology store.</span>
            </h1>

            <p>
              Sign in to manage your store, products,
              orders and seller activity from one
              professional workspace.
            </p>

            <div className="seller-login-benefits">

              <div className="seller-login-benefit">
                <div>
                  <ShieldCheck size={20} />
                </div>

                <span>
                  Secure seller account access
                </span>
              </div>

              <div className="seller-login-benefit">
                <div>
                  <Store size={20} />
                </div>

                <span>
                  Manage your Tech Product Store
                </span>
              </div>

              <div className="seller-login-benefit">
                <div>
                  <LockKeyhole size={20} />
                </div>

                <span>
                  Protected seller information
                </span>
              </div>

            </div>
          </div>

          <div className="seller-login-brand-footer">
            <LockKeyhole size={15} />

            <span>
              Secure seller registration and login
            </span>
          </div>
        </section>

        {/* RIGHT LOGIN CONTENT */}
        <section className="seller-login-content">

          {/* MOBILE LOGO */}
          <div className="seller-login-mobile-logo">
            <Link
              to="/sell"
              className="seller-login-logo"
            >
              <span className="seller-login-logo-mark">
                ST
              </span>

              <span className="seller-login-logo-text">
                <strong>SYLVA</strong>
                <small>TECHNOLOGIES</small>
              </span>
            </Link>
          </div>

          <div className="seller-login-card">

            {/* HEADING */}
            <div className="seller-login-heading">
              <span>SELLER ACCOUNT</span>

              <h2>
                Welcome back
              </h2>

              <p>
                Sign in to access your Sylva Technologies
                Seller Centre.
              </p>
            </div>

            {/* REGISTRATION SUCCESS */}
            {registrationSuccess && (
              <div className="seller-login-success">
                <ShieldCheck size={19} />

                <span>
                  {registrationSuccess}
                </span>
              </div>
            )}

            {/* ERROR */}
            {error && (
              <div
                className="seller-login-error"
                role="alert"
              >
                {error}
              </div>
            )}

            {/* LOGIN FORM */}
            <form
              onSubmit={handleSubmit}
              className="seller-login-form"
            >

              {/* EMAIL */}
              <div className="seller-login-field">
                <label htmlFor="seller-email">
                  Email address
                </label>

                <div className="seller-login-input">
                  <Mail size={18} />

                  <input
                    id="seller-email"
                    name="email"
                    type="email"
                    value={form.email}
                    onChange={handleChange}
                    placeholder="Enter your email address"
                    autoComplete="email"
                    required
                  />
                </div>
              </div>

              {/* PASSWORD */}
              <div className="seller-login-field">
                <label htmlFor="seller-password">
                  Password
                </label>

                <div className="seller-login-input">
                  <LockKeyhole size={18} />

                  <input
                    id="seller-password"
                    name="password"
                    type={
                      showPassword
                        ? 'text'
                        : 'password'
                    }
                    value={form.password}
                    onChange={handleChange}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                  />

                  <button
                    type="button"
                    className="seller-login-password-toggle"
                    onClick={() =>
                      setShowPassword(
                        (current) => !current
                      )
                    }
                    aria-label={
                      showPassword
                        ? 'Hide password'
                        : 'Show password'
                    }
                  >
                    {showPassword ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>
              </div>

              {/* FORGOT PASSWORD */}
              <div className="seller-login-options">
                <Link to="/forgot-password">
                  Forgot password?
                </Link>
              </div>

              {/* LOGIN BUTTON */}
              <button
                type="submit"
                className="seller-login-submit"
                disabled={loading}
              >
                {loading
                  ? 'Signing in...'
                  : 'Sign In to Seller Centre'}
              </button>

            </form>

            {/* DIVIDER */}
            <div className="seller-login-divider">
              <span>
                Don't have a seller account?
              </span>
            </div>

            {/* REGISTER */}
            <Link
              to="/seller/register"
              className="seller-login-register"
            >
              Create Seller Account
            </Link>

            {/* BACK */}
            <Link
              to="/sell"
              className="seller-login-back"
            >
              <ArrowLeft size={16} />
              Back to Seller Portal
            </Link>

          </div>

          {/* SECURITY */}
          <div className="seller-login-security">
            <LockKeyhole size={14} />
            Secure seller login
          </div>

        </section>
      </div>
    </main>
  );
}

export default SellerLoginPage;

