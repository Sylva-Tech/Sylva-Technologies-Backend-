import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

function AdminDashboardPage() {
  const [stats, setStats] = useState({
    orders: 0,
    revenue: 0,
    customers: 0,
    products: 0,
  });

  const [recentOrders, setRecentOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const formatCurrency = (amount) => {
    const value = Number(amount || 0);
    return `KSh ${value.toLocaleString('en-KE')}`;
  };

  const getCustomerName = (order) => {
    return order.customer?.name || order.customerName || 'Customer';
  };

  const loadDashboard = async () => {
    setLoading(true);
    setError('');

    try {
      const [productsResponse, ordersResponse] = await Promise.all([
        api.get('/products', { params: { limit: 1000 } }),
        api.get('/orders'),
      ]);

      const products =
        productsResponse.data?.products ||
        productsResponse.data?.data ||
        [];

      const orders =
        ordersResponse.data?.data ||
        ordersResponse.data?.orders ||
        [];

      const validOrders = orders.filter(
        (order) => order.status !== 'Cancelled'
      );

      const revenue = validOrders.reduce(
        (total, order) => total + Number(order.total || 0),
        0
      );

      const customerIds = new Set(
        orders
          .map((order) => order.customer?._id || order.customer)
          .filter(Boolean)
      );

      setStats({
        orders: orders.length,
        revenue,
        customers: customerIds.size,
        products: products.length,
      });

      setRecentOrders(orders.slice(0, 8));
    } catch (err) {
      console.error('Dashboard loading failed:', err);

      setError(
        err.response?.data?.message ||
          'Unable to load dashboard data from the server.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  return (
    <section className="container section-block dashboard-shell">
      {/* ADMIN DASHBOARD HEADER */}
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
          <h2>Admin Dashboard</h2>
          <p>
            Manage Sylva Technologies and the marketplace from one place.
          </p>
        </div>

        <button
          type="button"
          className="primary-btn"
          onClick={loadDashboard}
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* ERROR */}
      {error && (
        <div
          style={{
            padding: '15px',
            marginBottom: '20px',
            borderRadius: '8px',
            background: '#fff3cd',
            border: '1px solid #ffe69c',
          }}
        >
          {error}
        </div>
      )}

      {/* CORE BUSINESS STATISTICS */}
      <div className="dashboard-grid">
        <div className="dashboard-card">
          <h3>Total Orders</h3>

          <p
            style={{
              fontSize: '2rem',
              fontWeight: 800,
              color: '#0d7d53',
            }}
          >
            {loading ? '...' : stats.orders}
          </p>

          <p>Customer orders</p>

          <Link to="/admin/orders" className="text-action">
            Manage orders →
          </Link>
        </div>

        <Link
          to="/admin/revenue"
          className="dashboard-card"
          style={{
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <h3>Total Revenue</h3>

          <p
            style={{
              fontSize: '2rem',
              fontWeight: 800,
              color: '#0d7d53',
            }}
          >
            {loading ? '...' : formatCurrency(stats.revenue)}
          </p>

          <p>Non-cancelled orders</p>

          <span className="text-action">View sales analysis →</span>
        </Link>

        <div className="dashboard-card">
          <h3>Customers</h3>

          <p
            style={{
              fontSize: '2rem',
              fontWeight: 800,
              color: '#0d7d53',
            }}
          >
            {loading ? '...' : stats.customers}
          </p>

          <p>Customers with orders</p>

          <Link to="/admin/customers" className="text-action">
            Manage customers →
          </Link>
        </div>

        <div className="dashboard-card">
          <h3>Products</h3>

          <p
            style={{
              fontSize: '2rem',
              fontWeight: 800,
              color: '#0d7d53',
            }}
          >
            {loading ? '...' : stats.products}
          </p>

          <p>Products in catalogue</p>

          <Link to="/admin/products" className="text-action">
            Manage products →
          </Link>
        </div>
      </div>

      {/* MARKETPLACE AREA */}
      <div
        style={{
          marginTop: '35px',
          marginBottom: '20px',
        }}
      >
        <div className="section-head">
          <h2>Marketplace Management</h2>

          <p>
            Manage sellers, products, orders and the Sylva Technologies
            marketplace.
          </p>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '15px',
          marginBottom: '30px',
        }}
      >
        {/* SELLER APPLICATIONS */}
        <Link
          to="/admin/sellers"
          className="dashboard-card"
          style={{
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <h3>Seller Applications</h3>

          <p>
            Review, approve and manage people and businesses selling on
            Sylva Technologies.
          </p>

          <span className="text-action">
            Manage sellers →
          </span>
        </Link>

        {/* PRODUCT APPROVALS */}
        <Link
          to="/admin/product-approvals"
          className="dashboard-card"
          style={{
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <h3>Product Approvals</h3>

          <p>
            Review seller products before they become visible to customers.
          </p>

          <span className="text-action">
            Review products →
          </span>
        </Link>

        {/* VENDOR STORES */}
        <Link
          to="/vendors"
          className="dashboard-card"
          style={{
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <h3>Vendor Stores</h3>

          <p>
            View the public marketplace where customers can discover seller
            stores.
          </p>

          <span className="text-action">
            View stores →
          </span>
        </Link>

        {/* SELL ON SYLVA */}
        <Link
          to="/sell"
          className="dashboard-card"
          style={{
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <h3>Sell on Sylva</h3>

          <p>
            Public seller onboarding page for businesses and individuals
            who want to sell.
          </p>

          <span className="text-action">
            View seller page →
          </span>
        </Link>
      </div>

      {/* ADMIN QUICK ACTIONS */}
      <div
        className="section-head"
        style={{
          marginTop: '30px',
          marginBottom: '15px',
        }}
      >
        <h2>Quick Actions</h2>

        <p>Quickly access the main administration areas.</p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '15px',
          marginBottom: '35px',
        }}
      >
        <Link
          to="/admin/products"
          className="dashboard-card"
          style={{
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <h3>Products</h3>
          <p>Add, edit and manage products.</p>
        </Link>

        <Link
          to="/admin/orders"
          className="dashboard-card"
          style={{
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <h3>Orders</h3>
          <p>View and update customer orders.</p>
        </Link>

        <Link
          to="/admin/sellers"
          className="dashboard-card"
          style={{
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <h3>Manage Sellers</h3>
          <p>Review and manage seller accounts.</p>
        </Link>

        <Link
          to="/admin/product-approvals"
          className="dashboard-card"
          style={{
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <h3>Product Approvals</h3>
          <p>Review products submitted by sellers.</p>
        </Link>

        <Link
          to="/admin/customers"
          className="dashboard-card"
          style={{
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <h3>Customers</h3>
          <p>Manage registered customers.</p>
        </Link>

        <Link
          to="/admin/categories"
          className="dashboard-card"
          style={{
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <h3>Categories</h3>
          <p>Manage product categories.</p>
        </Link>

        <Link
          to="/admin/ads"
          className="dashboard-card"
          style={{
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <h3>Advertisements</h3>
          <p>Manage website advertisements.</p>
        </Link>

        <Link
          to="/admin/products/import"
          className="dashboard-card"
          style={{
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <h3>Import Products</h3>
          <p>Import products into the catalogue.</p>
        </Link>

        <Link
          to="/admin/profile"
          className="dashboard-card"
          style={{
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <h3>Admin Profile</h3>
          <p>Manage your administrator account.</p>
        </Link>
      </div>

      {/* MARKETPLACE ALERTS */}
      <div
        className="admin-offers"
        style={{
          marginBottom: '35px',
        }}
      >
        <div className="section-head">
          <h2>Marketplace Alerts</h2>

          <p>
            Important actions requiring administrator attention.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '15px',
          }}
        >
          <Link
            to="/admin/sellers"
            className="dashboard-card"
            style={{
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <h3>Seller Applications</h3>

            <p>
              Review new seller applications and verification requests.
            </p>

            <span className="text-action">
              Open seller management →
            </span>
          </Link>

          <Link
            to="/admin/product-approvals"
            className="dashboard-card"
            style={{
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <h3>Product Reviews</h3>

            <p>
              Review products submitted by approved sellers.
            </p>

            <span className="text-action">
              Open approvals →
            </span>
          </Link>

          <Link
            to="/admin/orders"
            className="dashboard-card"
            style={{
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <h3>Order Activity</h3>

            <p>
              Review recent orders and update their status.
            </p>

            <span className="text-action">
              Manage orders →
            </span>
          </Link>
        </div>
      </div>

      {/* RECENT ORDERS */}
      <div className="admin-offers">
        <div className="section-head">
          <h2>Recent Orders</h2>

          <p>Latest customer orders from your store.</p>

          <Link to="/admin/orders" className="text-action">
            View all orders →
          </Link>
        </div>

        {loading ? (
          <p>Loading orders...</p>
        ) : recentOrders.length === 0 ? (
          <p>No orders found.</p>
        ) : (
          <div className="admin-order-list">
            {recentOrders.map((order) => (
              <article
                key={order._id}
                className="order-row"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '20px',
                  flexWrap: 'wrap',
                  padding: '15px',
                  marginBottom: '10px',
                  borderBottom: '1px solid #ddd',
                }}
              >
                <div>
                  <strong>
                    {order.orderNumber || order._id}
                  </strong>

                  <div>
                    {getCustomerName(order)}
                  </div>

                  <small>
                    {order.customer?.email ||
                      order.customerEmail ||
                      'No email'}
                  </small>

                  {order.customer?.phone ||
                  order.customerPhone ? (
                    <small
                      style={{
                        display: 'block',
                        marginTop: '4px',
                      }}
                    >
                      {order.customer?.phone ||
                        order.customerPhone}
                    </small>
                  ) : null}
                </div>

                <div>
                  <strong>
                    {formatCurrency(order.total)}
                  </strong>

                  <div>
                    Status: {order.status || 'Pending'}
                  </div>

                  <div>
                    Payment: {order.paymentStatus || 'Pending'}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default AdminDashboardPage;