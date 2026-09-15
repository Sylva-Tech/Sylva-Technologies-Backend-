import { Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';

function ProductCard({ product }) {
  const { addToCart } = useCart();

  if (!product) {
    return null;
  }

  const hasDiscount = Number(product.oldPrice || 0) > Number(product.price || 0);
  const discountPercent = hasDiscount
    ? Math.round(((Number(product.oldPrice) - Number(product.price)) / Number(product.oldPrice)) * 100)
    : 0;

  return (
    <article className="product-card">
      {discountPercent > 0 && <div className="product-badge">{discountPercent}% OFF</div>}
      <div className="product-image placeholder-image">
        {product.brand || 'Product'}
      </div>

      <div className="product-info">
        <span className="product-brand">{product.brand || 'Sylva'}</span>
        <h3>{product.name}</h3>
        <p>{product.shortDescription || product.description}</p>
        <div className="product-spec-line">
          {product.specifications?.processor || product.specifications?.connectivity || product.specifications?.capacity || 'Ready for everyday use'}
        </div>

        <div className="price-row">
          <strong>KSh {Number(product.price || 0).toLocaleString()}</strong>
          {hasDiscount && <span>KSh {Number(product.oldPrice || 0).toLocaleString()}</span>}
        </div>

        <div className="product-actions">
          <button className="primary-btn small-btn" onClick={() => addToCart(product)}>
            Add to Cart
          </button>
          <Link to={`/product/${product.slug}`} className="secondary-btn small-btn link-button">
            View Details
          </Link>
        </div>
      </div>
    </article>
  );
}

export default ProductCard;
