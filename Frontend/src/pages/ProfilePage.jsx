import { useAuth } from '../context/AuthContext';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

function ProfilePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('sylva-token');

    api
      .get('/orders/my-orders', {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((response) => {
        const orderData = response.data?.data ?? response.data ?? [];
        setOrders(Array.isArray(orderData) ? orderData : []);
      })
      .catch(() => setError('Order history is unavailable right now.'));
  }, []);

  const handleDeleteAccount = async () => {
    if (!user?._id) return;

    const confirmed = window.confirm(
      'This will permanently delete your account. Continue?'
    );

    if (!confirmed) return;

    try {
      setDeleting(true);
      await api.delete('/users/me');
      logout();
      navigate('/');
    } catch (deleteError) {
      console.error('Delete account failed:', deleteError);
      setError(
        deleteError.response?.data?.message ||
          'Unable to delete account right now.'
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="container section-block">
      <div className="profile-box">
        <h2>My Profile</h2>
        <div className="meta-list">
          <div><strong>Name:</strong> {user?.name}</div>
          <div><strong>Email:</strong> {user?.email}</div>
          <div><strong>Role:</strong> {user?.role}</div>
        </div>

        <div style={{ marginTop: '1rem' }}>
          <button
            type="button"
            className="secondary-btn"
            onClick={handleDeleteAccount}
            disabled={deleting}
            style={{ borderColor: '#d14343', color: '#b3261e' }}
          >
            {deleting ? 'Deleting...' : 'Delete my account'}
          </button>
        </div>
      </div>

      <div className="profile-box order-history">
        <h2>Order History</h2>
        {error && <p className="auth-error">{error}</p>}
        {!error && orders.length === 0 && <p>No orders yet.</p>}
        {orders.map((order) => (
          <div key={order._id} className="order-row">
            <div>
              <strong>{order.orderNumber}</strong>
              <span>{new Date(order.createdAt).toLocaleDateString()}</span>
            </div>
            <div>
              <strong>KSh {order.total.toLocaleString()}</strong>
              <span className="order-status">{order.status}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default ProfilePage;