import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function AdminLoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const user = await login(form.email, form.password);
      if (user.role !== 'admin') {
        throw new Error('This account does not have admin access.');
      }
      navigate('/admin');
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Admin login failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="container section-block auth-page">
      <div className="auth-card">
        <h2>Admin Login</h2>
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </div>
          {error && <p className="auth-error">{error}</p>}
          <button className="primary-btn full-btn" type="submit" disabled={loading}>
            {loading ? 'Checking credentials...' : 'Sign in'}
          </button>
        </form>
      </div>
    </section>
  );
}

export default AdminLoginPage;
