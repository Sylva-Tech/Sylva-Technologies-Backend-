import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCategories } from '../services/api';

const categoryFallbacks = [
  'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1527814050087-3793815479db?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1606904825846-647eb07f5be2?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1555618566-8b4f7f9eb0a6?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1612815154858-60aa4c59eaa6?auto=format&fit=crop&w=900&q=80',
];

function getCategorySlug(category) {
  if (!category) return '';
  return (
    category.slug ||
    category._id ||
    category.name?.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-') ||
    ''
  );
}

function CategoriesPage() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadCategories = async () => {
      try {
        setLoading(true);
        const response = await fetchCategories();
        const categoryList = Array.isArray(response)
          ? response
          : Array.isArray(response?.categories)
            ? response.categories
            : Array.isArray(response?.data?.categories)
              ? response.data.categories
              : Array.isArray(response?.data)
                ? response.data
                : [];

        const visibleCategories = categoryList.filter(
          (category) => category && category.name && category.isActive !== false
        );

        setCategories(visibleCategories);
      } catch (error) {
        console.error('Unable to load categories:', error);
        setCategories([]);
      } finally {
        setLoading(false);
      }
    };

    loadCategories();
  }, []);

  return (
    <section className="container section-block categories-page">
      <div className="information-hero">
        <p className="eyebrow">Shop by category</p>
        <h1>Browse categories</h1>
        <p>
          Find the right products for your workspace, home office, study setup,
          entertainment needs and everyday digital life.
        </p>
      </div>

      {loading ? (
        <div className="categories-grid categories-loading-grid">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="category-card category-skeleton-card">
              <div className="skeleton-image" />
              <div className="skeleton-line" />
            </div>
          ))}
        </div>
      ) : categories.length > 0 ? (
        <div className="categories-grid">
          {categories.map((category, index) => {
            const slug = getCategorySlug(category);
            const categoryImage =
              category.image ||
              category.icon ||
              categoryFallbacks[Math.abs(index) % categoryFallbacks.length];

            return (
              <Link
                key={category._id || category.slug || category.name}
                to={slug ? `/shop?category=${encodeURIComponent(slug)}` : '/shop'}
                className="category-card"
              >
                <div className="category-card-image">
                  <img src={categoryImage} alt={category.name} loading="lazy" />
                </div>
                <div className="category-card-body">
                  <h3>{category.name}</h3>
                  <span>Explore products</span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="empty-state compact">
          <h3>No categories available</h3>
          <p>Categories will appear here as soon as they are added to the store.</p>
        </div>
      )}
    </section>
  );
}

export default CategoriesPage;
