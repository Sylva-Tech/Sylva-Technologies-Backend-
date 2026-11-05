import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

function AuthPage({ mode = 'login' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, register } = useAuth();
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    consentAccepted: false,
    verificationMethod: 'email',
  });
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationSuccess, setVerificationSuccess] = useState(false);
  const successMessage = location.state?.passwordResetSuccess || '';

  const isLogin = mode === 'login';

  const handleChange = (event) => {
    setForm({ ...form, [event.target.name]: event.target.value });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (!isLogin) {
      if (form.password.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }
      if (form.password !== form.confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
      if (!form.consentAccepted) {
        setError('You must agree to the Privacy Policy and Terms & Conditions before creating an account.');
        return;
      }
    }
    setLoading(true);

    try {
      if (isLogin) {
        await login(form.email, form.password);
        navigate('/');
        return;
      }

      const result = await register(form);
      setVerificationEmail(form.email);
      setVerificationSuccess(false);
      setError(result?.message || 'Verification code sent to your email.');
    } catch (err) {
      setError(err.response?.data?.message || 'Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (event) => {
    event.preventDefault();
    setError('');

    if (!verificationEmail || !verificationCode.trim()) {
      setError('Please enter the verification code sent to your email.');
      return;
    }

    try {
      setLoading(true);
      const response = await api.post('/auth/verify-email-code', {
        email: verificationEmail,
        code: verificationCode,
      });

      setVerificationSuccess(true);
      setError(response.data?.message || 'Email verified successfully.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to verify your account.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="container section-block auth-page">
      <div className="auth-card">
        <div className="auth-intro">
          <span className="eyebrow">Sylva account</span>
          <h2>{isLogin ? 'Welcome back' : 'Create your account'}</h2>
          <p>
            {isLogin
              ? 'Sign in to manage orders and your digital setup.'
              : 'Register to verify your account and unlock a smoother checkout experience.'}
          </p>
        </div>

        {successMessage && (
          <div className="auth-card" style={{ marginBottom: '1rem', padding: '1rem', background: '#eefaf3', border: '1px solid #bbebc7' }}>
            <p style={{ margin: 0, color: '#14532d', fontWeight: 600 }}>{successMessage}</p>
          </div>
        )}

        {!isLogin && verificationEmail && (
          <div
            className="auth-card"
            style={{
              marginBottom: '1rem',
              padding: '1rem',
              background: '#f4fbf8',
              border: '1px solid #cfe9d8',
            }}
          >
            <p style={{ margin: '0 0 0.75rem', fontWeight: 700, color: '#14532d' }}>
              Verification required
            </p>
            <p style={{ margin: '0 0 1rem', color: '#14532d' }}>
              A verification code and link have been sent to <strong>{verificationEmail}</strong>.
              Check your inbox, enter the code below, or click the link in the email.
            </p>
            <form onSubmit={handleVerifyCode} className="auth-form">
              <div className="form-group">
                <label>Verification code</label>
                <input
                  type="text"
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value)}
                  placeholder="Enter 6-digit code"
                  maxLength={6}
                />
              </div>
              <button type="submit" className="primary-btn full-btn" disabled={loading}>
                {loading ? 'Verifying...' : 'Verify my account'}
              </button>
            </form>
            {verificationSuccess && (
              <div style={{ marginTop: '1rem' }}>
                <Link to="/login" className="primary-btn full-btn">
                  Continue to login
                </Link>
              </div>
            )}
          </div>
        )}

        {isLogin && (
          <form onSubmit={handleSubmit} className="auth-form">
            <div className="form-group">
              <label>Email Address</label>
              <input type="email" name="email" value={form.email} onChange={handleChange} required />
            </div>

            <div className="form-group">
              <label>Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showPassword ? 'text' : 'password'} name="password" value={form.password} onChange={handleChange} required />
                <button type="button" onClick={() => setShowPassword((s) => !s)} style={{ position: 'absolute', right: 8, top: 8 }} aria-label="Toggle password visibility">
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="auth-links-row">
              <Link to="/forgot-password">Forgot password?</Link>
            </div>

            {error && <p className="auth-error">{error}</p>}

            <button className="primary-btn full-btn" type="submit" disabled={loading}>
              {loading ? 'Please wait...' : 'Login'}
            </button>
          </form>
        )}

        {!isLogin && !verificationEmail && (
          <form onSubmit={handleSubmit} className="auth-form">
            <div className="form-group">
              <label>Full Name</label>
              <input type="text" name="name" value={form.name} onChange={handleChange} required />
            </div>

            <div className="form-group">
              <label>Email Address</label>
              <input type="email" name="email" value={form.email} onChange={handleChange} required />
            </div>

            <div className="form-group">
              <label>Phone Number</label>
              <input type="tel" name="phone" value={form.phone} onChange={handleChange} placeholder="e.g. +254712345678" required />
            </div>

            <div className="form-group">
              <label>Preferred verification method</label>
              <select name="verificationMethod" value={form.verificationMethod} onChange={handleChange}>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </div>

            <div className="form-group">
              <label>Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showPassword ? 'text' : 'password'} name="password" value={form.password} onChange={handleChange} required />
                <button type="button" onClick={() => setShowPassword((s) => !s)} style={{ position: 'absolute', right: 8, top: 8 }} aria-label="Toggle password visibility">
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label>Confirm Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showConfirmPassword ? 'text' : 'password'} name="confirmPassword" value={form.confirmPassword} onChange={handleChange} required />
                <button type="button" onClick={() => setShowConfirmPassword((s) => !s)} style={{ position: 'absolute', right: 8, top: 8 }} aria-label="Toggle confirm password visibility">
                  {showConfirmPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <label className="consent-row">
              <input type="checkbox" name="consentAccepted" checked={form.consentAccepted} onChange={(event) => setForm({ ...form, consentAccepted: event.target.checked })} />
              <span>I agree to the <Link to="/privacy">Privacy Policy</Link> and <Link to="/terms">Terms &amp; Conditions</Link>.</span>
            </label>

            {error && <p className="auth-error">{error}</p>}

            <button className="primary-btn full-btn" type="submit" disabled={loading}>
              {loading ? 'Please wait...' : 'Create Account'}
            </button>
          </form>
        )}

        <p className="auth-switch">
          {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
          <Link to={isLogin ? '/register' : '/login'}>{isLogin ? 'Create Account' : 'Login'}</Link>
        </p>
      </div>
    </section>
  );
}

export default AuthPage;
