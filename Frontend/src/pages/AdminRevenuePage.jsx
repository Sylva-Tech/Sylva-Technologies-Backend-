import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  return `KSh ${amount.toLocaleString('en-KE')}`;
};

function AdminRevenuePage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const loadRevenue = async () => {
    try {
      setError('');
      const response = await api.get('/orders');
      const data = response.data?.data || response.data?.orders || [];
      setOrders(Array.isArray(data) ? data : []);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Unable to load revenue analytics:', err);
      setError(
        err.response?.data?.message ||
          'Unable to load sales revenue analytics.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRevenue();

    const timer = setInterval(() => {
      loadRevenue();
    }, 30000);

    return () => clearInterval(timer);
  }, []);

  const validOrders = useMemo(
    () => orders.filter((order) => order.status !== 'Cancelled'),
    [orders]
  );

  const totalRevenue = useMemo(
    () => validOrders.reduce((sum, order) => sum + Number(order.total || 0), 0),
    [validOrders]
  );

  const totalOrderCount = validOrders.length;
  const averageOrderValue = totalOrderCount ? totalRevenue / totalOrderCount : 0;

  const productSales = useMemo(() => {
    const map = new Map();

    validOrders.forEach((order) => {
      (order.items || []).forEach((item) => {
        const productId = item.product?._id || item.product || item.name;
        const productName = item.name || item.product?.name || 'Unknown product';
        const soldQuantity = Number(item.quantity || 0);
        const lineTotal = Number(item.subtotal || item.unitPrice * soldQuantity || 0);

        if (!map.has(productId)) {
          map.set(productId, {
            id: productId,
            name: productName,
            quantity: 0,
            revenue: 0,
            price: Number(item.unitPrice || 0),
            orders: 0,
          });
        }

        const current = map.get(productId);
        current.quantity += soldQuantity;
        current.revenue += lineTotal;
        current.price = current.price || Number(item.unitPrice || 0);
        current.orders += 1;
      });
    });

    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 12);
  }, [validOrders]);

  const topProduct = productSales[0];

  const exportRevenueCsv = () => {
    const rows = [
      ['Product', 'Units Sold', 'Revenue', 'Unit Price'],
      ...productSales.map((product) => [
        product.name,
        product.quantity,
        product.revenue,
        product.price,
      ]),
    ];

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'total-revenue-report.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="container section-block" style={{ paddingBottom: '3rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <p className="eyebrow">Revenue analytics</p>
          <h1>Sales Performance</h1>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button type="button" className="primary-btn" onClick={exportRevenueCsv}>
            Download report
          </button>
          <button type="button" className="secondary-btn" onClick={() => window.print()}>
            Print
          </button>
          <Link to="/admin" className="secondary-btn">
            Back to dashboard
          </Link>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '14px 16px',
            background: '#fff3cd',
            border: '1px solid #ffe69c',
            borderRadius: '10px',
            marginBottom: '1.5rem',
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
          marginBottom: '2rem',
        }}
      >
        <div className="dashboard-card" style={{ background: '#fff', borderLeft: '4px solid #0d7d53' }}>
          <h3>Total Revenue</h3>
          <p style={{ fontSize: '2rem', fontWeight: 800, color: '#0d7d53' }}>
            {loading ? '...' : formatCurrency(totalRevenue)}
          </p>
          <p>Live order value</p>
        </div>

        <div className="dashboard-card" style={{ background: '#fff', borderLeft: '4px solid #0d7d53' }}>
          <h3>Orders</h3>
          <p style={{ fontSize: '2rem', fontWeight: 800, color: '#0d7d53' }}>
            {loading ? '...' : totalOrderCount}
          </p>
          <p>Completed sales activity</p>
        </div>

        <div className="dashboard-card" style={{ background: '#fff', borderLeft: '4px solid #0d7d53' }}>
          <h3>Average Order</h3>
          <p style={{ fontSize: '2rem', fontWeight: 800, color: '#0d7d53' }}>
            {loading ? '...' : formatCurrency(averageOrderValue)}
          </p>
          <p>Average revenue per order</p>
        </div>

        <div className="dashboard-card" style={{ background: '#fff', borderLeft: '4px solid #0d7d53' }}>
          <h3>Top Product</h3>
          <p style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0d7d53' }}>
            {loading ? '...' : topProduct ? topProduct.name : 'No sales yet'}
          </p>
          <p>{topProduct ? `${topProduct.quantity} units sold` : 'Awaiting products'}</p>
        </div>
      </div>

      <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem' }}>
        <h2 style={{ margin: 0 }}>Best selling products</h2>
        <span className="eyebrow" style={{ background: '#eafaf2', color: '#0d7d53', borderRadius: '999px', padding: '0.35rem 0.7rem' }}>
          Live • Updated {lastUpdated.toLocaleTimeString()}
        </span>
      </div>

      <div className="dashboard-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f3f7f6' }}>
                <th style={{ textAlign: 'left', padding: '0.9rem 1rem' }}>Product</th>
                <th style={{ textAlign: 'left', padding: '0.9rem 1rem' }}>Units Sold</th>
                <th style={{ textAlign: 'left', padding: '0.9rem 1rem' }}>Revenue</th>
                <th style={{ textAlign: 'left', padding: '0.9rem 1rem' }}>Unit Price</th>
              </tr>
            </thead>
            <tbody>
              {productSales.length === 0 && !loading && (
                <tr>
                  <td colSpan="4" style={{ padding: '1rem', textAlign: 'center', color: '#667784' }}>
                    No product sales data available yet.
                  </td>
                </tr>
              )}

              {productSales.map((product) => (
                <tr key={product.id} style={{ borderTop: '1px solid #edf1f2' }}>
                  <td style={{ padding: '0.9rem 1rem', fontWeight: 700 }}>{product.name}</td>
                  <td style={{ padding: '0.9rem 1rem' }}>{product.quantity}</td>
                  <td style={{ padding: '0.9rem 1rem', fontWeight: 700, color: '#0d7d53' }}>
                    {formatCurrency(product.revenue)}
                  </td>
                  <td style={{ padding: '0.9rem 1rem' }}>{formatCurrency(product.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default AdminRevenuePage;
