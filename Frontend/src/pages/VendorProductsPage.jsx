import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../services/api';

function VendorProductsPage() {
  const { sellerId } = useParams();

  const [seller, setSeller] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadVendorProducts = async () => {
      try {
        setLoading(true);
        setError('');

        const response = await api.get(
          `/admin/vendor-stores/${sellerId}/products`
        );

        setSeller(response.data?.seller || null);
        setProducts(response.data?.data || []);
      } catch (err) {
        console.error(
          'Load vendor products error:',
          err
        );

        setError(
          err.response?.data?.message ||
            'Unable to load vendor products.'
        );
      } finally {
        setLoading(false);
      }
    };

    if (sellerId) {
      loadVendorProducts();
    }
  }, [sellerId]);

  const formatDate = (date) => {
    if (!date) return 'N/A';

    return new Date(date).toLocaleDateString(
      'en-KE',
      {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }
    );
  };

  const formatTime = (date) => {
    if (!date) return 'N/A';

    return new Date(date).toLocaleTimeString(
      'en-KE',
      {
        hour: '2-digit',
        minute: '2-digit',
      }
    );
  };

  const formatPrice = (price) => {
    return `KSh ${Number(
      price || 0
    ).toLocaleString('en-KE')}`;
  };

  if (loading) {
    return (
      <div className="container section-block">
        <p>Loading vendor products...</p>
      </div>
    );
  }

  return (
    <div className="container section-block">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          marginBottom: '2rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <Link
            to="/vendors"
            className="text-action"
          >
            ← Back to Vendor Stores
          </Link>

          <h1 style={{ marginBottom: '0.5rem' }}>
            {seller?.storeName ||
              'Vendor Store'}
          </h1>

          {seller && (
            <div>
              <p>
                <strong>Owner:</strong>{' '}
                {seller.name}
              </p>

              <p>
                <strong>Email:</strong>{' '}
                {seller.email}
              </p>

              <p>
                <strong>Products:</strong>{' '}
                {products.length}
              </p>

              <p>
                <strong>Created:</strong>{' '}
                {formatDate(
                  seller.createdAt
                )}{' '}
                at{' '}
                {formatTime(
                  seller.createdAt
                )}
              </p>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div
          className="alert alert-error"
          style={{
            marginBottom: '1.5rem',
          }}
        >
          {error}
        </div>
      )}

      {!error && products.length === 0 && (
        <div className="section-block">
          <h3>No products found</h3>
          <p>
            This vendor has not added any
            products yet.
          </p>
        </div>
      )}

      {products.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fill, minmax(260px, 1fr))',
            gap: '1.5rem',
          }}
        >
          {products.map((product) => (
            <div
              key={product._id}
              className="dashboard-card"
              style={{
                overflow: 'hidden',
              }}
            >
              {product.images?.[0] && (
                <img
                  src={product.images[0]}
                  alt={product.name}
                  style={{
                    width: '100%',
                    height: '200px',
                    objectFit: 'contain',
                    borderRadius: '8px',
                    marginBottom: '1rem',
                  }}
                />
              )}

              <h3>
                {product.name ||
                  'Unnamed Product'}
              </h3>

              <p>
                <strong>Price:</strong>{' '}
                {formatPrice(
                  product.price
                )}
              </p>

              <p>
                <strong>Stock:</strong>{' '}
                {product.stock ?? 0}
              </p>

              <p>
                <strong>Status:</strong>{' '}
                {product.approvalStatus ||
                  (product.isActive
                    ? 'active'
                    : 'inactive')}
              </p>

              {product.category && (
                <p>
                  <strong>Category:</strong>{' '}
                  {product.category.name ||
                    product.category.title ||
                    'N/A'}
                </p>
              )}

              <p>
                <strong>Created:</strong>{' '}
                {formatDate(
                  product.createdAt
                )}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default VendorProductsPage;