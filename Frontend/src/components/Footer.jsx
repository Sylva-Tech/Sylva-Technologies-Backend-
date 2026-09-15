import { Link } from 'react-router-dom';

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
            <li>Bihi Towers, Moi Avenue</li>
            <li>sylvatechnologies@outlook.com</li>
            <li>0700 932 014</li>
          </ul>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
