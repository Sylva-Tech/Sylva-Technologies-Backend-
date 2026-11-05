import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  return `KSh ${amount.toLocaleString('en-KE')}`;
};

const getCustomerKey = (order) => {
  const customerId = order?.customer?._id || order?.customer;
  if (customerId) return String(customerId);

  const email = order?.customerEmail || order?.customerDetails?.email || '';
  const phone = order?.customerPhone || order?.customerDetails?.phone || '';
  const name = order?.customerName || order?.customerDetails?.fullName || 'Walk-in customer';

  return `${String(name).toLowerCase()}-${String(email).toLowerCase()}-${String(phone)}`;
};

const buildCustomerReports = (orders) => {
  const customerMap = new Map();

  orders.forEach((order) => {
    const key = getCustomerKey(order);
    const details = order.customerDetails || {};
    const customerId = order?.customer?._id || order?.customer || '';

    const existing = customerMap.get(key) || {
      id: key,
      userId: customerId,
      name: order.customer?.name || order.customerName || details.fullName || 'Customer',
      email: order.customerEmail || order.customer?.email || details.email || '',
      phone: order.customerPhone || order.customer?.phone || details.phone || '',
      location: details.county || details.deliveryLocation || details.address || 'N/A',
      deliveryAddress: [details.address, details.deliveryLocation, details.county].filter(Boolean).join(', ') || 'N/A',
      orders: [],
      totalSpent: 0,
      itemsBought: 0,
      lastOrderDate: null,
    };

    const itemCount = (order.items || []).reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0
    );

    existing.itemsBought += itemCount;
    existing.totalSpent += Number(order.total || 0);
    existing.orders.push(order);

    const dateValue = new Date(order.createdAt || Date.now()).getTime();
    if (!existing.lastOrderDate || dateValue > new Date(existing.lastOrderDate).getTime()) {
      existing.lastOrderDate = order.createdAt || new Date().toISOString();
    }

    customerMap.set(key, existing);
  });

  return Array.from(customerMap.values())
    .map((customer) => ({
      ...customer,
      orderCount: customer.orders.length,
      totalSpent: Number(customer.totalSpent || 0),
      itemsBought: Number(customer.itemsBought || 0),
    }))
    .sort((a, b) => b.totalSpent - a.totalSpent);
};

function AdminCustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [deleting, setDeleting] = useState(false);

  const loadCustomers = async () => {
    try {
      setLoading(true);
      setError('');

      const response = await api.get('/orders');
      const orders = response.data?.data || response.data?.orders || [];
      const customerReports = buildCustomerReports(orders);

      setCustomers(customerReports);
      setSelectedCustomerId(customerReports[0]?.id || '');
    } catch (err) {
      console.error('Unable to load customer shipping list:', err);
      setError(err.response?.data?.message || 'Unable to load customer information.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const filteredCustomers = useMemo(() => {
    if (!searchTerm.trim()) return customers;

    const query = searchTerm.toLowerCase();

    return customers.filter((customer) =>
      [customer.name, customer.email, customer.phone, customer.location]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [customers, searchTerm]);

  useEffect(() => {
    if (!filteredCustomers.length) {
      setSelectedCustomerId('');
      return;
    }

    if (!filteredCustomers.some((customer) => customer.id === selectedCustomerId)) {
      setSelectedCustomerId(filteredCustomers[0].id);
    }
  }, [filteredCustomers, selectedCustomerId]);

  const selectedCustomer = useMemo(
    () => filteredCustomers.find((customer) => customer.id === selectedCustomerId) || null,
    [filteredCustomers, selectedCustomerId]
  );

  const handleDeleteCustomer = async (customer) => {
    if (!customer?.userId) {
      setError('This customer cannot be deleted because no account is linked to this order history.');
      return;
    }

    const confirmed = window.confirm(
      `Delete ${customer.name}'s account and revoke access? This action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      setDeleting(true);
      await api.delete(`/users/${customer.userId}`);
      setCustomers((current) => current.filter((item) => item.userId !== customer.userId));
      setError('');
    } catch (err) {
      console.error('Delete customer account failed:', err);
      setError(err.response?.data?.message || 'Unable to delete this customer account.');
    } finally {
      setDeleting(false);
    }
  };

  const handlePrint = () => window.print();

  const printStyles = `
    <style>
      @page {
        size: A4 portrait;
        margin: 12mm;
      }

      @media print {
        body {
          background: #fff !important;
        }

        .no-print {
          display: none !important;
        }

        .shipping-label-sheet {
          display: block !important;
          width: 100%;
          min-height: 100vh;
          padding: 18mm 14mm;
          background: #fff;
          border: 1px solid #dfe7ea;
          box-sizing: border-box;
        }

        .shipping-label-sheet .label-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 8mm;
        }

        .shipping-label-sheet strong {
          display: block;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #334155;
          margin-bottom: 3mm;
        }

        .shipping-label-sheet p {
          margin: 0;
          font-size: 18px;
          line-height: 1.5;
          color: #111827;
        }
      }
    </style>
  `;

  const exportAllCustomersCsv = () => {
    const rows = [
      ['Customer Name', 'Email', 'Phone', 'Location', 'Delivery Address', 'Products', 'Total Paid'],
    ];

    customers.forEach((customer) => {
      const products = (customer.orders || [])
        .flatMap((order) => order.items || [])
        .map((item) => `${item.name} x ${item.quantity}`)
        .join(' | ');

      rows.push([
        customer.name,
        customer.email,
        customer.phone,
        customer.location,
        customer.deliveryAddress,
        products,
        customer.totalSpent,
      ]);
    });

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'customer-sales-report.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: printStyles }} />

      <div className="shipping-label-sheet" style={{ display: 'none' }}>
        {selectedCustomer && (
          <div className="label-grid">
            <div>
              <strong>Company / Customer</strong>
              <p>{selectedCustomer.name}</p>
            </div>
            <div>
              <strong>Shipping address</strong>
              <p>{selectedCustomer.deliveryAddress}</p>
            </div>
            <div>
              <strong>Products</strong>
              <p>
                {(selectedCustomer.orders || [])
                  .flatMap((order) => order.items || [])
                  .map((item) => `${item.name} x ${item.quantity}`)
                  .join(', ') || 'No products'}
              </p>
            </div>
          </div>
        )}
      </div>

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
          <p className="eyebrow">Customer records</p>
          <h1>Manage Customers</h1>
        </div>

        <div className="no-print" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button type="button" className="primary-btn" onClick={exportAllCustomersCsv}>
            Download all
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
          gridTemplateColumns: 'minmax(280px, 1fr)',
          gap: '1.5rem',
        }}
      >
        <div className="dashboard-card" style={{ padding: '1rem', background: '#fff' }}>
          <h3>Customer list</h3>

          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search customer"
            style={{
              width: '100%',
              padding: '0.8rem 0.9rem',
              borderRadius: '8px',
              border: '1px solid #dfe7ea',
              marginBottom: '1rem',
            }}
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
              gap: '0.8rem',
            }}
          >
            {filteredCustomers.length === 0 && !loading && (
              <div className="empty-state">No customers found.</div>
            )}

            {filteredCustomers.map((customer) => (
              <button
                type="button"
                key={customer.id}
                onClick={() => setSelectedCustomerId(customer.id)}
                style={{
                  textAlign: 'left',
                  border: selectedCustomerId === customer.id ? '2px solid #0d7d53' : '1px solid #dfe7ea',
                  background: selectedCustomerId === customer.id ? '#f0faf5' : '#fff',
                  borderRadius: '12px',
                  padding: '0.9rem',
                  cursor: 'pointer',
                  minHeight: '170px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', alignItems: 'center' }}>
                  <strong>{customer.name}</strong>
                  <span style={{ color: '#0d7d53', fontWeight: 700 }}>{formatCurrency(customer.totalSpent)}</span>
                </div>
                <p style={{ margin: '0.3rem 0', color: '#4d5d6b' }}>{customer.email || 'No email'}</p>
                <p style={{ margin: '0.2rem 0', color: '#4d5d6b' }}>{customer.phone || 'No phone number'}</p>
                <p style={{ margin: '0.2rem 0', color: '#4d5d6b' }}>{customer.location}</p>
                <div style={{ marginTop: '0.6rem', color: '#667784', fontSize: '0.8rem' }}>
                  {customer.orderCount} orders • {customer.itemsBought} items
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="dashboard-card" style={{ padding: '1rem', background: '#fff' }}>
          {selectedCustomer ? (
            <>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.8rem',
                  flexWrap: 'wrap',
                  padding: '0.9rem 1rem',
                  borderRadius: '14px',
                  background: '#f1f8f4',
                  border: '1px solid #dfeee7',
                  marginBottom: '1.2rem',
                }}
              >
                <div>
                  <p className="eyebrow" style={{ marginBottom: 0 }}>Shipping label</p>
                  <h2 style={{ margin: '0.2rem 0 0' }}>{selectedCustomer.name}</h2>
                </div>

                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <button type="button" className="secondary-btn" onClick={handlePrint}>
                    Print label
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => handleDeleteCustomer(selectedCustomer)}
                    disabled={deleting}
                    style={{ borderColor: '#d14343', color: '#b3261e' }}
                  >
                    {deleting ? 'Deleting...' : 'Delete account'}
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '1rem',
                  marginBottom: '1.5rem',
                }}
              >
                <div style={{ background: '#f7faf9', borderRadius: '12px', padding: '0.9rem' }}>
                  <strong>Company / Customer</strong>
                  <p style={{ margin: '0.35rem 0 0' }}>{selectedCustomer.name}</p>
                </div>

                <div style={{ background: '#f7faf9', borderRadius: '12px', padding: '0.9rem' }}>
                  <strong>Shipping address</strong>
                  <p style={{ margin: '0.35rem 0 0' }}>{selectedCustomer.deliveryAddress}</p>
                </div>

                <div style={{ background: '#f7faf9', borderRadius: '12px', padding: '0.9rem' }}>
                  <strong>Products</strong>
                  <p style={{ margin: '0.35rem 0 0' }}>
                    {(selectedCustomer.orders || [])
                      .flatMap((order) => order.items || [])
                      .map((item) => `${item.name} x ${item.quantity}`)
                      .join(', ') || 'No products'}
                  </p>
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <strong>Customer order summary</strong>
                <div style={{ marginTop: '0.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <span className="eyebrow">Orders: {selectedCustomer.orderCount}</span>
                  <span className="eyebrow">Items: {selectedCustomer.itemsBought}</span>
                  <span className="eyebrow">Total paid: {formatCurrency(selectedCustomer.totalSpent)}</span>
                </div>
              </div>

              <div style={{ overflowX: 'auto', border: '1px solid #e9eef2', borderRadius: '12px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f3f7f6' }}>
                      <th style={{ textAlign: 'left', padding: '0.8rem' }}>Order</th>
                      <th style={{ textAlign: 'left', padding: '0.8rem' }}>Item(s)</th>
                      <th style={{ textAlign: 'left', padding: '0.8rem' }}>Amount</th>
                      <th style={{ textAlign: 'left', padding: '0.8rem' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedCustomer.orders.map((order) => (
                      <tr key={order._id} style={{ borderTop: '1px solid #edf1f2' }}>
                        <td style={{ padding: '0.8rem', verticalAlign: 'top' }}>
                          <strong>{order.orderNumber}</strong>
                          <div style={{ color: '#667784', fontSize: '0.8rem' }}>
                            {new Date(order.createdAt).toLocaleDateString()}
                          </div>
                        </td>
                        <td style={{ padding: '0.8rem', verticalAlign: 'top' }}>
                          {(order.items || []).map((item) => (
                            <div key={`${order._id}-${item.product || item.name}`}>
                              {item.name} x {item.quantity}
                            </div>
                          ))}
                        </td>
                        <td style={{ padding: '0.8rem', verticalAlign: 'top', fontWeight: 700 }}>
                          {formatCurrency(order.total || 0)}
                        </td>
                        <td style={{ padding: '0.8rem', verticalAlign: 'top' }}>
                          <div>{order.status}</div>
                          <small>{order.paymentStatus}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="empty-state">Select a customer to view shipping details.</div>
          )}
        </div>
      </div>
      </section>
    </>
  );
}

export default AdminCustomersPage;
