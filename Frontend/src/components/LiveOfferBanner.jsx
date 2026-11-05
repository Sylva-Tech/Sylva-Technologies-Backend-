import { Link } from 'react-router-dom';

const fallbackTickerMessages = [
  { label: 'LIVE OFFER', text: 'Upgrade Your Tech Today - Quality Laptops, Desktops & Accessories', href: '/shop' },
  { label: 'FREE DELIVERY', text: 'Across Kenya on Selected Orders', href: '/shop' },
  { label: 'HOT DEALS', text: 'Up to 20% OFF Laptops & Accessories', href: '/deals' },
];

function LiveOfferBanner({ ads = [] }) {
  const messages = ads.length > 0
    ? ads.map((ad) => ({
        label: ad.title || 'LIVE OFFER',
        text: ad.message || 'Explore the latest deals from Sylva Technologies.',
        href: ad.link || '/shop',
      }))
    : fallbackTickerMessages;

  const loopMessages = [...messages, ...messages];

  return (
    <section className="live-offer-banner" aria-label="Live flash orders">
      <div className="live-offer-window">
        <div className="live-offer-track">
          {loopMessages.map((message, index) => (
            <div className="live-ticker-item" key={`${message.label}-${index}`}>
              <span className="live-ticker-copy">
                <strong>{message.label}</strong>
                <span>{message.text}</span>
              </span>
              <Link to={message.href} className="live-ticker-cta">
                Shop Now →
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default LiveOfferBanner;
