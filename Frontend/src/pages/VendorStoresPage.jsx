import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

function VendorStoresPage() {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadStores = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await api.get('/admin/vendor-stores');

      const data = response.data?.data || [];

      setStores(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Vendor stores loading failed:', err);

      setError(
        err.response?.data?.message ||
          'Unable to load vendor stores.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStores();
  }, []);

  const formatDate = (date) => {
    if (!date) {
      return 'Not available';
    }

    const value = new Date(date);

    if (Number.isNaN(value.getTime())) {
      return 'Not available';
    }

    return value.toLocaleDateString('en-KE', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatTime = (date) => {
    if (!date) {
      return 'Not available';
    }

    const value = new Date(date);

    if (Number.isNaN(value.getTime())) {
      return 'Not available';
    }

    return value.toLocaleTimeString('en-KE', {
      hour: '2-digit',
      minute: '2-digit',
    });
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
          <h2>Vendor Stores</h2>

          <p>
            Browse approved vendor stores and view their products.
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <Link
            to="/admin"
            className="secondary-btn"
            style={{
              textDecoration: 'none',
            }}
          >
            Admin Dashboard
          </Link>

          <button
            type="button"
            className="primary-btn"
            onClick={loadStores}
            disabled={loading}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '15px',
            marginBottom: '20px',
            borderRadius: '8px',
            background: '#f8d7da',
            border: '1px solid #f5c2c7',
            color: '#842029',
          }}
        >
          {error}
        </div>
      )}

      {loading && (
        <div className="dashboard-card">
          <p>Loading vendor stores...</p>
        </div>
      )}

      {!loading && stores.length === 0 && !error && (
        <div
          className="dashboard-card"
          style={{
            textAlign: 'center',
            padding: '40px 20px',
          }}
        >
          <h3>No Vendor Stores Found</h3>

          <p>
            There are currently no approved vendor stores available.
          </p>
        </div>
      )}

      {!loading && stores.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '20px',
          }}
        >
          {stores.map((store) => {
            const sellerId = store.id;
            const createdAt = store.createdAt;

            return (
              <article
                key={sellerId}
                className="dashboard-card"
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '10px',
                    marginBottom: '15px',
                  }}
                >
                  <div>
                    <h3
                      style={{
                        marginBottom: '5px',
                      }}
                    >
                      {store.storeName || 'Unnamed Store'}
                    </h3>

                    <p
                      style={{
                        margin: 0,
                        color: '#666',
                      }}
                    >
                      Vendor Store
                    </p>
                  </div>

                  <span
                    style={{
                      padding: '5px 10px',
                      borderRadius: '20px',
                      background: '#e8f5e9',
                      color: '#0d7d53',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                    }}
                  >
                    {store.sellerStatus || 'Approved'}
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gap: '10px',
                    marginBottom: '20px',
                  }}
                >
                  <div>
                    <strong>Owner:</strong>{' '}
                    {store.name || 'Owner not available'}
                  </div>

                  <div>
                    <strong>Email:</strong>{' '}
                    {store.email || 'Not available'}
                  </div>

                  <div>
                    <strong>Products:</strong>{' '}
                    {store.productCount ?? 0}
                  </div>

                  <div>
                    <strong>Date Created:</strong>{' '}
                    {formatDate(createdAt)}
                  </div>

                  <div>
                    <strong>Time Created:</strong>{' '}
                    {formatTime(createdAt)}
                  </div>
                </div>

                <Link
                  to={`/vendors/${sellerId}/products`}
                  className="primary-btn"
                  style={{
                    textDecoration: 'none',
                    display: 'inline-block',
                  }}
                >
                  View Products
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default VendorStoresPage;
