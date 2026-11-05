import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Headphones,
  Laptop,
  Monitor,
  Package,
  Router,
  ShieldCheck,
  ShoppingBag,
  Truck,
  Volume2,
} from 'lucide-react';

import ProductCard from '../components/ProductCard';

import {
  fetchAdvertisements,
  fetchCategories,
  fetchProducts,
} from '../services/api';

// Namespace import so the page still loads before
// fetchFlipAdvertisements has been added to services/api.js.
import * as apiModule from '../services/api';

/* =========================================================
   FALLBACK HERO SLIDES
========================================================= */

const heroSlides = [
  {
    id: 'fallback-t480',
    title: 'Lenovo ThinkPad T480',
    subtitle:
      'Power and reliability for work, study and everyday business needs.',
    image:
      'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=1400&q=90',
    link: '/shop',
    buttonText: 'Shop Now',
    badge: 'LIMITED OFFER',
    price: 'KSh 30,000',
    offerTag: 'KSh 30,000',
  },
  {
    id: 'fallback-laptops',
    title: 'Premium Laptops',
    subtitle:
      'Work, study and create with dependable devices built for modern life.',
    image:
      'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=1400&q=90',
    link: '/shop',
    buttonText: 'Shop Now',
    badge: 'FEATURED',
    price: '',
    offerTag: 'HOT OFFER',
  },
  {
    id: 'fallback-workspace',
    title: 'Upgrade Your Workspace',
    subtitle:
      'Reliable desktops, accessories and productivity gear for every task.',
    image:
      'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=1400&q=90',
    link: '/shop',
    buttonText: 'Shop Now',
    badge: 'FEATURED',
    price: '',
    offerTag: 'HOT OFFER',
  },
  {
    id: 'fallback-networking',
    title: 'Stay Connected',
    subtitle:
      'Networking hardware that keeps your home, office and team moving.',
    image:
      'https://images.unsplash.com/photo-1606904825846-647eb07f5be2?auto=format&fit=crop&w=1400&q=90',
    link: '/shop',
    buttonText: 'Shop Now',
    badge: 'NEW',
    price: '',
    offerTag: 'HOT OFFER',
  },
];

/* =========================================================
   RESPONSE HELPERS
========================================================= */

function extractList(response, key) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.[key])) return response[key];
  if (Array.isArray(response?.data?.[key])) return response.data[key];
  if (Array.isArray(response?.data)) return response.data;
  return [];
}

const extractProducts = (response) => extractList(response, 'products');
const extractCategories = (response) => extractList(response, 'categories');
const extractAdvertisements = (response) =>
  extractList(response, 'advertisements');

/* =========================================================
   CATEGORY SLUG
========================================================= */

function getCategorySlug(category) {
  if (!category) return '';

  return (
    category.slug ||
    category._id ||
    category.name
      ?.toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-') ||
    ''
  );
}

/* =========================================================
   ADVERTISEMENT IMAGE
========================================================= */

function getAdvertisementImage(ad) {
  if (!ad) return heroSlides[0].image;

  return (
    ad.imageUrl ||
    ad.image ||
    ad.mobileImageUrl ||
    heroSlides[0].image
  );
}

/* =========================================================
   SIDE (FLIPPING) ADVERTS
   Fully independent from the main banner: they come from
   their own backend collection via fetchFlipAdvertisements().
========================================================= */

const FLIP_THEMES = ['mint', 'sand', 'sky', 'blush'];

function getFlipThemeIndex(theme, index) {
  const found = FLIP_THEMES.indexOf(String(theme || '').toLowerCase());
  return found >= 0 ? found : index % FLIP_THEMES.length;
}

function getRawAdImage(ad) {
  return ad?.imageUrl || ad?.image || ad?.mobileImageUrl || '';
}

// Shown only until you add "side" adverts in the admin panel.
const defaultSideAds = [
  {
    id: 'side-default-deal',
    badge: 'DEAL OF THE DAY',
    title: 'Lenovo ThinkPad T480',
    subtitle: 'Reliable power for work, study and business.',
    image:
      'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=700&q=80',
    link: '/shop',
    buttonText: 'Grab the deal',
    price: 'KSh 30,000',
    oldPrice: '',
  },
  {
    id: 'side-default-network',
    badge: 'TOP PICK',
    title: 'Networking Essentials',
    subtitle: 'Routers and gear that keep you connected.',
    image:
      'https://images.unsplash.com/photo-1606904825846-647eb07f5be2?auto=format&fit=crop&w=700&q=80',
    link: '/shop',
    buttonText: 'Shop now',
    price: '',
    oldPrice: '',
  },
  {
    id: 'side-default-workspace',
    badge: 'NEW',
    title: 'Upgrade Your Workspace',
    subtitle: 'Desktops, accessories and productivity gear.',
    image:
      'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=700&q=80',
    link: '/shop',
    buttonText: 'Browse',
    price: '',
    oldPrice: '',
  },
];

