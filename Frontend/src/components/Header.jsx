import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Menu, Search, ShoppingCart, User } from 'lucide-react';
import { useState } from 'react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { label: 'Home', to: '/' },
  { label: 'Shop', to: '/shop' },
  { label: 'Categories', to: '/categories' },
  { label: 'About', to: '/about' },
  { label: 'Contact', to: '/contact' },
];

function Header() {
  const { cartCount } = useCart();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const handleLogout = () => {
    logout();
  };

  const handleSearch = (event) => {
    event.preventDefault();
    if (search.trim()) {
      navigate(`/shop?search=${encodeURIComponent(search.trim())}`);
    }
  };

  return (
    <header className="topbar">
      <div className="container header-inner">
        <div className="brand-block">
          <span className="brand-mark">S</span>
          <div>
            <div className="brand-name">Sylva Technologies</div>
            <div className="brand-tagline">Empowering Your Digital Life</div>
          </div>
        </div>

        <form className="header-search" onSubmit={handleSearch}>
          <Search size={16} />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search laptops, routers, accessories..." />
        </form>

        <div className="header-actions">
          {user ? (
            <>
              <Link to="/profile" className="text-link icon-link">
                <User size={16} />
                {user.name?.split(' ')[0] || 'Profile'}
              </Link>
              {user.role === 'admin' && (
                <Link to="/admin" className="text-link">
                  Dashboard
                </Link>
              )}
              <button type="button" className="text-link" onClick={handleLogout}>
                Logout
              </button>
            </>
          ) : (
            <Link to="/login" className="text-link icon-link">
              <User size={16} />
              Login
            </Link>
          )}
          <Link to="/cart" className="cart-button icon-link">
            <ShoppingCart size={16} />
            Cart ({cartCount})
          </Link>
          <button className="mobile-menu" aria-label="Open menu">
            <Menu size={18} />
          </button>
        </div>
      </div>

      <nav className="main-nav">
        <div className="container nav-inner">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </header>
  );
}

export default Header;
