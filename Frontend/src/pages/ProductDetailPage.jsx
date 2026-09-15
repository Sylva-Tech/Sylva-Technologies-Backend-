import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchProductBySlug } from '../services/api';
import { useCart } from '../context/CartContext';

function ProductDetailPage() {
  const { slug } = useParams();
  const { addToCart } = useCart();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProduct = async () => {
      try {
        const data = await fetchProductBySlug(slug);
        setProduct(data);
      } catch (error) {
        console.error('Unable to fetch product details:', error);
      } finally {
        setLoading(false);
      }
    };

    loadProduct();
  }, [slug]);

  if (loading) return <section className="container section-block"><p>Loading product...</p></section>;
  if (!product) return <section className="container section-block"><p>Product not found.</p></section>;

  return (
    <section className="container section-block product-detail-page">
      <div className="detail-grid">
        <div className="detail-gallery">
          <div className="detail-image">{product.brand || 'Product'}</div>
        </div>

        <div className="detail-content">
          <span className="product-brand">{product.brand}</span>
          <h1>{product.name}</h1>
          <div className="price-row detail-price">
            <strong>KSh {Number(product.price).toLocaleString()}</strong>
            {Number(product.oldPrice || 0) > Number(product.price || 0) && (
              <span>KSh {Number(product.oldPrice).toLocaleString()}</span>
            )}
          </div>
          <p>{product.description}</p>
          <p className="detail-help">A practical choice for {product.subcategory?.toLowerCase() || 'daily technology needs'}, with the key specifications below to help you decide.</p>
          <ul className="detail-meta">
            <li>SKU: {product.sku}</li>
            <li>Stock: {product.stock > 0 ? `${product.stock} available` : 'Out of stock'}</li>
            <li>Condition: {product.condition}</li>
          </ul>

          {product.specifications && (
            <div className="specifications">
              <h2>Specifications</h2>
              <dl>
                {Object.entries(product.specifications).map(([key, value]) => (
                  <div key={key}><dt>{key.replace(/([A-Z])/g, ' $1')}</dt><dd>{value}</dd></div>
                ))}
              </dl>
            </div>
          )}

          <div className="detail-actions">
            <button className="primary-btn" onClick={() => addToCart(product)}>
              Add to Cart
            </button>
            <button className="secondary-btn">Order via WhatsApp</button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default ProductDetailPage;
