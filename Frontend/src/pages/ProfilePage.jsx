import { useAuth } from '../context/AuthContext';
import { useEffect, useState } from 'react';
import api from '../services/api';

function ProfilePage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('sylva-token');

    api
      .get('/orders/my-orders', {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((response) => setOrders(response.data))
      .catch(() => setError('Order history is unavailable right now.'));
  }, []);

  return (
    <section className="container section-block">
      <div className="profile-box">
        <h2>My Profile</h2>
        <div className="meta-list">
          <div><strong>Name:</strong> {user?.name}</div>
          <div><strong>Email:</strong> {user?.email}</div>
          <div><strong>Role:</strong> {user?.role}</div>
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