/* =========================================================
   CATEGORY ICON
========================================================= */

function getCategoryIcon(categoryName) {
  const name = String(categoryName || '').toLowerCase();

  if (name.includes('laptop') || name.includes('notebook')) {
    return Laptop;
  }

  if (name.includes('desktop') || name.includes('computer')) {
    return Monitor;
  }

  if (
    name.includes('audio') ||
    name.includes('speaker') ||
    name.includes('headphone')
  ) {
    return Volume2;
  }

  if (
    name.includes('network') ||
    name.includes('router') ||
    name.includes('wifi')
  ) {
    return Router;
  }

  if (
    name.includes('accessor') ||
    name.includes('component') ||
    name.includes('parts')
  ) {
    return Package;
  }

  return ShoppingBag;
}

/* =========================================================
   HOME PAGE
========================================================= */

export default function HomePage() {
  const [products, setProducts] = useState([]);
  const [featuredProducts, setFeaturedProducts] = useState([]);
  const [categories, setCategories] = useState([]);

  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingFeatured, setLoadingFeatured] = useState(true);
  const [loadingCategories, setLoadingCategories] = useState(true);

  const [ads, setAds] = useState([]);
  const [heroIndex, setHeroIndex] = useState(0);
  const [flipAds, setFlipAds] = useState([]);
  const [sideIndex, setSideIndex] = useState(0);
  const [sidePaused, setSidePaused] = useState(false);

  /* =========================================================
     PRODUCTS (also used to build New Arrivals)
  ========================================================= */

  useEffect(() => {
    const loadProducts = async () => {
      setLoadingProducts(true);

      try {
        const response = await fetchProducts({
          limit: 100,
          page: 1,
        });

        setProducts(extractProducts(response));
      } catch (error) {
        console.error('Unable to load homepage products:', error);
        setProducts([]);
      } finally {
        setLoadingProducts(false);
      }
    };

    loadProducts();
  }, []);

  /* =========================================================
     FEATURED PRODUCTS
  ========================================================= */

  useEffect(() => {
    const loadFeaturedProducts = async () => {
      setLoadingFeatured(true);

      try {
        const response = await fetchProducts({
          featured: 'true',
          limit: 6,
          page: 1,
        });

        const filteredFeatured = extractProducts(response)
          .filter((product) => product?.featured === true)
          .slice(0, 6);

        setFeaturedProducts(filteredFeatured);
      } catch (error) {
        console.error('Unable to load featured products:', error);
        setFeaturedProducts([]);
      } finally {
        setLoadingFeatured(false);
      }
    };

    loadFeaturedProducts();
  }, []);

  /* =========================================================
     CATEGORIES
  ========================================================= */

  useEffect(() => {
    const loadCategories = async () => {
      setLoadingCategories(true);

      try {
        const response = await fetchCategories();

        const loadedCategories = extractCategories(response)
          .filter((category) => category && category.name)
          .filter((category) => category.isActive !== false);

        setCategories(loadedCategories);
      } catch (error) {
        console.error('Unable to load categories:', error);
        setCategories([]);
      } finally {
        setLoadingCategories(false);
      }
    };

    loadCategories();
  }, []);

  /* =========================================================
     ADVERTISEMENTS
  ========================================================= */

  useEffect(() => {
    const loadAdvertisements = async () => {
      try {
        const response = await fetchAdvertisements();
        const now = new Date();

        const loadedAds = extractAdvertisements(response)
          .filter((ad) => ad && ad.active !== false)
          .filter((ad) => {
            if (ad.startsAt && new Date(ad.startsAt) > now) return false;
            if (ad.endsAt && new Date(ad.endsAt) < now) return false;
            return true;
          })
          .sort(
            (a, b) => Number(b.priority || 0) - Number(a.priority || 0)
          );

        setAds(loadedAds);
        setHeroIndex(0);
      } catch (error) {
        console.error(
          'Unable to load homepage advertisements:',
          error
        );

        setAds([]);
      }
    };

    loadAdvertisements();
  }, []);

  /* =========================================================
     FLIPPING SIDE ADVERTS (separate from the main banner)
  ========================================================= */

  useEffect(() => {
    const loadFlipAds = async () => {
      if (typeof apiModule.fetchFlipAdvertisements !== 'function') {
        setFlipAds([]);
        return;
      }

      try {
        const response = await apiModule.fetchFlipAdvertisements();
        const now = new Date();

        const loaded = extractList(response, 'flipAds')
          .filter((item) => item && item.active !== false)
          .filter((item) => {
            if (item.startsAt && new Date(item.startsAt) > now) return false;
            if (item.endsAt && new Date(item.endsAt) < now) return false;
            return true;
          })
          .sort(
            (a, b) => Number(b.priority || 0) - Number(a.priority || 0)
          );

        setFlipAds(loaded);
        setSideIndex(0);
      } catch (error) {
        console.error('Unable to load flipping adverts:', error);
        setFlipAds([]);
      }
    };

    loadFlipAds();
  }, []);

  /* =========================================================
     HERO SLIDES
  ========================================================= */

  const heroSlidesToUse = useMemo(() => {
    if (ads.length > 0) {
      const backendSlides = ads
        .filter(
          (ad) =>
            ad &&
            (ad.title ||
              ad.message ||
              ad.imageUrl ||
              ad.image ||
              ad.mobileImageUrl)
        )
        .slice(0, 5)
        .map((ad) => ({
          id:
            ad._id ||
            ad.id ||
            `${ad.title || 'advertisement'}-${ad.createdAt || ''}`,

          title: ad.title || 'Featured Tech Picks',

          subtitle:
            ad.message ||
            'Quality IT products at competitive prices.',

          image: getAdvertisementImage(ad),

          link: ad.buttonLink || ad.link || '/shop',

          buttonText: ad.buttonText || 'Shop Now',

          badge: ad.badge || 'LIMITED OFFER',

          price: ad.price || ad.offerPrice || '',

          offerTag: ad.discount
            ? `SAVE ${ad.discount}%`
            : ad.price || ad.offerPrice || 'HOT OFFER',
        }));

      if (backendSlides.length > 0) {
        return backendSlides;
      }
    }

    return heroSlides;
  }, [ads]);

  /* =========================================================
     HERO INDEX SAFETY
  ========================================================= */

  useEffect(() => {
    if (heroIndex >= heroSlidesToUse.length) {
      setHeroIndex(0);
    }
  }, [heroIndex, heroSlidesToUse.length]);

  /* =========================================================
     HERO AUTOPLAY
     Restarts whenever the slide changes, so a manual click
     always gets a full 6 seconds before the next auto-advance.
  ========================================================= */

  useEffect(() => {
    if (heroSlidesToUse.length <= 1) {
      return undefined;
    }

    const timeout = setTimeout(() => {
      setHeroIndex(
        (currentIndex) => (currentIndex + 1) % heroSlidesToUse.length
      );
    }, 6000);

    return () => clearTimeout(timeout);
  }, [heroIndex, heroSlidesToUse.length]);

  /* =========================================================
     SIDE FLIPPING ADVERTS
  ========================================================= */

  const sideItems = useMemo(() => {
    const backendItems = flipAds.slice(0, 6).map((item) => ({
      id:
        item._id ||
        item.id ||
        `${item.title || 'flip'}-${item.createdAt || ''}`,
      badge: item.badge || 'HOT DEAL',
      title: item.title || 'Special Offer',
      subtitle:
        item.description || item.message || item.subtitle || '',
      image: getRawAdImage(item),
      link: item.buttonLink || item.link || '/shop',
      buttonText: item.buttonText || 'Shop Now',
      price: item.price || item.offerPrice || '',
      oldPrice: item.oldPrice || item.originalPrice || '',
      theme: item.theme,
    }));

    const source =
      backendItems.length > 0 ? backendItems : defaultSideAds;

    return source.map((item, index) => ({
      ...item,
      themeIndex: getFlipThemeIndex(item.theme, index),
    }));
  }, [flipAds]);

  const activeSideIndex = sideItems.length
    ? sideIndex % sideItems.length
    : 0;

  // Flips every 5 seconds, pauses while the mouse is over the card.
  useEffect(() => {
    if (sideItems.length <= 1 || sidePaused) {
      return undefined;
    }

    const timeout = setTimeout(() => {
      setSideIndex((current) => (current + 1) % sideItems.length);
    }, 5000);

    return () => clearTimeout(timeout);
  }, [activeSideIndex, sideItems.length, sidePaused]);

  /* =========================================================
     HERO CONTROLS
  ========================================================= */

  const goToPreviousHero = () => {
    setHeroIndex((currentIndex) => {
      if (heroSlidesToUse.length <= 1) return 0;

      return currentIndex === 0
        ? heroSlidesToUse.length - 1
        : currentIndex - 1;
    });
  };

  const goToNextHero = () => {
    setHeroIndex((currentIndex) => {
      if (heroSlidesToUse.length <= 1) return 0;

      return (currentIndex + 1) % heroSlidesToUse.length;
    });
  };

  const activeHero = heroSlidesToUse[heroIndex] || heroSlides[0];

  /* =========================================================
     LIVE TICKER
  ========================================================= */

  const liveTickerMessage =
    'Live Deals: Lenovo ThinkPad T480 @ KSh 30,000 — Limited Stock Available!';

  /* =========================================================
     DISPLAY DATA
  ========================================================= */

  // The panel scrolls, so we can show more than 5 categories.
  const visibleCategories = useMemo(
    () =>
      categories
        .filter((category) => category && category.name)
        .slice(0, 8),
    [categories]
  );

  const displayedFeatured = useMemo(() => {
    if (featuredProducts.length > 0) return featuredProducts;

    return products
      .filter((product) => product?.featured === true)
      .slice(0, 6);
  }, [featuredProducts, products]);

  // New arrivals are derived from the products already loaded above.
  const displayedNewArrivals = useMemo(
    () =>
      [...products]
        .filter((product) => product?.createdAt)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() -
            new Date(a.createdAt).getTime()
        )
        .slice(0, 8),
    [products]
  );

  const featuredLoadingState = loadingFeatured && loadingProducts;
  const newArrivalsLoadingState = loadingProducts;

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <div className="homepage-shell">

      {/* =====================================================
          TOP LIVE DEALS TICKER
      ===================================================== */}

      <section className="homepage-live-offer">
        <div className="container">
          <div className="live-offer-inner">

            <div className="live-offer-label">
              <span className="live-offer-dot" />
              <span>LIVE</span>
            </div>

            <div
              className="live-offer-ticker"
              aria-label={liveTickerMessage}
            >
              <div className="live-offer-ticker-track" aria-hidden="true">
                <span className="live-offer-ticker-item">
                  {liveTickerMessage}
                </span>
                <span className="live-offer-ticker-separator">•</span>
                <span className="live-offer-ticker-item">
                  {liveTickerMessage}
                </span>
                <span className="live-offer-ticker-separator">•</span>
              </div>
            </div>

            <Link to="/shop" className="live-offer-button">
              Shop Now
              <ArrowRight size={15} />
            </Link>

          </div>
        </div>
      </section>

      {/* =====================================================
          HERO SLIDER + SIDE PROMOS + CATEGORIES
          (all classes start with "shero-" so old CSS cannot clash)
      ===================================================== */}

      <section className="shero">
        <div className="container shero-grid">

          {/* =================================================
              1. MAIN SLIDER  (message left, image right)
          ================================================= */}

          <div className="shero-slider">

            {heroSlidesToUse.map((slide, index) => {
              const isActive = index === heroIndex;

              return (
                <div
                  key={`${slide.id || slide.title}-${index}`}
                  className={`shero-slide ${isActive ? 'is-active' : ''}`}
                  aria-hidden={!isActive}
                >
                  <div className="shero-copy">
                    <span className="shero-badge">
                      {slide.badge || 'LIMITED OFFER'}
                    </span>

                    <h2 className="shero-title">{slide.title}</h2>

                    {slide.subtitle && (
                      <p className="shero-text">{slide.subtitle}</p>
                    )}

                    {slide.price && (
                      <div className="shero-price">
                        <span>@ only</span>
                        <strong>{slide.price}</strong>
                      </div>
                    )}

                    <div className="shero-actions">
                      <Link
                        to={slide.link || '/shop'}
                        className="shero-btn shero-btn--solid"
                        tabIndex={isActive ? 0 : -1}
                      >
                        {slide.buttonText || 'Shop Now'}
                        <ArrowRight size={15} />
                      </Link>

                      <Link
                        to="/deals"
                        className="shero-btn shero-btn--outline"
                        tabIndex={isActive ? 0 : -1}
                      >
                        View Deals
                      </Link>
                    </div>
                  </div>

                  <div className="shero-media">
                    <img
                      src={slide.image}
                      alt={slide.title || 'Sylva Technologies offer'}
                      loading={index === 0 ? 'eager' : 'lazy'}
                      onError={(event) => {
                        event.currentTarget.onerror = null;
                        event.currentTarget.src = heroSlides[0].image;
                      }}
                    />
                  </div>
                </div>
              );
            })}

            <div className="shero-tag">
              {activeHero.offerTag || activeHero.price || 'HOT OFFER'}
            </div>

            {heroSlidesToUse.length > 1 && (
              <>
                <button
                  type="button"
                  className="shero-arrow shero-arrow--left"
                  onClick={goToPreviousHero}
                  aria-label="Previous advertisement"
                >
                  ‹
                </button>

                <button
                  type="button"
                  className="shero-arrow shero-arrow--right"
                  onClick={goToNextHero}
                  aria-label="Next advertisement"
                >
                  ›
                </button>

                <div className="shero-dots">
                  {heroSlidesToUse.map((slide, index) => (
                    <button
                      key={`${slide.id || slide.title}-dot-${index}`}
                      type="button"
                      className={index === heroIndex ? 'is-active' : ''}
                      onClick={() => setHeroIndex(index)}
                      aria-label={`Show advertisement ${index + 1}`}
                    />
                  ))}
                </div>
              </>
            )}

          </div>

          {/* =================================================
              2. FLIPPING ADVERT CARD
              Managed from its own backend collection (flip-ads).
          ================================================= */}

          <div className="shero-promos">
            <div
              className="shero-flip"
              onMouseEnter={() => setSidePaused(true)}
              onMouseLeave={() => setSidePaused(false)}
            >
              {sideItems.map((item, index) => {
                const isActive = index === activeSideIndex;

                return (
                  <Link
                    key={`${item.id}-${index}`}
                    to={item.link || '/shop'}
                    className={`shero-flip-card shero-flip-card--${item.themeIndex} ${
                      isActive ? 'is-active' : ''
                    }`}
                    aria-hidden={!isActive}
                    tabIndex={isActive ? 0 : -1}
                  >
                    <div className="shero-flip-top">
                      <span className="shero-flip-label">{item.badge}</span>

                      {item.price && (
                        <span className="shero-flip-price">
                          <strong>{item.price}</strong>
                          {item.oldPrice && <s>{item.oldPrice}</s>}
                        </span>
                      )}
                    </div>

                    <div className="shero-flip-image">
                      {item.image ? (
                        <img
                          src={item.image}
                          alt={item.title}
                          loading="lazy"
                          onError={(event) => {
                            event.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : (
                        <ShoppingBag size={44} />
                      )}
                    </div>

                    <div className="shero-flip-info">
                      <strong>{item.title}</strong>
                      {item.subtitle && <p>{item.subtitle}</p>}
                      <span className="shero-flip-cta">
                        {item.buttonText || 'Shop Now'}
                        <ArrowRight size={13} />
                      </span>
                    </div>
                  </Link>
                );
              })}

              {sideItems.length > 1 && (
                <div className="shero-flip-dots">
                  {sideItems.map((item, index) => (
                    <button
                      key={`${item.id}-dot-${index}`}
                      type="button"
                      className={index === activeSideIndex ? 'is-active' : ''}
                      onClick={() => setSideIndex(index)}
                      aria-label={`Show offer ${index + 1}`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* =================================================
              3. SHOP BY CATEGORY
          ================================================= */}

          <aside className="shero-cats">

            <div className="shero-cats-head">
              <div>
                <span className="shero-cats-kicker">EXPLORE</span>
                <h2>Shop by Category</h2>
              </div>

              <Link to="/categories">
                View All
                <ArrowRight size={14} />
              </Link>
            </div>

            <div className="shero-cats-list">
              {loadingCategories ? (
                Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="shero-cat shero-cat--skeleton">
                    <span className="shero-cat-icon-skel" />
                    <span className="shero-cat-name-skel" />
                  </div>
                ))
              ) : visibleCategories.length > 0 ? (
                visibleCategories.map((category) => {
                  const slug = getCategorySlug(category);
                  const Icon = getCategoryIcon(category.name);

                  return (
                    <Link
                      key={category._id || category.slug || category.name}
                      to={
                        slug
                          ? `/shop?category=${encodeURIComponent(slug)}`
                          : '/shop'
                      }
                      className="shero-cat"
                    >
                      <span className="shero-cat-left">
                        <span className="shero-cat-icon">
                          <Icon size={17} />
                        </span>
                        <span className="shero-cat-name">
                          {category.name}
                        </span>
                      </span>

                      <ArrowRight className="shero-cat-arrow" size={16} />
                    </Link>
                  );
                })
              ) : (
                <div className="empty-state compact">
                  <ShoppingBag size={24} />
                  <span>No categories available right now.</span>
                </div>
              )}
            </div>

          </aside>

        </div>
      </section>

      {/* =====================================================
          MAIN CONTENT
      ===================================================== */}

      <div className="container home-shell">
        <main className="home-main">

          {/* =================================================
              FEATURED PRODUCTS
          ================================================= */}

          <section className="store-section featured-home-section">

            <div className="section-heading">
              <div>
                <span className="section-kicker">HANDPICKED FOR YOU</span>
                <h2>Featured Products</h2>
              </div>

              <Link to="/shop">
                View All
                <ArrowRight size={15} />
              </Link>
            </div>

            {featuredLoadingState ? (
              <div className="product-loading-grid">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="product-skeleton">
                    <div className="skeleton-image" />
                    <div className="skeleton-line" />
                    <div className="skeleton-line short" />
                    <div className="skeleton-price" />
                  </div>
                ))}
              </div>
            ) : displayedFeatured.length > 0 ? (
              <div className="product-grid home-grid">
                {displayedFeatured.map((product) => (
                  <ProductCard
                    key={product._id || product.slug || product.id}
                    product={product}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state compact">
                <ShoppingBag size={24} />
                <span>No featured products available yet.</span>
              </div>
            )}

          </section>

          {/* =================================================
              NEW ARRIVALS
          ================================================= */}

          <section className="store-section new-arrivals-home-section">

            <div className="section-heading">
              <div>
                <span className="section-kicker">JUST ADDED</span>
                <h2>New Arrivals</h2>
              </div>

              <Link to="/shop">
                View All
                <ArrowRight size={15} />
              </Link>
            </div>

            {newArrivalsLoadingState ? (
              <div className="product-loading-grid">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="product-skeleton">
                    <div className="skeleton-image" />
                    <div className="skeleton-line" />
                    <div className="skeleton-line short" />
                    <div className="skeleton-price" />
                  </div>
                ))}
              </div>
            ) : displayedNewArrivals.length > 0 ? (
              <div className="product-grid home-grid">
                {displayedNewArrivals.map((product) => (
                  <ProductCard
                    key={product._id || product.slug || product.id}
                    product={product}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state compact">
                <ShoppingBag size={24} />
                <span>No products available yet.</span>
              </div>
            )}

          </section>

          {/* =================================================
              SELLER CTA
          ================================================= */}

          <section className="seller-cta-section">
            <div className="seller-cta-card">

              <div className="seller-cta-copy">
                <span className="section-kicker">SELL ON SYLVA</span>

                <h2>Reach more customers and grow your IT business.</h2>

                <p>
                  Have IT products to sell? Join Sylva Technologies and
                  reach customers across Kenya with a trusted marketplace
                  built for technology products.
                </p>
              </div>

              <div className="seller-cta-actions">
                <Link to="/sell" className="primary-btn">
                  Start Selling
                </Link>

                <Link to="/seller/login" className="secondary-btn">
                  Seller Login
                </Link>
              </div>

            </div>
          </section>

          {/* =================================================
              VALUE STRIP
          ================================================= */}

          <section className="product-value-strip">

            <div>
              <ShieldCheck size={20} />
              <div>
                <strong>Quality IT Products</strong>
                <span>Genuine & Trusted</span>
              </div>
            </div>

            <div>
              <ShoppingBag size={20} />
              <div>
                <strong>Competitive Prices</strong>
                <span>Best Value Always</span>
              </div>
            </div>

            <div>
              <Headphones size={20} />
              <div>
                <strong>Customer Support</strong>
                <span>Here to help</span>
              </div>
            </div>

            <div>
              <ShieldCheck size={20} />
              <div>
                <strong>Secure Payments</strong>
                <span>Safe & Encrypted</span>
              </div>
            </div>

            <div>
              <Truck size={20} />
              <div>
                <strong>Fast Delivery</strong>
                <span>Across Kenya</span>
              </div>
            </div>

          </section>

        </main>
      </div>

    </div>
  );
}