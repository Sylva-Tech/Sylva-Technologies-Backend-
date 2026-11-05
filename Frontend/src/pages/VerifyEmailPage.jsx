import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import api from '../services/api';

function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('pending');
  const [message, setMessage] = useState('Verifying...');

  useEffect(() => {
    const token = searchParams.get('token');
    const email = searchParams.get('email');

    if (!token || !email) {
      setStatus('error');
      setMessage('Verification link is missing required details. Please try again from your email.');
      return;
    }

    api.get('/auth/verify-email', {
      params: { token, email },
    })
      .then((res) => {
        setStatus('success');
        setMessage(res.data?.message || 'Your email has been verified.');
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err.response?.data?.message || 'Unable to verify your email.');
      });
  }, [searchParams]);

  return (
    <section className="container section-block auth-page">
      <div className="auth-card">
        <div className="auth-intro">
          <span className="eyebrow">Verify Email</span>
          <h2>{status === 'success' ? 'Email Verified' : status === 'error' ? 'Verification Failed' : 'Verifying'}</h2>
          <p>{message}</p>
        </div>
        <div className="auth-form">
          {status === 'success' && <Link to="/login" className="primary-btn full-btn">Continue to Login</Link>}
          {status === 'error' && <Link to="/login" className="primary-btn full-btn">Return to Login</Link>}
        </div>
      </div>
    </section>
  );
}

export default VerifyEmailPage;
