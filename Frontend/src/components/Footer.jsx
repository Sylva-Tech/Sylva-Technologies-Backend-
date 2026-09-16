import { Link } from 'react-router-dom';
import { Globe, Camera, BriefcaseBusiness, MessageCircle, Smartphone, Wallet, CreditCard } from 'lucide-react';

const socialLinks = [
  { label: 'Facebook', href: 'https://www.facebook.com/', icon: Globe },
  { label: 'Instagram', href: 'https://www.instagram.com/', icon: Camera },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/', icon: BriefcaseBusiness },
  { label: 'WhatsApp', href: 'https://wa.me/254700932014', icon: MessageCircle },
];

function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <h3>Sylva Technologies</h3>
          <p>Empowering Your Digital Life</p>
        </div>

        <div>
          <h4>Quick Links</h4>
          <ul>
            <li><Link to="/">Home</Link></li>
            <li><Link to="/shop">Shop</Link></li>
            <li><Link to="/about">About</Link></li>
            <li><Link to="/contact">Contact</Link></li>
            <li><Link to="/privacy">Privacy Policy</Link></li>
            <li><Link to="/terms">Terms and Conditions</Link></li>
          </ul>
        </div>

        <div>
          <h4>Categories</h4>
          <ul>
            <li>Laptops</li>
            <li>Accessories</li>
            <li>Networking</li>
            <li>Components</li>
            <li>Audio</li>
          </ul>
        </div>

        <div>
          <h4>Contact</h4>
          <ul>
            <li>sylvatechnologies@outlook.com</li>
            <li>0700 932 014</li>
          </ul>
          <h4 className="footer-subheading">Connect with us</h4>
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
        <strong><Smartphone size={16} /> M-Pesa</strong>
        <strong><Wallet size={16} /> PayPal</strong>
        <strong><CreditCard size={16} /> Card</strong>
        <strong>COD</strong>
      </div>
      <div className="footer-copyright">© {new Date().getFullYear()} Sylva Technologies. All rights reserved.</div>
    </footer>
  );
}

export default Footer;
