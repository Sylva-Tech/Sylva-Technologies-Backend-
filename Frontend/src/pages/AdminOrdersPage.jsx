import { useEffect, useState } from 'react';
import api from '../services/api';

const ORDER_STATUSES = [
  'Pending',
  'Confirmed',
  'Processing',
  'Ready for Delivery',
  'Shipped',
  'Delivered',
  'Cancelled',
];

function AdminOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [updatingOrder, setUpdatingOrder] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const fetchOrders = async () => {
    setLoading(true);
    setError('');

    try {
      const res = await api.get('/orders', {
        params: search.trim() ? { search: search.trim() } : {},
      });

      setOrders(res.data?.data || []);
    } catch (err) {
      console.error('Fetch orders failed:', err);

      setOrders([]);

      setError(
        err.response?.data?.message ||
          'Unable to load orders. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const updateStatus = async (orderId, status) => {
    setUpdatingOrder(orderId);
    setError('');

    try {
   const res = await api.patch(`/orders/${orderId}/status`, {
        status,
      });

      const updatedOrder = res.data?.data;

      setOrders((currentOrders) =>
        currentOrders.map((order) =>
          order._id === orderId
            ? updatedOrder || { ...order, status }
            : order
        )
      );
    } catch (err) {
      console.error('Update status failed:', err);

      setError(
        err.response?.data?.message ||
          'Unable to update the order status.'
      );
    } finally {
      setUpdatingOrder('');
    }
  };

  const formatCurrency = (amount) => {
    return `KSh ${Number(amount || 0).toLocaleString('en-KE')}`;
  };

  const getCustomerName = (order) => {
    return order.customer?.name || order.customerName || 'Customer';
  };

  const getCustomerEmail = (order) => {
    return order.customer?.email || order.customerEmail || 'No email';
  };

  const getCustomerPhone = (order) => {
    return order.customer?.phone || order.customerPhone || '';
  };

  return (
    <section className="container section-block">
      <div
        className="section-head"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '15px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2>Order Management</h2>
          <p>View customer orders and update their status.</p>
        </div>

        <button
          type="button"
          className="primary-btn"
          onClick={fetchOrders}
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh Orders'}
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: '14px',
            marginBottom: '20px',
            borderRadius: '8px',
            background: '#fff3cd',
            border: '1px solid #ffe69c',
            color: '#664d03',
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: '10px',
          marginBottom: '25px',
          flexWrap: 'wrap',
        }}
      >
        <input
          type="text"
          placeholder="Search by order number, customer or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              fetchOrders();
            }
          }}
          style={{
            flex: '1',
            minWidth: '250px',
            padding: '12px',
          }}
        />

        <button
          className="primary-btn"
          type="button"
          onClick={fetchOrders}
          disabled={loading}
        >
          Search
        </button>
      </div>

      {loading ? (
        <p>Loading orders...</p>
      ) : orders.length === 0 ? (
        <div
          style={{
            padding: '30px',
            textAlign: 'center',
            border: '1px solid #ddd',
            borderRadius: '10px',
          }}
        >
          <h3>No orders found</h3>
          <p>There are no orders matching your search.</p>
        </div>
      ) : (
        <div className="admin-order-list">
          {orders.map((order) => {
            const customerName = getCustomerName(order);
            const customerEmail = getCustomerEmail(order);
            const customerPhone = getCustomerPhone(order);

            return (
              <article
                key={order._id}
                className="order-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'minmax(250px, 1fr) minmax(220px, 1fr)',
                  gap: '25px',
                  padding: '20px',
                  marginBottom: '15px',
                  border: '1px solid #ddd',
                  borderRadius: '10px',
                  background: '#fff',
                }}
              >
                <div>
                  <strong style={{ fontSize: '1.05rem' }}>
                    {order.orderNumber || order._id}
                  </strong>

                  <div style={{ marginTop: '8px' }}>
                    <strong>{customerName}</strong>
                  </div>

                  <div>{customerEmail}</div>

                  {customerPhone && <div>{customerPhone}</div>}

                  <div
                    style={{
                      marginTop: '8px',
                      fontSize: '0.9rem',
                      color: '#666',
                    }}
                  >
                    {order.createdAt
                      ? new Date(order.createdAt).toLocaleString('en-KE')
                      : 'Date unavailable'}
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: '1.1rem',
                      fontWeight: 700,
                      marginBottom: '8px',
                    }}
                  >
                    {formatCurrency(order.total)}
                  </div>

                  <div style={{ marginBottom: '10px' }}>
                    Status: <strong>{order.status || 'Pending'}</strong>
                  </div>

                  <select
                    value={order.status || 'Pending'}
                    disabled={updatingOrder === order._id}
                    onChange={(e) =>
                      updateStatus(order._id, e.target.value)
                    }
                    style={{
                      width: '100%',
                      padding: '10px',
                    }}
                  >
                    {ORDER_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>

                  {updatingOrder === order._id && (
                    <small
                      style={{
                        display: 'block',
                        marginTop: '8px',
                      }}
                    >
                      Updating order...
                    </small>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default AdminOrdersPage;
