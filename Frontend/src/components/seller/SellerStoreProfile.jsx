import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ImagePlus,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Save,
  ShieldCheck,
  Store,
  User,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

import './SellerStoreProfile.css';

function SellerStoreProfile() {
  const { user } = useAuth();

  const sellerStatus = user?.sellerStatus || 'pending';

  const [isEditing, setIsEditing] = useState(false);

  const [store, setStore] = useState({
    name: user?.storeName || '',
    description:
      user?.storeProfile ||
      'Your store description will appear here once your seller profile is completed.',
    location: user?.storeLocation || '',
    logo: user?.storeLogo || '',
  });

  const [draftStore, setDraftStore] = useState(store);

  const sellerName = user?.name || 'Seller';
  const sellerEmail = user?.email || 'Not available';
  const sellerPhone = user?.phone || 'Not available';

  const statusInfo = useMemo(() => {
    if (sellerStatus === 'approved') {
      return {
        label: 'Approved',
        description: 'Your seller account has been approved.',
        className: 'store-status-approved',
      };
    }

    if (sellerStatus === 'rejected') {
      return {
        label: 'Action Required',
        description: 'Your seller application requires attention.',
        className: 'store-status-rejected',
      };
    }

    return {
      label: 'Under Review',
      description:
        'Your seller application is currently being reviewed by Sylva Technologies.',
      className: 'store-status-pending',
    };
  }, [sellerStatus]);

  const handleEdit = () => {
    setDraftStore(store);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setDraftStore(store);
    setIsEditing(false);
  };

  const handleChange = (event) => {
    const { name, value } = event.target;

    setDraftStore((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleLogoChange = (event) => {
    const file = event.target.files?.[0];

    if (!file) return;

    const imageUrl = URL.createObjectURL(file);

    setDraftStore((current) => ({
      ...current,
      logo: imageUrl,
    }));
  };

  const handleSave = (event) => {
    event.preventDefault();

    setStore(draftStore);
    setIsEditing(false);

    // Backend API connection will be added later.
  };

  return (
    <section className="seller-store-profile">
      <div className="store-profile-heading">
        <div>
          <span className="store-profile-eyebrow">Store Management</span>

          <h2>Store Profile</h2>

          <p>
            Manage the information customers will see about your store.
          </p>
        </div>

        {!isEditing && (
          <button
            type="button"
            className="store-profile-edit-button"
            onClick={handleEdit}
          >
            <Pencil size={17} />
            Edit Store
          </button>
        )}
      </div>

      <div className="store-profile-grid">
        <div className="store-profile-main">
          <div className="store-profile-card store-brand-card">
            <div className="store-brand-preview">
              <div className="store-logo-wrapper">
                {draftStore.logo ? (
                  <img
                    src={draftStore.logo}
                    alt={`${draftStore.name || 'Store'} logo`}
                    className="store-logo-image"
                  />
                ) : (
                  <div className="store-logo-placeholder">
                    <Store size={38} />
                  </div>
                )}

                {isEditing && (
                  <label
                    className="store-logo-upload"
                    htmlFor="store-logo-upload"
                    title="Upload store logo"
                  >
                    <ImagePlus size={17} />
                  </label>
                )}

                {isEditing && (
                  <input
                    id="store-logo-upload"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleLogoChange}
                    hidden
                  />
                )}
              </div>

              <div className="store-brand-details">
                <span className="store-brand-label">Store</span>

                <h3>
                  {draftStore.name || 'Your Technology Store'}
                </h3>

                <div className={`store-status ${statusInfo.className}`}>
                  <span className="store-status-dot" />
                  {statusInfo.label}
                </div>

                <p>{statusInfo.description}</p>
              </div>
            </div>
          </div>

          {isEditing ? (
            <form
              className="store-profile-card store-edit-card"
              onSubmit={handleSave}
            >
              <div className="store-card-header">
                <div>
                  <h3>Edit Store Information</h3>
                  <p>Update your store details below.</p>
                </div>
              </div>

              <div className="store-form-grid">
                <div className="store-form-field store-form-full">
                  <label htmlFor="store-name">Store Name</label>

                  <input
                    id="store-name"
                    name="name"
                    type="text"
                    value={draftStore.name}
                    onChange={handleChange}
                    placeholder="Enter your store name"
                    required
                  />
                </div>

                <div className="store-form-field store-form-full">
                  <label htmlFor="store-description">
                    Store Description
                  </label>

                  <textarea
                    id="store-description"
                    name="description"
                    rows="5"
                    value={draftStore.description}
                    onChange={handleChange}
                    placeholder="Describe your store and the products you sell"
                  />

                  <span className="store-form-hint">
                    Keep your description clear and customer-friendly.
                  </span>
                </div>

                <div className="store-form-field store-form-full">
                  <label htmlFor="store-location">Store Location</label>

                  <div className="store-input-icon">
                    <MapPin size={17} />

                    <input
                      id="store-location"
                      name="location"
                      type="text"
                      value={draftStore.location}
                      onChange={handleChange}
                      placeholder="e.g. Nairobi, Kenya"
                    />
                  </div>
                </div>
              </div>

              <div className="store-form-actions">
                <button
                  type="button"
                  className="store-cancel-button"
                  onClick={handleCancel}
                >
                  <X size={17} />
                  Cancel
                </button>

                <button type="submit" className="store-save-button">
                  <Save size={17} />
                  Save Changes
                </button>
              </div>
            </form>
          ) : (
            <div className="store-profile-card store-about-card">
              <div className="store-card-header">
                <div>
                  <h3>About Your Store</h3>
                  <p>Information displayed on your seller profile.</p>
                </div>
              </div>

              <div className="store-description">
                <p>{store.description}</p>
              </div>

              {store.location && (
                <div className="store-location-display">
                  <MapPin size={18} />
                  <span>{store.location}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="store-profile-side">
          <div className="store-profile-card seller-information-card">
            <div className="store-card-header">
              <div>
                <h3>Seller Information</h3>
                <p>Your account details</p>
              </div>

              <div className="seller-info-icon">
                <User size={19} />
              </div>
            </div>

            <div className="seller-info-list">
              <div className="seller-info-item">
                <div className="seller-info-item-icon">
                  <User size={17} />
                </div>

                <div>
                  <span>Name</span>
                  <strong>{sellerName}</strong>
                </div>
              </div>

              <div className="seller-info-item">
                <div className="seller-info-item-icon">
                  <Mail size={17} />
                </div>

                <div>
                  <span>Email</span>
                  <strong>{sellerEmail}</strong>
                </div>
              </div>

              <div className="seller-info-item">
                <div className="seller-info-item-icon">
                  <Phone size={17} />
                </div>

                <div>
                  <span>Phone</span>
                  <strong>{sellerPhone}</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="store-profile-card verification-card">
            <div className="verification-card-icon">
              <ShieldCheck size={22} />
            </div>

            <div>
              <h3>Seller Verification</h3>

              <p>
                Your verification documents are securely reviewed by the
                Sylva Technologies administration team.
              </p>

              <span className={`verification-status ${statusInfo.className}`}>
                <CheckCircle2 size={15} />
                {statusInfo.label}
              </span>
            </div>
          </div>

          <div className="store-profile-card store-tip-card">
            <span className="store-tip-label">Store Tip</span>

            <h3>Build customer trust</h3>

            <p>
              Use a clear store name, accurate description and recognizable
              logo to help customers understand your business.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}

export default SellerStoreProfile;