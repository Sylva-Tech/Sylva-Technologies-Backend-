import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Menu,
  Search,
  ShoppingCart,
  User,
  X,
} from 'lucide-react';
import { Link, NavLink, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { fetchProducts } from '../services/api';

function Header() {
  const { cartCount } = useCart();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const searchRef = useRef(null);
  const mobileMenuRef = useRef(null);
  const accountMenuRef = useRef(null);

  useEffect(() => {
    const trimmedSearch = search.trim();

    if (trimmedSearch.length < 2) {
      setSuggestions([]);
      return undefined;
    }

    const timeout = setTimeout(async () => {
      try {
        const products = await fetchProducts({
          search: trimmedSearch,
          limit: 5,
        });

        setSuggestions((products.products || []).slice(0, 5));
      } catch {
        setSuggestions([]);
      }
    }, 250);

    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        searchRef.current &&
        !searchRef.current.contains(event.target)
      ) {
        setSuggestions([]);
      }

      if (
        menuOpen &&
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(event.target) &&
        !event.target.closest('.mobile-menu')
      ) {
        setMenuOpen(false);
      }

      if (
        accountOpen &&
        accountMenuRef.current &&
        !accountMenuRef.current.contains(event.target)
      ) {
        setAccountOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen, accountOpen]);

  const closeMobileMenu = () => {
    setMenuOpen(false);
  };

  const closeAccountMenu = () => {
    setAccountOpen(false);
  };

  const handleLogout = () => {
    logout();
    closeAccountMenu();
    closeMobileMenu();
  };

  const handleSearch = (event) => {
    event.preventDefault();

    const nextQuery = search.trim();

    if (!nextQuery) {
      navigate('/shop');
      closeMobileMenu();
      return;
    }

    navigate(`/shop?search=${encodeURIComponent(nextQuery)}`);
    setSuggestions([]);
    closeMobileMenu();
  };

  /*
   * IMPORTANT:
   * Cart is intentionally NOT included here.
   * It is rendered once separately in header-actions.
   */
 
const navItems = [
  { label: 'Home', to: '/' },
  { label: 'Support', to: '/support' },
];


  const accountLink = user ? '/profile' : '/login';

  const promoItems = [
    { label: 'Free Delivery on Selected Orders', to: null },
    { label: 'Quality IT Products', to: null },
    { label: 'Trusted Support', to: null },
    { label: 'Secure Payments', to: null },
    { label: 'Sell on Sylva', to: '/sell-on-sylva' },
  ];

  /*
   * Account button opens the dropdown instead of
   * automatically navigating to /profile.
   */
  const handleAccountClick = () => {
    setAccountOpen((value) => !value);
  };

  return (
    <header className="topbar-shell">
      {/* =====================================================
          TOP PROMO BAR
      ====================================================== */}
      <div
        className="topbar-promo"
        role="region"
        aria-label="Store announcements"
      >
        <div className="container promo-inner">
          <div className="promo-track" aria-live="polite">
            {promoItems.map((item, index) => (
              <span
                key={`${item.label}-${index}`}
                className="promo-item-wrap"
              >
                {item.to ? (
                  <Link
                    to={item.to}
                    className="promo-item promo-link"
                    onClick={() => {
                      closeAccountMenu();
                      closeMobileMenu();
                    }}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span className="promo-item">
                    {item.label}
                  </span>
                )}

                {index < promoItems.length - 1 && (
                  <span
                    className="promo-separator"
                    aria-hidden="true"
                  >
                    |
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* =====================================================
          MAIN HEADER
      ====================================================== */}
      <div className="header-main">
        <div className="container header-inner">
          {/* =================================================
              BRAND
          ================================================== */}
          <Link
            to="/"
            className="brand-block"
            aria-label="Sylva Technologies homepage"
            onClick={() => {
              closeMobileMenu();
              closeAccountMenu();
            }}
          >
            <span className="brand-mark">S</span>

            <span className="brand-copy">
              <span className="brand-name">
                Sylva Technologies
              </span>

              <span className="brand-tagline">
                Empowering Your Digital Life
              </span>
            </span>
          </Link>

          {/* =================================================
              SEARCH
          ================================================== */}
          <div className="header-tools" ref={searchRef}>
            <form
              className="header-search"
              onSubmit={handleSearch}
            >
              <Search size={17} />

              <input
                type="search"
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder="Search laptops, routers, accessories..."
                aria-label="Search products"
              />

              {search && (
                <button
                  type="button"
                  className="search-clear"
                  aria-label="Clear search"
                  onClick={() => {
                    setSearch('');
                    setSuggestions([]);
                  }}
                >
                  <X size={15} />
                </button>
              )}
            </form>

            {suggestions.length > 0 && (
              <div className="search-suggestions">
                {suggestions.map((product) => (
                  <button
                    key={product._id || product.slug}
                    type="button"
                    className="suggestion-item"
                    onClick={() => {
                      setSearch(product.name);
                      navigate(`/product/${product.slug}`);
                      setSuggestions([]);
                      closeMobileMenu();
                      closeAccountMenu();
                    }}
                  >
                    <span>{product.name}</span>
                    <small>{product.brand}</small>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* =================================================
              DESKTOP NAVIGATION
              
              Cart has been REMOVED from navItems.
              It is displayed only once in header-actions.
          ================================================== */}
          <nav
            className="header-nav desktop-nav"
            aria-label="Main navigation"
          >
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  isActive
                    ? 'nav-link active'
                    : 'nav-link'
                }
                onClick={() => {
                  closeMobileMenu();
                  closeAccountMenu();
                }}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* =================================================
              HEADER ACTIONS
          ================================================== */}
          <div className="header-actions">
            {/* =================================================
                ACCOUNT
            ================================================== */}
            <div
              className="account-menu-wrap"
              ref={accountMenuRef}
            >
              <button
                type="button"
                className="account-menu-trigger"
                onClick={handleAccountClick}
                aria-expanded={accountOpen}
                aria-haspopup="menu"
              >
                <User size={16} />

                <span className="account-label">
                  {user
                    ? user.name?.split(' ')[0] || 'My Account'
                    : 'My Account'}
                </span>

                <ChevronDown size={14} />
              </button>

              {accountOpen && (
                <div className="account-menu" role="menu">
                  {!user ? (
                    <>
                      <Link
                        to="/login"
                        onClick={closeAccountMenu}
                      >
                        Sign In
                      </Link>

                      <Link
                        to="/register"
                        onClick={closeAccountMenu}
                      >
                        Register
                      </Link>
                    </>
                  ) : (
                    <>
                      <Link
                        to="/profile"
                        onClick={closeAccountMenu}
                      >
                        My Account
                      </Link>

                      <Link
                        to="/profile"
                        onClick={closeAccountMenu}
                      >
                        My Orders
                      </Link>

                      <Link
                        to="/profile"
                        onClick={closeAccountMenu}
                      >
                        Wishlist
                      </Link>

                      <Link
                        to="/profile"
                        onClick={closeAccountMenu}
                      >
                        Profile
                      </Link>

                      {/* ADMIN ONLY */}
                      {user.role === 'admin' && (
                        <Link
                          to="/admin"
                          onClick={closeAccountMenu}
                        >
                          Admin Dashboard
                        </Link>
                      )}

                      <button
                        type="button"
                        className="menu-logout"
                        onClick={handleLogout}
                      >
                        Logout
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* =================================================
                CART — ONLY ONE DESKTOP CART
            ================================================== */}
            <Link
              to="/cart"
              className="cart-button icon-link"
              aria-label={`View cart with ${cartCount} items`}
              onClick={() => {
                closeMobileMenu();
                closeAccountMenu();
              }}
            >
              <ShoppingCart size={17} />

              <span className="cart-text">
                Cart
              </span>

              <span className="cart-count">
                ({cartCount})
              </span>
            </Link>

            {/* =================================================
                MOBILE MENU BUTTON
            ================================================== */}
            <button
              type="button"
              className="mobile-menu"
              aria-label={
                menuOpen
                  ? 'Close navigation menu'
                  : 'Open navigation menu'
              }
              aria-expanded={menuOpen}
              onClick={() => {
                setMenuOpen((value) => !value);
                closeAccountMenu();
              }}
            >
              {menuOpen ? (
                <X size={19} />
              ) : (
                <Menu size={19} />
              )}
            </button>
          </div>
        </div>

        {/* =====================================================
            MOBILE NAVIGATION
        ====================================================== */}
        {menuOpen && (
          <div
            className="mobile-nav-panel"
            aria-label="Mobile navigation"
            ref={mobileMenuRef}
          >
            <NavLink
              to="/"
              className={({ isActive }) =>
                isActive
                  ? 'mobile-nav-link active'
                  : 'mobile-nav-link'
              }
              onClick={closeMobileMenu}
            >
              Home
            </NavLink>

            <NavLink
              to="/categories"
              className={({ isActive }) =>
                isActive
                  ? 'mobile-nav-link active'
                  : 'mobile-nav-link'
              }
              onClick={closeMobileMenu}
            >
              Categories
            </NavLink>

            <NavLink
              to="/support"
              className={({ isActive }) =>
                isActive
                  ? 'mobile-nav-link active'
                  : 'mobile-nav-link'
              }
              onClick={closeMobileMenu}
            >
              Support
            </NavLink>

            <Link
              to={accountLink}
              className="mobile-nav-link"
              onClick={closeMobileMenu}
            >
              My Account
            </Link>

            <Link
              to="/cart"
              className="mobile-nav-link"
              onClick={closeMobileMenu}
            >
              Cart ({cartCount})
            </Link>

            <Link
              to="/sell-on-sylva"
              className="mobile-nav-link"
              onClick={closeMobileMenu}
            >
              Sell on Sylva
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}

export default Header;
