import { Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';

const brandImageFallbacks = {
  Dell: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=900&q=80',
  Lenovo: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=900&q=80',
  HP: 'https://images.unsplash.com/photo-1541807084-5c52b6b3adef?auto=format&fit=crop&w=900&q=80',
  Logitech: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=900&q=80',
  JBL: 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=900&q=80',
  'TP-Link': 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=80',
  Cisco: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80',
  NVIDIA: 'https://images.unsplash.com/photo-1591488320449-011701bb6704?auto=format&fit=crop&w=900&q=80',
  AMD: 'https://images.unsplash.com/photo-1555618566-8b4f7f9eb0a6?auto=format&fit=crop&w=900&q=80',
  Intel: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=80',
  Default: 'https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2?auto=format&fit=crop&w=900&q=80',
};

function ProductCard({ product }) {
  const { addToCart } = useCart();

  if (!product) {
    return null;
  }

  const brandName = product.brand || 'Sylva';
  const storedImage = Array.isArray(product.images) && product.images.length > 0 ? product.images[0] : '';
  const imageUrl = storedImage && !storedImage.includes('...')
    ? storedImage
    : brandImageFallbacks[brandName] || brandImageFallbacks.Default;

  const hasDiscount = Number(product.oldPrice || 0) > Number(product.price || 0);
  const discountPercent = hasDiscount
    ? Math.round(((Number(product.oldPrice) - Number(product.price)) / Number(product.oldPrice)) * 100)
    : Number(product.discount || 0);

  const whatsappText = encodeURIComponent(
    `Hello Sylva Technologies, I am interested in ${product.name} for KSh ${Number(product.price || 0).toLocaleString()}. Please share availability.`
  );
  const shortDescription = product.shortDescription || product.description || 'Quality technology, ready for your setup.';
  const stockLabel = Number(product.stock || 0) > 0 ? 'In Stock' : 'Out of Stock';

  return (
    <article className="product-card">
      <div className="product-image-wrap">
        {discountPercent > 0 && <span className="product-badge">{discountPercent}% OFF</span>}
        <img src={imageUrl} alt={product.name} className="product-image" />
      </div>

      <div className="product-info">
        <span className="product-brand">{brandName}</span>
        <h3 className="product-title">{product.name}</h3>
        <p className="product-description">{shortDescription}</p>

        <div className="price-row">
          <strong>KSh {Number(product.price || 0).toLocaleString()}</strong>
          {hasDiscount && <span>KSh {Number(product.oldPrice || 0).toLocaleString()}</span>}
        </div>
        <span className={`stock-status ${Number(product.stock || 0) > 0 ? 'in-stock' : 'out-of-stock'}`}>
          {Number(product.stock || 0) > 0 ? '✓' : '•'} {stockLabel}
        </span>

        <div className="product-actions">
          <button className="primary-btn small-btn" onClick={() => addToCart(product)} disabled={!Number(product.stock || 0)}>
            Add to Cart
          </button>
          <Link to={`/product/${product.slug}`} className="secondary-btn small-btn">View Details</Link>
          <a
            href={`https://wa.me/254700932014?text=${whatsappText}`}
            target="_blank"
            rel="noreferrer"
            className="secondary-btn small-btn whatsapp-btn"
          >
            WhatsApp
          </a>
        </div>
      </div>
    </article>
  );
}

export default ProductCard;
