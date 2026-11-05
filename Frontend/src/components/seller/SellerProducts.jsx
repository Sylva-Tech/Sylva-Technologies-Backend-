import { useMemo, useState } from 'react';
import {
  Edit3,
  Eye,
  Package,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';

import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';

import './SellerProducts.css';

function SellerProducts() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const sellerStatus = user?.sellerStatus || 'pending';

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  // Temporary frontend products.
  // These will later come from the backend.
  const [products] = useState([]);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const matchesSearch =
        product.name
          ?.toLowerCase()
          .includes(searchTerm.toLowerCase()) ||
        product.category
          ?.toLowerCase()
          .includes(searchTerm.toLowerCase());

      const matchesCategory =
        categoryFilter === 'all' ||
        product.category === categoryFilter;

      return matchesSearch && matchesCategory;
    });
  }, [products, searchTerm, categoryFilter]);

  const canAddProducts = sellerStatus === 'approved';

  const handleAddProduct = () => {
    if (!canAddProducts) {
      return;
    }

    navigate('/seller/products/new');
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

          <option value="Computers">
            Computers
          </option>

          <option value="Accessories">
            Accessories
          </option>

          <option value="Networking">
            Networking
          </option>

          <option value="Components">
            Components
          </option>

          <option value="Speakers">
            Speakers
          </option>
        </select>

      </div>

      {/* PRODUCT TABLE */}
      {filteredProducts.length > 0 ? (
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

                {filteredProducts.map((product) => (
                  <tr key={product._id}>

                    <td>
                      <div className="seller-product-name">

                        <div className="seller-product-image">
                          {product.image ? (
                            <img
                              src={product.image}
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
                            {product.sku || 'No SKU'}
                          </span>
                        </div>

                      </div>
                    </td>

                    <td>
                      {product.category}
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
                      <span className="seller-product-status">
                        {product.status || 'Active'}
                      </span>
                    </td>

                    <td>
                      <div className="seller-product-actions">

                        <button
                          type="button"
                          title="View product"
                        >
                          <Eye size={16} />
                        </button>

                        <button
                          type="button"
                          title="Edit product"
                        >
                          <Edit3 size={16} />
                        </button>

                        <button
                          type="button"
                          title="Delete product"
                          className="seller-product-delete"
                        >
                          <Trash2 size={16} />
                        </button>

                      </div>
                    </td>

                  </tr>
                ))}

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
            No products yet
          </h3>

          <p>
            Your products will appear here after
            you add them to your store.
          </p>

          {canAddProducts ? (
            <button
              type="button"
              className="seller-products-empty-button"
              onClick={handleAddProduct}
            >
              <Plus size={17} />
              Add Your First Product
            </button>
          ) : (
            <span className="seller-products-empty-note">
              Product uploads will be enabled after
              seller approval.
            </span>
          )}

        </div>
      )}

    </section>
  );
}

export default SellerProducts;
