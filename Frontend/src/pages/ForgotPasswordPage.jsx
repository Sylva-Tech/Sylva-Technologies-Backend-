import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';

function ForgotPasswordPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const requestReset = async (event) => {
    event.preventDefault();

    setError('');
    setSuccess('');

    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      setError(
        'Please enter the email address associated with your account.'
      );
      return;
    }

    setLoading(true);

    try {
      const response = await api.post(
        '/auth/forgot-password',
        {
          email: normalizedEmail,
        }
      );

      setSuccess(
        response.data?.message ||
          'If an account exists for this email address, a password reset code and link have been sent.'
      );

      /*
       * Give the user a convenient way to enter the code
       * even before clicking the email link.
       */
      setTimeout(() => {
        navigate(
          `/reset-password?email=${encodeURIComponent(
            normalizedEmail
          )}`
        );
      }, 1200);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          'We could not process your password reset request right now.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="container section-block auth-page">
      <div className="auth-card">
        <div className="auth-intro">
          <span className="eyebrow">
            Account recovery
          </span>

          <h2>Reset your password</h2>

          <p>
            Enter your email address and we’ll send you
            a 6-digit password reset code together with
            a secure reset link.
          </p>
        </div>

        <form
          onSubmit={requestReset}
          className="auth-form"
        >
          <div className="form-group">
            <label htmlFor="email">
              Email address
            </label>

            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>

          {error && (
            <p className="auth-error">
              {error}
            </p>
          )}

          {success && (
            <p className="auth-success">
              {success}
            </p>
          )}

          <button
            type="submit"
            className="primary-btn full-btn"
            disabled={loading}
          >
            {loading
              ? 'Sending...'
              : 'Send reset code'}
          </button>
        </form>

        <p className="auth-switch">
          <Link to="/login">
            Back to login
          </Link>
        </p>
      </div>
    </section>
  );
}

export default ForgotPasswordPage;