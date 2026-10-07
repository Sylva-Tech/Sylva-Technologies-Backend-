import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import ProductCard from '../components/ProductCard';
import { fetchProductBySlug, fetchProducts } from '../services/api';
import { useCart } from '../context/CartContext';

function ProductDetailPage() {
  const { slug } = useParams();
  const { addToCart } = useCart();
  const [product, setProduct] = useState(null);
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [quantity, setQuantity] = useState(1);
  const [selectedImage, setSelectedImage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProduct = async () => {
      try {
        const data = await fetchProductBySlug(slug);
        setProduct(data);
        const related = await fetchProducts({ limit: 6, brand: data.brand });
        setRelatedProducts((related.products || []).filter((item) => item.slug !== data.slug).slice(0, 4));
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

  const images = product.images?.length ? product.images : ['https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2?auto=format&fit=crop&w=1200&q=80'];
  const hasDiscount = Number(product.oldPrice || 0) > Number(product.price || 0);
  const productUrl = `${window.location.origin}/product/${product.slug}`;
  const whatsappText = encodeURIComponent(`Hello Sylva Technologies, I would like to inquire about ${product.name}. Product: ${productUrl}`);

  return (
    <section className="container section-block product-detail-page">
      <div className="detail-grid">
        <div className="detail-gallery">
          <div className="detail-image"><img src={images[selectedImage]} alt={product.name} /></div>
          <div className="detail-thumbnails">{images.map((image, index) => <button type="button" key={image} className={index === selectedImage ? 'active' : ''} onClick={() => setSelectedImage(index)} aria-label={`View product image ${index + 1}`}><img src={image} alt="" /></button>)}</div>
        </div>

        <div className="detail-content">
          <span className="product-brand">{product.brand}</span>
          <h1>{product.name}</h1>
          <div className="price-row detail-price">
            <strong>KSh {Number(product.price).toLocaleString()}</strong>
            {hasDiscount && (
              <span>KSh {Number(product.oldPrice).toLocaleString()}</span>
            )}
          </div>
          {hasDiscount && <span className="detail-discount">{Math.round(((product.oldPrice - product.price) / product.oldPrice) * 100)}% OFF</span>}
          <p className="detail-description">{product.description}</p>
          <ul className="detail-meta">
            <li>SKU: {product.sku}</li>
            <li>Stock: {product.stock > 0 ? `${product.stock} available` : 'Out of stock'}</li>
            <li>Condition: {product.condition}</li>
            {product.warranty && <li>Warranty: {product.warranty}</li>}
          </ul>

          <div className="quantity-row">
            <span>Quantity</span>
            <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))}>-</button>
            <strong>{quantity}</strong>
            <button type="button" onClick={() => setQuantity((value) => Math.min(product.stock || value + 1, value + 1))}>+</button>
          </div>

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
            <button className="primary-btn" onClick={() => addToCart(product, quantity)} disabled={!Number(product.stock || 0)}>
              Add to Cart
            </button>
            <a className="whatsapp-order-btn" href={`https://wa.me/${import.meta.env.VITE_WHATSAPP_NUMBER || '254709932014'}?text=${whatsappText}`} target="_blank" rel="noreferrer">
              <MessageCircle size={17} /> Order via WhatsApp
            </a>
          </div>
          <div className="detail-payment-note">
            <span>Secure checkout available with</span>
            <strong className="paypal-wordmark">PayPal</strong>
            <span>and M-Pesa</span>
          </div>
        </div>
      </div>

      <div className="detail-lower-grid">
        <div className="detail-description-panel">
          <span className="eyebrow">Product Details</span>
          <h2>Description &amp; Specifications</h2>
          <p>{product.description}</p>
        </div>
        {relatedProducts.length > 0 && <div className="related-products">
          <div className="section-heading"><h2>You May Also Like</h2></div>
          <div className="product-grid related-grid">{relatedProducts.map((item) => <ProductCard key={item._id || item.slug} product={item} />)}</div>
        </div>}
      </div>
    </section>
  );
}

export default ProductDetailPage;
