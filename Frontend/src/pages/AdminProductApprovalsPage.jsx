import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

function AdminProductApprovalsPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const [success, setSuccess] = useState('');

  const loadProducts = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await api.get(
        '/products/admin/product-approvals'
      );

      const data =
        response.data?.products ||
        response.data?.data ||
        [];

      setProducts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(
        'Product approvals loading failed:',
        err
      );

      setError(
        err.response?.data?.message ||
          'Unable to load product approval requests.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  const handleApprove = async (productId) => {
    setActionLoading(productId);
    setError('');
    setSuccess('');

    try {
      await api.put(
        `/products/admin/product-approvals/${productId}/approve`
      );

      setSuccess(
        'Product approved successfully.'
      );

      setProducts((currentProducts) =>
        currentProducts.filter(
          (product) => product._id !== productId
        )
      );
    } catch (err) {
      console.error(
        'Product approval failed:',
        err
      );

      setError(
        err.response?.data?.message ||
          'Unable to approve this product.'
      );
    } finally {
      setActionLoading('');
    }
  };

  const handleReject = async (productId) => {
    const reason = window.prompt(
      'Please enter the reason for rejecting this product:'
    );

    if (reason === null) {
      return;
    }

    const trimmedReason = reason.trim();

    if (!trimmedReason) {
      setError(
        'A rejection reason is required.'
      );
      return;
    }

    setActionLoading(productId);
    setError('');
    setSuccess('');

    try {
      await api.put(
        `/products/admin/product-approvals/${productId}/reject`,
        {
          rejectionReason: trimmedReason,
        }
      );

      setSuccess(
        'Product rejected successfully.'
      );

      setProducts((currentProducts) =>
        currentProducts.filter(
          (product) => product._id !== productId
        )
      );
    } catch (err) {
      console.error(
        'Product rejection failed:',
        err
      );

      setError(
        err.response?.data?.message ||
          'Unable to reject this product.'
      );
    } finally {
      setActionLoading('');
    }
  };

  const getProductImage = (product) => {
    if (product.image) {
      return product.image;
    }

    if (product.imageUrl) {
      return product.imageUrl;
    }

    if (
      Array.isArray(product.images) &&
      product.images.length > 0
    ) {
      const firstImage = product.images[0];

      if (typeof firstImage === 'string') {
        return firstImage;
      }

      return (
        firstImage?.url ||
        firstImage?.secure_url ||
        ''
      );
    }

    return '';
  };

  const getSellerName = (product) => {
    return (
      product.seller?.storeName ||
      product.seller?.sellerProfile?.storeName ||
      product.seller?.name ||
      product.storeName ||
      'Seller'
    );
  };

  return (
    <section className="container section-block">
      {/* HEADER */}
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
          <h2>Product Approvals</h2>

          <p>
            Review products submitted by sellers before they become
            visible to customers.
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
            Back to Dashboard
          </Link>

          <button
            type="button"
            className="primary-btn"
            onClick={loadProducts}
            disabled={loading}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* SUCCESS MESSAGE */}
      {success && (
        <div
          style={{
            padding: '15px',
            marginBottom: '20px',
            borderRadius: '8px',
            background: '#d1e7dd',
            border: '1px solid #badbcc',
            color: '#0f5132',
          }}
        >
          {success}
        </div>
      )}

      {/* ERROR MESSAGE */}
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

      {/* LOADING */}
      {loading && (
        <div className="dashboard-card">
          <p>
            Loading product approval requests...
          </p>
        </div>
      )}

      {/* EMPTY */}
      {!loading &&
        products.length === 0 &&
        !error && (
          <div
            className="dashboard-card"
            style={{
              textAlign: 'center',
              padding: '40px 20px',
            }}
          >
            <h3>No Product Approvals</h3>

            <p>
              There are currently no seller products
              waiting for approval.
            </p>
          </div>
        )}

      {/* PRODUCTS */}
      {!loading && products.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '20px',
          }}
        >
          {products.map((product) => {
            const image =
              getProductImage(product);

            const productId =
              product._id;

            const isProcessing =
              actionLoading === productId;

            return (
              <article
                key={productId}
                className="dashboard-card"
                style={{
                  overflow: 'hidden',
                }}
              >
                {/* PRODUCT IMAGE */}
                {image ? (
                  <div
                    style={{
                      width: '100%',
                      height: '220px',
                      marginBottom: '15px',
                      background: '#f5f5f5',
                      borderRadius: '8px',
                      overflow: 'hidden',
                    }}
                  >
                    <img
                      src={image}
                      alt={
                        product.name ||
                        'Product'
                      }
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                      }}
                    />
                  </div>
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: '220px',
                      marginBottom: '15px',
                      background: '#f5f5f5',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#777',
                    }}
                  >
                    No product image
                  </div>
                )}

                {/* PRODUCT INFORMATION */}
                <h3>
                  {product.name ||
                    'Unnamed Product'}
                </h3>

                <p>
                  <strong>Seller:</strong>{' '}
                  {getSellerName(product)}
                </p>

                <p>
                  <strong>Price:</strong>{' '}
                  KSh{' '}
                  {Number(
                    product.price || 0
                  ).toLocaleString(
                    'en-KE'
                  )}
                </p>

                {product.category && (
                  <p>
                    <strong>
                      Category:
                    </strong>{' '}
                    {typeof product.category ===
                    'object'
                      ? product.category.name
                      : product.category}
                  </p>
                )}

                {product.description && (
                  <p
                    style={{
                      display:
                        '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient:
                        'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {product.description}
                  </p>
                )}

                <p>
                  <strong>Status:</strong>{' '}
                  {product.approvalStatus ||
                    product.status ||
                    'Pending'}
                </p>

                {/* ACTIONS */}
                <div
                  style={{
                    display: 'flex',
                    gap: '10px',
                    marginTop: '20px',
                    flexWrap: 'wrap',
                  }}
                >
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() =>
                      handleApprove(
                        productId
                      )
                    }
                    disabled={isProcessing}
                  >
                    {isProcessing
                      ? 'Processing...'
                      : 'Approve'}
                  </button>

                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() =>
                      handleReject(
                        productId
                      )
                    }
                    disabled={isProcessing}
                  >
                    Reject
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default AdminProductApprovalsPage;
