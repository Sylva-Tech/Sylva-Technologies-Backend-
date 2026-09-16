import { Link } from 'react-router-dom';
import { ArrowRight, Flame } from 'lucide-react';

const fallbackImages = {
  Dell: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=700&q=80',
  HP: 'https://images.unsplash.com/photo-1541807084-5c52b6b3adef?auto=format&fit=crop&w=700&q=80',
  Lenovo: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=700&q=80',
  JBL: 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=700&q=80',
  'TP-Link': 'https://images.unsplash.com/photo-1606904825846-647eb07f5be2?auto=format&fit=crop&w=700&q=80',
  Crucial: 'https://images.unsplash.com/photo-1562976540-1502c2145186?auto=format&fit=crop&w=700&q=80',
  Logitech: 'https://images.unsplash.com/photo-1527814050087-3793815479db?auto=format&fit=crop&w=700&q=80',
  Default: 'https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2?auto=format&fit=crop&w=700&q=80',
};

const isActiveOffer = (product) => {
  const now = Date.now();
  const starts = product.offerStartDate ? new Date(product.offerStartDate).getTime() : 0;
  const ends = product.offerEndDate ? new Date(product.offerEndDate).getTime() : Infinity;
  return starts <= now && now < ends;
};

function OfferCard({ product }) {
  const oldPrice = Number(product.oldPrice || 0);
  const price = Number(product.price || 0);
  const discount = oldPrice > price ? Math.round(((oldPrice - price) / oldPrice) * 100) : Number(product.discount || 0);
  const storedImage = product.images?.[0] || '';
  const image = storedImage && !storedImage.includes('...') ? storedImage : fallbackImages[product.brand] || fallbackImages.Default;
  const message = product.offerMessage || product.shortDescription || 'Quality technology at an exceptional price.';

  return <article className="live-offer-card">
    <div className="live-offer-card__image"><img src={image} alt={product.name} /></div>
    <div className="live-offer-card__content">
      <span className="product-brand">{product.brand || 'Sylva'}</span>
      <h3>{product.name}</h3>
      <p>{message}</p>
      <div className="live-offer-price"><strong>KSh {price.toLocaleString()}</strong>{oldPrice > price && <span>Was KSh {oldPrice.toLocaleString()}</span>}</div>
      {discount > 0 && <b className="live-offer-discount"><Flame size={13} /> {discount}% OFF</b>}
      <Link to={`/product/${product.slug}`} className="live-offer-link">Shop now <ArrowRight size={14} /></Link>
    </div>
  </article>;
}

function LiveOfferBanner({ products = [] }) {
  const offers = products.filter((product) => product.stock > 0 && (product.flashSale || product.featured || product.offer || Number(product.discount || 0) > 0) && isActiveOffer(product));
  if (!offers.length) return null;
  const loopProducts = [...offers, ...offers];

  return <section className="live-offer-banner" aria-label="Live product offers">
    <div className="live-offer-banner__header"><span className="live-offer-label"><i /> <Flame size={15} /> Live Deals</span><span>Current offers from Sylva Technologies</span></div>
    <div className="live-offer-window"><div className="live-offer-track">{loopProducts.map((product, index) => <OfferCard key={`${product._id || product.slug}-${index}`} product={product} />)}</div></div>
  </section>;
}

export default LiveOfferBanner;
