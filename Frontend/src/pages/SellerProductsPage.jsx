import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Edit3,
  Eye,
  Package,
  Plus,
  Search,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';

import './SellerProducts.css';

function SellerProducts({ onAddProduct, onEditProduct }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const sellerStatus = user?.sellerStatus || 'pending';

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const canAddProducts = sellerStatus === 'approved';

  /*
   * Load the seller's products from MongoDB.
   */
  const loadProducts = useCallback(async () => {
    if (!user) {
      setProducts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await api.get('/products/seller/me');

      const data = response?.data ?? response;

      /*
       * Support the common response shapes used by the backend.
       */
      const productList =
        data?.products ||
        data?.data?.products ||
        data?.data ||
        [];

      setProducts(
        Array.isArray(productList)
          ? productList
          : []
      );
    } catch (err) {
      console.error(
        'Failed to load seller products:',
        err
      );

      const message =
        err?.response?.data?.message ||
        'Unable to load your products. Please try again.';

      setError(message);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  /*
   * Build category options from the actual products.
   */
  const categories = useMemo(() => {
    const categoryNames = products
      .map((product) => {
        if (
          typeof product.category === 'object' &&
          product.category !== null
        ) {
          return (
            product.category.name ||
            product.category.title ||
            ''
          );
        }

        return product.category || '';
      })
      .filter(Boolean);

    return [...new Set(categoryNames)].sort();
  }, [products]);

  /*
   * Filter products locally for a fast dashboard experience.
   */
  const filteredProducts = useMemo(() => {
    const search = searchTerm
      .trim()
      .toLowerCase();

    return products.filter((product) => {
      const category =
        typeof product.category === 'object' &&
        product.category !== null
          ? product.category.name ||
            product.category.title ||
            ''
          : product.category || '';

      const matchesSearch =
        !search ||
        product.name
          ?.toLowerCase()
          .includes(search) ||
        product.sku
          ?.toLowerCase()
          .includes(search) ||
        product.brand
          ?.toLowerCase()
          .includes(search) ||
        category
          ?.toLowerCase()
          .includes(search);

      const matchesCategory =
        categoryFilter === 'all' ||
        category === categoryFilter;

      return matchesSearch && matchesCategory;
    });
  }, [
    products,
    searchTerm,
    categoryFilter,
  ]);

  /*
   * Open the seller product creation page.
   *
   * The parent callback is still supported in case the
   * seller dashboard uses it for another purpose.
   */
  const handleAddProduct = () => {
    if (!canAddProducts) return;

    if (typeof onAddProduct === 'function') {
      onAddProduct();
      return;
    }

    navigate('/seller/products/new');
  };

  const handleViewProduct = (product) => {
    if (!product?._id) return;

    /*
     * Open the public product page when a slug exists.
     */
    if (product.slug) {
      window.open(
        `/product/${product.slug}`,
        '_blank',
        'noopener,noreferrer'
      );
      return;
    }

    window.open(
      `/product/${product._id}`,
      '_blank',
      'noopener,noreferrer'
    );
  };

  const handleEditProduct = (product) => {
    if (!product?._id) return;

    if (typeof onEditProduct === 'function') {
      onEditProduct(product);
      return;
    }

    window.dispatchEvent(
      new CustomEvent('seller-edit-product', {
        detail: product,
      })
    );
  };

  const handleDeleteProduct = async (product) => {
    if (!product?._id) return;

    const confirmed = window.confirm(
      `Delete "${product.name}"?\n\nThis action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      setError('');

      await api.delete(
        `/products/seller/${product._id}`
      );

      /*
       * Remove the deleted product immediately from
       * the dashboard without requiring a full refresh.
       */
      setProducts((currentProducts) =>
        currentProducts.filter(
          (item) =>
            item._id !== product._id
        )
      );
    } catch (err) {
      console.error(
        'Failed to delete seller product:',
        err
      );

      setError(
        err?.response?.data?.message ||
          'Unable to delete this product. Please try again.'
      );
    }
  };

  const getCategoryName = (product) => {
    if (
      typeof product.category === 'object' &&
      product.category !== null
    ) {
      return (
        product.category.name ||
        product.category.title ||
        'Uncategorized'
      );
    }

    return product.category || 'Uncategorized';
  };

  const getProductImage = (product) => {
    if (
      Array.isArray(product.images) &&
      product.images.length > 0
    ) {
      return product.images[0];
    }

    return product.image || '';
  };

  const getProductStatus = (product) => {
    /*
     * Show approval status before the general active/inactive
     * status so sellers can clearly see products waiting
     * for admin review.
     */
    if (
      product.approvalStatus === 'pending'
    ) {
      return 'Pending Approval';
    }

    if (
      product.approvalStatus === 'rejected'
    ) {
      return 'Rejected';
    }

    if (product.isActive === false) {
      return 'Inactive';
    }

    if (Number(product.stock || 0) <= 0) {
      return 'Out of Stock';
    }

    return 'Active';
  };

  return (
    <section className="seller-products">

      {/* HEADER */}
      <div className="seller-products-header">

        <div>
          <span className="seller-products-eyebrow">
            PRODUCT CATALOGUE
          </span>

          <h2>Products</h2>

          <p>
            Manage the products available in your
            Sylva Technologies store.
          </p>
        </div>

        <button
          type="button"
          className={`seller-products-add-button ${
            !canAddProducts
              ? 'seller-products-add-disabled'
              : ''
          }`}
          disabled={!canAddProducts}
          onClick={handleAddProduct}
        >
          <Plus size={18} />
          Add Product
        </button>

      </div>

      {/* APPROVAL NOTICE */}
      {!canAddProducts && (
        <div
          className={`seller-products-notice ${
            sellerStatus === 'rejected'
              ? 'seller-products-notice-rejected'
              : ''
          }`}
        >
          <div className="seller-products-notice-icon">
            <Package size={20} />
          </div>

          <div>
            <strong>
              {sellerStatus === 'rejected'
                ? 'Seller approval requires attention'
                : 'Your seller account is under review'}
            </strong>

            <p>
              {sellerStatus === 'rejected'
                ? 'Product uploads will become available after your seller application is reviewed and approved.'
                : 'You can prepare your store while we review your seller information. Product uploads will become available after approval.'}
            </p>
          </div>
        </div>
      )}

      {/* ERROR */}
      {error && (
        <div className="seller-products-notice seller-products-notice-rejected">
          <div className="seller-products-notice-icon">
            <Package size={20} />
          </div>

          <div>
            <strong>
              Product request failed
            </strong>

            <p>{error}</p>
          </div>

          <button
            type="button"
            onClick={loadProducts}
            title="Retry"
          >
            <RefreshCw size={17} />
          </button>
        </div>
      )}

      {/* TOOLBAR */}
      <div className="seller-products-toolbar">

        <div className="seller-products-search">
          <Search size={18} />

          <input
            type="search"
            placeholder="Search products..."
            value={searchTerm}
            onChange={(event) =>
              setSearchTerm(event.target.value)
            }
          />
        </div>

        <select
          value={categoryFilter}
          onChange={(event) =>
            setCategoryFilter(event.target.value)
          }
          className="seller-products-category-filter"
        >
          <option value="all">
            All Categories
          </option>

          {categories.map((category) => (
            <option
              key={category}
              value={category}
            >
              {category}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="seller-products-refresh"
          onClick={loadProducts}
          disabled={loading}
          title="Refresh products"
        >
          <RefreshCw
            size={17}
            className={
              loading
                ? 'seller-products-refresh-spinning'
                : ''
            }
          />
        </button>

      </div>

      {/* LOADING */}
      {loading ? (
        <div className="seller-products-empty">

          <div className="seller-products-empty-icon">
            <RefreshCw
              size={32}
              className="seller-products-refresh-spinning"
            />
          </div>

          <h3>
            Loading your products...
          </h3>

          <p>
            Please wait while we retrieve your
            product catalogue.
          </p>

        </div>
      ) : filteredProducts.length > 0 ? (

        /* PRODUCT TABLE */
        <div className="seller-products-table-card">

          <div className="seller-products-table-wrapper">

            <table className="seller-products-table">

              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>

                {filteredProducts.map((product) => {

                  const category =
                    getCategoryName(product);

                  const image =
                    getProductImage(product);

                  const status =
                    getProductStatus(product);

                  return (
                    <tr key={product._id}>

                      <td>
                        <div className="seller-product-name">

                          <div className="seller-product-image">
                            {image ? (
                              <img
                                src={image}
                                alt={product.name}
                              />
                            ) : (
                              <Package size={22} />
                            )}
                          </div>

                          <div>
                            <strong>
                              {product.name}
                            </strong>

                            <span>
                              {product.sku ||
                                'No SKU'}
                            </span>
                          </div>

                        </div>
                      </td>

                      <td>
                        {category}
                      </td>

                      <td>
                        KSh{' '}
                        {Number(
                          product.price || 0
                        ).toLocaleString('en-KE')}
                      </td>

                      <td>
                        {product.stock ?? 0}
                      </td>

                      <td>
                        <span
                          className={`seller-product-status ${
                            status === 'Out of Stock'
                              ? 'seller-product-status-out'
                              : status === 'Inactive' ||
                                status === 'Rejected'
                                ? 'seller-product-status-inactive'
                                : ''
                          }`}
                        >
                          {status}
                        </span>
                      </td>

                      <td>
                        <div className="seller-product-actions">

                          <button
                            type="button"
                            title="View product"
                            onClick={() =>
                              handleViewProduct(product)
                            }
                          >
                            <Eye size={16} />
                          </button>

                          <button
                            type="button"
                            title="Edit product"
                            onClick={() =>
                              handleEditProduct(product)
                            }
                          >
                            <Edit3 size={16} />
                          </button>

                          <button
                            type="button"
                            title="Delete product"
                            className="seller-product-delete"
                            onClick={() =>
                              handleDeleteProduct(product)
                            }
                          >
                            <Trash2 size={16} />
                          </button>

                        </div>
                      </td>

                    </tr>
                  );
                })}

              </tbody>

            </table>

          </div>

        </div>

      ) : (

        /* EMPTY STATE */
        <div className="seller-products-empty">

          <div className="seller-products-empty-icon">
            <Package size={32} />
          </div>

          <h3>
            {searchTerm ||
            categoryFilter !== 'all'
              ? 'No matching products'
              : 'No products yet'}
          </h3>

          <p>
            {searchTerm ||
            categoryFilter !== 'all'
              ? 'Try changing your search or category filter.'
              : 'Your products will appear here after you add them to your store.'}
          </p>

          {!searchTerm &&
          categoryFilter === 'all' &&
          canAddProducts ? (
            <button
              type="button"
              className="seller-products-empty-button"
              onClick={handleAddProduct}
            >
              <Plus size={17} />
              Add Your First Product
            </button>
          ) : !searchTerm &&
            categoryFilter === 'all' ? (
            <span className="seller-products-empty-note">
              Product uploads will be enabled after
              seller approval.
            </span>
          ) : null}

        </div>
      )}

    </section>
  );
}

export default SellerProducts;