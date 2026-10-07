import { Link } from 'react-router-dom';
import { Globe, Camera, BriefcaseBusiness, MessageCircle } from 'lucide-react';

const socialLinks = [
  { label: 'Facebook', href: 'https://www.facebook.com/', icon: Globe },
  { label: 'Instagram', href: 'https://www.instagram.com/', icon: Camera },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/', icon: BriefcaseBusiness },
  { label: 'WhatsApp', href: `https://wa.me/${import.meta.env.VITE_WHATSAPP_NUMBER || '254709932014'}`, icon: MessageCircle },
];

const whatsappNumber = import.meta.env.VITE_WHATSAPP_NUMBER || '254700932014';

const shopLinks = [
  'Laptops',
  'Desktops',
  'Accessories',
  'Networking',
  'Components',
  'Speakers & Audio',
  'Gaming',
  'All Products',
];

function PaymentLogo({ type }) {
  if (type === 'mpesa') {
    return <svg className="payment-logo payment-logo--mpesa" viewBox="0 0 86 28" role="img" aria-label="M-PESA"><rect width="86" height="28" rx="4" fill="#fff" /><text x="8" y="19" fontSize="15" fontWeight="800" fill="#1d9b54">M-PESA</text></svg>;
  }

  if (type === 'visa') {
    return <svg className="payment-logo" viewBox="0 0 70 28" role="img" aria-label="Visa"><rect width="70" height="28" rx="4" fill="#fff" /><text x="13" y="19" fontSize="17" fontStyle="italic" fontWeight="800" fill="#143f8f">VISA</text></svg>;
  }

  return <svg className="payment-logo" viewBox="0 0 92 28" role="img" aria-label="Mastercard"><rect width="92" height="28" rx="4" fill="#fff" /><circle cx="39" cy="14" r="8" fill="#eb001b" /><circle cx="51" cy="14" r="8" fill="#f79e1b" fillOpacity=".95" /><text x="9" y="25" fontSize="5.5" fontWeight="700" fill="#555">mastercard</text></svg>;
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-section footer-brand">
          <h3>Sylva Technologies</h3>
          <p>Empowering Your Digital Life</p>
          <span className="footer-description">
            Quality technology products and practical support for homes, businesses, schools and growing teams across Kenya.
          </span>
        </div>

        <div className="footer-section">
          <h4>Shop</h4>
          <ul>
            {shopLinks.map((label) => (
              <li key={label}><Link to="/shop">{label}</Link></li>
            ))}
          </ul>
        </div>

        <div className="footer-section">
          <h4>Customer Service</h4>
          <ul>
            <li><Link to="/contact">Contact Us</Link></li>
            <li><Link to="/profile">My Account</Link></li>
            <li><Link to="/profile">My Orders</Link></li>
            <li><Link to="/about">Delivery Information</Link></li>
            <li><Link to="/terms">Returns &amp; Refunds</Link></li>
            <li><Link to="/about">FAQs</Link></li>
            <li><Link to="/contact">Support</Link></li>
          </ul>
        </div>

        <div className="footer-section">
          <h4>Company</h4>
          <ul>
            <li><Link to="/about">About Us</Link></li>
            <li><Link to="/privacy">Privacy Policy</Link></li>
            <li><Link to="/terms">Terms &amp; Conditions</Link></li>
            <li><Link to="/about">Cookie Policy</Link></li>
            <li><Link to="/about">Careers</Link></li>
          </ul>
        </div>

        <div className="footer-section">
          <h4>Contact</h4>
          <ul>
            <li><a href="tel:+254709932014">+254 700932 014</a></li>
            <li><a href="mailto:sylvatechnologies@outlook.com">sylvatechnologies@outlook.com</a></li>
            <li><a href={`https://wa.me/${whatsappNumber}`} target="_blank" rel="noreferrer">WhatsApp Us</a></li>
          </ul>
          <div className="social-links" aria-label="Social media links">
            {socialLinks.map(({ label, href, icon: Icon }) => (
              <a key={label} href={href} target="_blank" rel="noreferrer" aria-label={label} title={label}>
                <Icon size={17} />
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="payment-strip" aria-label="Accepted payment methods">
        <span>Secure ways to pay</span>
        <PaymentLogo type="mpesa" />
        <PaymentLogo type="visa" />
      </div>

      <div className="footer-bottom">
        <div className="container footer-bottom-inner">
          <span>© {new Date().getFullYear()} Sylva Technologies. All rights reserved.</span>
          <div className="footer-bottom-links">

            <Link to="/privacy">Privacy</Link>

            <Link to="/terms">Terms</Link>
            
            <Link to="/about">Returns</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
