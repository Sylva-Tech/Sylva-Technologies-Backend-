import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

const blank = {
  title: '',
  message: '',
  image: '',
  link: '/shop',
  active: true,
  startsAt: '',
  endsAt: '',
};

const blankFlip = {
  title: '',
  description: '',
  imageUrl: '',
  badge: 'HOT DEAL',
  price: '',
  oldPrice: '',
  buttonText: 'Shop Now',
  buttonLink: '/shop',
  theme: 'mint',
  active: true,
  startsAt: '',
  endsAt: '',
  priority: 0,
};

function AdminAdsPage() {
  const [ads, setAds] = useState([]);
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const [flipAds, setFlipAds] = useState([]);
  const [flipForm, setFlipForm] = useState(blankFlip);
  const [flipEditingId, setFlipEditingId] = useState(null);
  const [flipMessage, setFlipMessage] = useState('');
  const [flipLoading, setFlipLoading] = useState(false);

  const token = localStorage.getItem('sylva-token');

  const config = {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  const load = async () => {
    try {
      const { data } = await api.get('/advertisements');

      const advertisements = Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
          ? data.data
          : [];

      setAds(advertisements);
    } catch (error) {
      console.error('Unable to load advertisements:', error);
      setMessage('Unable to load live ads.');
    }
  };

  const loadFlip = async () => {
    try {
      const { data } = await api.get('/flip-advertisements/all');

      const items = Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
          ? data.data
          : [];

      setFlipAds(items);
    } catch (error) {
      console.error('Unable to load flip advertisements:', error);
      setFlipMessage('Unable to load flip ads.');
    }
  };

  useEffect(() => {
    load();
    loadFlip();
  }, []);

  const update = (event) => {
    const { name, value, type, checked } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const updateFlip = (event) => {
    const { name, value, type, checked } = event.target;

    setFlipForm((previous) => ({
      ...previous,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const resetForm = () => {
    setForm(blank);
    setEditingId(null);
  };

  const resetFlipForm = () => {
    setFlipForm(blankFlip);
    setFlipEditingId(null);
  };

  const save = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      if (editingId) {
        await api.put(
          `/advertisements/${editingId}`,
          form,
          config
        );

        setMessage('Banner updated successfully.');
      } else {
        await api.post(
          '/advertisements',
          form,
          config
        );

        setMessage('Banner created successfully.');
      }

      resetForm();
      await load();
    } catch (error) {
      console.error('Unable to save advertisement:', error);

      setMessage(
        error.response?.data?.message ||
          'Unable to save banner.'
      );
    } finally {
      setLoading(false);
    }
  };

  const edit = (ad) => {
    setEditingId(ad._id);

    setForm({
      title: ad.title || '',
      message: ad.message || '',
      image: ad.image || '',
      link: ad.link || '/shop',
      active: ad.active !== false,
      startsAt: ad.startsAt
        ? new Date(ad.startsAt).toISOString().slice(0, 16)
        : '',
      endsAt: ad.endsAt
        ? new Date(ad.endsAt).toISOString().slice(0, 16)
        : '',
    });

    setMessage('');
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  const saveFlip = async (event) => {
    event.preventDefault();
    setFlipLoading(true);
    setFlipMessage('');

    try {
      const payload = {
        ...flipForm,
        priority:
          flipForm.priority === '' || flipForm.priority === null
            ? 0
            : Number(flipForm.priority),
      };

      if (flipEditingId) {
        await api.put(
          `/flip-advertisements/${flipEditingId}`,
          payload,
          config
        );

        setFlipMessage('Flip ad updated successfully.');
      } else {
        await api.post(
          '/flip-advertisements',
          payload,
          config
        );

        setFlipMessage('Flip ad created successfully.');
      }

      resetFlipForm();
      await loadFlip();
    } catch (error) {
      console.error('Unable to save flip advertisement:', error);

      setFlipMessage(
        error.response?.data?.message ||
          'Unable to save flip ad.'
      );
    } finally {
      setFlipLoading(false);
    }
  };

  const editFlip = (item) => {
    setFlipEditingId(item._id);

    setFlipForm({
      title: item.title || '',
      description: item.description || '',
      imageUrl: item.imageUrl || '',
      badge: item.badge || 'HOT DEAL',
      price: item.price || '',
      oldPrice: item.oldPrice || '',
      buttonText: item.buttonText || 'Shop Now',
      buttonLink: item.buttonLink || '/shop',
      theme: item.theme || 'mint',
      active: item.active !== false,
      startsAt: item.startsAt
        ? new Date(item.startsAt).toISOString().slice(0, 16)
        : '',
      endsAt: item.endsAt
        ? new Date(item.endsAt).toISOString().slice(0, 16)
        : '',
      priority: item.priority ?? 0,
    });

    setFlipMessage('');
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this live ad?')) {
      return;
    }

    try {
      await api.delete(
        `/advertisements/${id}`,
        config
      );

      if (editingId === id) {
        resetForm();
      }

      setMessage('Banner deleted successfully.');
      await load();
    } catch (error) {
      console.error('Unable to delete advertisement:', error);

      setMessage(
        error.response?.data?.message ||
          'Unable to delete banner.'
      );
    }
  };

  const removeFlip = async (id) => {
    if (!window.confirm('Delete this flip ad?')) {
      return;
    }

    try {
      await api.delete(
        `/flip-advertisements/${id}`,
        config
      );

      if (flipEditingId === id) {
        resetFlipForm();
      }

      setFlipMessage('Flip ad deleted successfully.');
      await loadFlip();
    } catch (error) {
      console.error('Unable to delete flip advertisement:', error);

      setFlipMessage(
        error.response?.data?.message ||
          'Unable to delete flip ad.'
      );
    }
  };

  return (
    <section className="container section-block admin-page">
      <div className="admin-page-head">
        <div>
          <p className="eyebrow">Homepage control</p>

          <h1>
            {editingId
              ? 'Edit Homepage Banner'
              : 'Live Ads'}
          </h1>

          <p className="results-note">
            Change the homepage banner image, message,
            title and destination without editing the
            website code.
          </p>
        </div>

        <Link
          to="/admin"
          className="secondary-btn"
        >
          Back to dashboard
        </Link>
      </div>

      <div className="admin-ads-layout">
        <form
          className="admin-product-form"
          onSubmit={save}
        >
          <fieldset>
            <legend>
              {editingId
                ? 'Edit live banner'
                : 'Create live banner'}
            </legend>

            <label>
              Banner Title

              <input
                name="title"
                value={form.title}
                onChange={update}
                placeholder="Premium Laptops"
                required
              />
            </label>

            <label>
              Banner Message

              <textarea
                name="message"
                value={form.message}
                onChange={update}
                rows="4"
                placeholder="Shop quality laptops at competitive prices."
                required
              />
            </label>

            <label>
              Banner Image URL

              <input
                name="image"
                value={form.image}
                onChange={update}
                placeholder="https://example.com/banner.jpg"
              />
            </label>

            {form.image && (
              <div className="admin-ad-preview">
                <p>Banner preview</p>

                <img
                  src={form.image}
                  alt="Banner preview"
                  onError={(event) => {
                    event.currentTarget.style.display = 'none';
                  }}
                />
              </div>
            )}

            <label>
              Button / Destination Link

              <input
                name="link"
                value={form.link}
                onChange={update}
                placeholder="/shop"
              />
            </label>

            <label>
              Start Date

              <input
                type="datetime-local"
                name="startsAt"
                value={form.startsAt}
                onChange={update}
              />
            </label>

            <label>
              End Date

              <input
                type="datetime-local"
                name="endsAt"
                value={form.endsAt}
                onChange={update}
              />
            </label>

            <label className="admin-checkbox">
              <input
                type="checkbox"
                name="active"
                checked={form.active}
                onChange={update}
              />

              Active
            </label>

            <div className="admin-form-actions">
              <button
                className="primary-btn"
                type="submit"
                disabled={loading}
              >
                {loading
                  ? 'Saving...'
                  : editingId
                    ? 'Save Banner Changes'
                    : 'Create Live Banner'}
              </button>

              {editingId && (
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={resetForm}
                >
                  Cancel Edit
                </button>
              )}
            </div>
          </fieldset>
        </form>

        <div>
          <div className="admin-ads-heading">
            <div>
              <h2>Homepage Banners</h2>

              <p className="results-note">
                These banners are loaded by the homepage
                from the backend.
              </p>
            </div>
          </div>

          {message && (
            <p className="results-note">
              {message}
            </p>
          )}

          {ads.map((ad) => (
            <article
              className="admin-ad-row"
              key={ad._id}
            >
              {ad.image && (
                <img
                  className="admin-ad-thumbnail"
                  src={ad.image}
                  alt={ad.title}
                  onError={(event) => {
                    event.currentTarget.style.display =
                      'none';
                  }}
                />
              )}

              <div className="admin-ad-content">
                <strong>
                  {ad.title}
                </strong>

                <span>
                  {ad.message}
                </span>

                <small>
                  Status:{' '}
                  {ad.active
                    ? 'Active'
                    : 'Inactive'}
                </small>
              </div>

              <div className="admin-ad-actions">
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => edit(ad)}
                >
                  Edit
                </button>

                <button
                  className="table-delete"
                  type="button"
                  onClick={() =>
                    remove(ad._id)
                  }
                >
                  Delete
                </button>
              </div>
            </article>
          ))}

          {!ads.length && (
            <div className="empty-state">
              No advertisements found.
            </div>
          )}
        </div>
      </div>

      <div className="admin-ads-layout" style={{ marginTop: '2rem' }}>
        <form
          className="admin-product-form"
          onSubmit={saveFlip}
        >
          <fieldset>
            <legend>
              {flipEditingId
                ? 'Edit flip ad'
                : 'Create flip ad'}
            </legend>

            <label>
              Title
              <input
                name="title"
                value={flipForm.title}
                onChange={updateFlip}
                required
              />
            </label>

            <label>
              Description
              <textarea
                name="description"
                value={flipForm.description}
                onChange={updateFlip}
                rows="3"
              />
            </label>

            <label>
              Image URL
              <input
                name="imageUrl"
                value={flipForm.imageUrl}
                onChange={updateFlip}
              />
            </label>

            <label>
              Badge
              <input
                name="badge"
                value={flipForm.badge}
                onChange={updateFlip}
              />
            </label>

            <label>
              Price
              <input
                name="price"
                value={flipForm.price}
                onChange={updateFlip}
              />
            </label>

            <label>
              Old Price
              <input
                name="oldPrice"
                value={flipForm.oldPrice}
                onChange={updateFlip}
              />
            </label>

            <label>
              Button Text
              <input
                name="buttonText"
                value={flipForm.buttonText}
                onChange={updateFlip}
              />
            </label>

            <label>
              Button Link
              <input
                name="buttonLink"
                value={flipForm.buttonLink}
                onChange={updateFlip}
              />
            </label>

            <label>
              Theme
              <select
                name="theme"
                value={flipForm.theme}
                onChange={updateFlip}
              >
                <option value="mint">Mint</option>
                <option value="sand">Sand</option>
                <option value="sky">Sky</option>
                <option value="blush">Blush</option>
              </select>
            </label>

            <label>
              Priority
              <input
                type="number"
                name="priority"
                value={flipForm.priority}
                onChange={updateFlip}
              />
            </label>

            <label>
              Start Date
              <input
                type="datetime-local"
                name="startsAt"
                value={flipForm.startsAt}
                onChange={updateFlip}
              />
            </label>

            <label>
              End Date
              <input
                type="datetime-local"
                name="endsAt"
                value={flipForm.endsAt}
                onChange={updateFlip}
              />
            </label>

            <label className="admin-checkbox">
              <input
                type="checkbox"
                name="active"
                checked={flipForm.active}
                onChange={updateFlip}
              />
              Active
            </label>

            <div className="admin-form-actions">
              <button
                className="primary-btn"
                type="submit"
                disabled={flipLoading}
              >
                {flipLoading
                  ? 'Saving...'
                  : flipEditingId
                    ? 'Save Flip Ad'
                    : 'Create Flip Ad'}
              </button>

              {flipEditingId && (
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={resetFlipForm}
                >
                  Cancel Edit
                </button>
              )}
            </div>
          </fieldset>
        </form>

        <div>
          <div className="admin-ads-heading">
            <div>
              <h2>Flip Ads</h2>
              <p className="results-note">
                These side flip deals are displayed on the homepage.
              </p>
            </div>
          </div>

          {flipMessage && (
            <p className="results-note">{flipMessage}</p>
          )}

          {flipAds.map((item) => (
            <article
              className="admin-ad-row"
              key={item._id}
            >
              {item.imageUrl && (
                <img
                  className="admin-ad-thumbnail"
                  src={item.imageUrl}
                  alt={item.title}
                  onError={(event) => {
                    event.currentTarget.style.display = 'none';
                  }}
                />
              )}

              <div className="admin-ad-content">
                <strong>{item.title}</strong>
                <span>{item.description || item.badge || 'Flip ad'}</span>
                <small>
                  Status: {item.active ? 'Active' : 'Inactive'}
                </small>
              </div>

              <div className="admin-ad-actions">
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => editFlip(item)}
                >
                  Edit
                </button>

                <button
                  className="table-delete"
                  type="button"
                  onClick={() => removeFlip(item._id)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}

          {!flipAds.length && (
            <div className="empty-state">
              No flip advertisements found.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default AdminAdsPage;

