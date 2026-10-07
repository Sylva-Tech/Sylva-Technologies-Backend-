import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  ShieldAlert,
  Store,
  UserRound,
  XCircle,
} from 'lucide-react';

import api from '../services/api';
import './AdminSellerDetailsPage.css';

const getSellerId = (seller) => {
  if (!seller) return '';

  if (typeof seller._id === 'string') return seller._id;
  if (typeof seller.id === 'string') return seller.id;

  if (seller._id?.$oid) return seller._id.$oid;
  if (seller.id?.$oid) return seller.id.$oid;

  return '';
};

const formatDate = (value) => {
  if (!value) return 'Not available';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Not available';
  }

  return date.toLocaleString('en-KE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

const getStatusClass = (status) => {
  switch (String(status || '').toLowerCase()) {
    case 'active':
      return 'status-active';

    case 'approved':
      return 'status-active';

    case 'pending':
      return 'status-pending';

    case 'rejected':
      return 'status-rejected';

    case 'suspended':
      return 'status-suspended';

    case 'banned':
      return 'status-banned';

    case 'inactive':
      return 'status-suspended';

    default:
      return 'status-default';
  }
};

const getStatusLabel = (status) => {
  switch (String(status || '').toLowerCase()) {
    case 'active':
      return 'Active';

    case 'approved':
      return 'Approved';

    case 'pending':
      return 'Pending';

    case 'rejected':
      return 'Rejected';

    case 'suspended':
      return 'Suspended';

    case 'banned':
      return 'Banned';

    case 'inactive':
      return 'Inactive';

    default:
      return status || 'Unknown';
  }
};

const getResponseData = (response) => {
  if (!response) return null;

  if (response.data?.seller) {
    return response.data.seller;
  }

  if (response.data?.data?.seller) {
    return response.data.data.seller;
  }

  if (response.data?.data) {
    return response.data.data;
  }

  return response.data;
};

function AdminSellerDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [seller, setSeller] = useState(null);
  const [appeals, setAppeals] = useState([]);

  const [loading, setLoading] = useState(true);
  const [appealsLoading, setAppealsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showSuspendForm, setShowSuspendForm] = useState(false);
  const [showBanForm, setShowBanForm] = useState(false);

  const [suspensionReason, setSuspensionReason] = useState('');
  const [banReason, setBanReason] = useState('');

  const loadSeller = useCallback(async () => {
    if (!id) {
      setError('Seller ID is missing.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError('');

      const response = await api.get(
        `/seller-management/admin/sellers/${id}`
      );

      const data = getResponseData(response);

      if (!data) {
        throw new Error('Seller information was not returned by the server.');
      }

      setSeller(data);
    } catch (err) {
      console.error('Failed to load seller:', err);

      setError(
        err.response?.data?.message ||
          err.message ||
          'Failed to load seller information.'
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadAppeals = useCallback(async () => {
    if (!id) return;

    try {
      setAppealsLoading(true);

      const response = await api.get(
        '/seller-management/admin/appeals'
      );

      const data = response.data;

      let list = [];

      if (Array.isArray(data)) {
        list = data;
      } else if (Array.isArray(data?.appeals)) {
        list = data.appeals;
      } else if (Array.isArray(data?.data)) {
        list = data.data;
      }

      const sellerAppeals = list.filter((appeal) => {
        const appealSeller =
          appeal?.seller?._id ||
          appeal?.seller?.id ||
          appeal?.seller;

        return String(appealSeller) === String(id);
      });

      setAppeals(sellerAppeals);
    } catch (err) {
      console.error('Failed to load seller appeals:', err);
    } finally {
      setAppealsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadSeller();
    loadAppeals();
  }, [loadSeller, loadAppeals]);

  const runAction = async (action, successMessage) => {
    try {
      setActionLoading(true);
      setError('');
      setSuccess('');

      await action();

      setSuccess(successMessage);

      await loadSeller();
      await loadAppeals();
    } catch (err) {
      console.error('Seller action failed:', err);

      setError(
        err.response?.data?.message ||
          err.message ||
          'The requested action could not be completed.'
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleSuspend = async (event) => {
    event.preventDefault();

    if (suspensionReason.trim().length < 5) {
      setError('Please provide a suspension reason.');
      return;
    }

    await runAction(
      () =>
        api.patch(`/seller-management/admin/sellers/${id}/suspend`, {
          reason: suspensionReason.trim(),
        }),
      'Seller suspended successfully.'
    );

    setSuspensionReason('');
    setShowSuspendForm(false);
  };

  const handleBan = async (event) => {
    event.preventDefault();

    if (banReason.trim().length < 5) {
      setError('Please provide a ban reason.');
      return;
    }

    await runAction(
      () =>
        api.patch(`/seller-management/admin/sellers/${id}/ban`, {
          reason: banReason.trim(),
        }),
      'Seller banned successfully.'
    );

    setBanReason('');
    setShowBanForm(false);
  };

  const handleReactivate = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to reactivate this seller?'
    );

    if (!confirmed) return;

    await runAction(
      () =>
        api.patch(
          `/seller-management/admin/sellers/${id}/reactivate`
        ),
      'Seller reactivated successfully.'
    );
  };

  const handleApproveAppeal = async (appealId) => {
    const response = window.prompt(
      'Enter an optional response to the seller:'
    );

    if (response === null) return;

    await runAction(
      () =>
        api.patch(
          `/seller-management/admin/appeals/${appealId}/approve`,
          {
            adminResponse: response.trim(),
          }
        ),
      'Appeal approved and seller reactivated.'
    );
  };

  const handleRejectAppeal = async (appealId) => {
    const response = window.prompt(
      'Enter the reason for rejecting this appeal:'
    );

    if (response === null) return;

    if (response.trim().length < 5) {
      setError('Please provide a rejection response.');
      return;
    }

    await runAction(
      () =>
        api.patch(
          `/seller-management/admin/appeals/${appealId}/reject`,
          {
            adminResponse: response.trim(),
          }
        ),
      'Appeal rejected.'
    );
  };

  if (loading) {
    return (
      <div className="admin-seller-details-page">
        <div className="seller-details-loading">
          <Loader2 className="spin" size={32} />
          <p>Loading seller information...</p>
        </div>
      </div>
    );
  }

  if (error && !seller) {
    return (
      <div className="admin-seller-details-page">
        <div className="seller-details-header">
          <button
            type="button"
            className="back-button"
            onClick={() => navigate('/admin/sellers')}
          >
            <ArrowLeft size={18} />
            Back to Sellers
          </button>
        </div>

        <div className="seller-details-alert error">
          <ShieldAlert size={20} />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!seller) {
    return (
      <div className="admin-seller-details-page">
        <div className="seller-details-alert error">
          <ShieldAlert size={20} />
          <span>Seller information could not be found.</span>
        </div>
      </div>
    );
  }

  const sellerId = getSellerId(seller);

  const profile = seller.sellerProfile || {};

  const officialName =
    profile.officialName ||
    seller.name ||
    seller.fullName ||
    'Not provided';

  const email =
    profile.storeEmail ||
    seller.email ||
    'Not provided';

  const phone =
    profile.storePhone ||
    seller.phone ||
    profile.mpesaPhone ||
    seller.mpesaPhone ||
    'Not provided';

  const storeName =
    profile.storeName ||
    seller.storeName ||
    seller.store?.name ||
    'Not provided';

  const storeProfile =
    profile.storeProfile ||
    seller.storeProfile ||
    seller.store?.profile ||
    'No store description provided.';

  const sellerStatus =
    seller.sellerStatus ||
    seller.effectiveStatus ||
    'pending';

  const effectiveStatus =
    seller.effectiveStatus ||
    sellerStatus;

  const accountStatus =
    seller.accountStatus ||
    'active';

  const storeStatus =
    seller.storeStatus ||
    'active';

  const isSuspended =
    accountStatus === 'suspended' ||
    effectiveStatus === 'suspended';

  const isBanned =
    accountStatus === 'banned' ||
    effectiveStatus === 'banned';

  const isActive =
    effectiveStatus === 'active' &&
    !isSuspended &&
    !isBanned;

  const hasPendingAppeal = appeals.some(
    (appeal) => appeal.status === 'pending'
  );

  return (
    <div className="admin-seller-details-page">
      <div className="seller-details-header">
        <div>
          <button
            type="button"
            className="back-button"
            onClick={() => navigate('/admin/sellers')}
          >
            <ArrowLeft size={18} />
            Back to Sellers
          </button>

          <h1>Seller Details</h1>
          <p>
            Review seller information, account status and appeals.
          </p>
        </div>

        <button
          type="button"
          className="refresh-button"
          onClick={() => {
            loadSeller();
            loadAppeals();
          }}
          disabled={loading || actionLoading}
        >
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="seller-details-alert error">
          <ShieldAlert size={20} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="seller-details-alert success">
          <CheckCircle2 size={20} />
          <span>{success}</span>
        </div>
      )}

      <div className="seller-details-grid">
        <section className="seller-details-card seller-overview-card">
          <div className="seller-card-title">
            <UserRound size={20} />
            <h2>Seller Overview</h2>
          </div>

          <div className="seller-profile-heading">
            <div className="seller-avatar">
              {officialName.charAt(0).toUpperCase()}
            </div>

            <div>
              <h3>{officialName}</h3>
              <p>{email}</p>
            </div>
          </div>

          <div className="seller-status-row">
            <span className="detail-label">Application</span>

            <span
              className={`seller-status ${getStatusClass(
                sellerStatus
              )}`}
            >
              {getStatusLabel(sellerStatus)}
            </span>
          </div>

          <div className="seller-status-row">
            <span className="detail-label">Account</span>

            <span
              className={`seller-status ${getStatusClass(
                effectiveStatus
              )}`}
            >
              {getStatusLabel(effectiveStatus)}
            </span>
          </div>

          <div className="seller-status-row">
            <span className="detail-label">Store</span>

            <span
              className={`seller-status ${getStatusClass(
                storeStatus
              )}`}
            >
              {getStatusLabel(storeStatus)}
            </span>
          </div>
        </section>

        <section className="seller-details-card">
          <div className="seller-card-title">
            <Store size={20} />
            <h2>Store Information</h2>
          </div>

          <div className="seller-detail-list">
            <div className="seller-detail-item">
              <span className="detail-label">Store Name</span>
              <strong>{storeName}</strong>
            </div>

            <div className="seller-detail-item">
              <span className="detail-label">Store Description</span>
              <p>{storeProfile}</p>
            </div>

            {seller.storeLocation && (
              <div className="seller-detail-item">
                <span className="detail-label">
                  <MapPin size={15} />
                  Location
                </span>
                <p>{seller.storeLocation}</p>
              </div>
            )}
          </div>
        </section>

        <section className="seller-details-card">
          <div className="seller-card-title">
            <Phone size={20} />
            <h2>Contact Information</h2>
          </div>

          <div className="seller-detail-list">
            <div className="seller-detail-item">
              <span className="detail-label">
                <Mail size={15} />
                Email
              </span>
              <p>{email}</p>
            </div>

            <div className="seller-detail-item">
              <span className="detail-label">
                <Phone size={15} />
                Phone
              </span>
              <p>{phone}</p>
            </div>

            {profile.mpesaPhone && (
              <div className="seller-detail-item">
                <span className="detail-label">
                  M-Pesa Phone
                </span>
                <p>{profile.mpesaPhone}</p>
              </div>
            )}
          </div>
        </section>

        <section className="seller-details-card">
          <div className="seller-card-title">
            <FileText size={20} />
            <h2>Application Information</h2>
          </div>

          <div className="seller-detail-list">
            <div className="seller-detail-item">
              <span className="detail-label">
                Application Date
              </span>
              <p>{formatDate(seller.applicationDate)}</p>
            </div>

            <div className="seller-detail-item">
              <span className="detail-label">
                Reviewed At
              </span>
              <p>{formatDate(seller.reviewedAt)}</p>
            </div>

            {seller.rejectionReason && (
              <div className="seller-detail-item">
                <span className="detail-label">
                  Rejection Reason
                </span>
                <p>{seller.rejectionReason}</p>
              </div>
            )}

            {seller.suspensionReason && (
              <div className="seller-detail-item warning-detail">
                <span className="detail-label">
                  Suspension Reason
                </span>
                <p>{seller.suspensionReason}</p>
              </div>
            )}

            {seller.banReason && (
              <div className="seller-detail-item danger-detail">
                <span className="detail-label">
                  Ban Reason
                </span>
                <p>{seller.banReason}</p>
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="seller-details-card seller-actions-card">
        <div className="seller-card-title">
          <ShieldAlert size={20} />
          <h2>Seller Account Actions</h2>
        </div>

        <p className="seller-actions-description">
          These actions affect the seller's account and store
          access. They do not change the seller application status.
        </p>

        <div className="seller-actions">
          {isActive && !showSuspendForm && !showBanForm && (
            <>
              <button
                type="button"
                className="seller-action-button suspend"
                onClick={() => {
                  setError('');
                  setShowSuspendForm(true);
                  setShowBanForm(false);
                }}
                disabled={actionLoading}
              >
                <Clock3 size={18} />
                Suspend Seller
              </button>

              <button
                type="button"
                className="seller-action-button ban"
                onClick={() => {
                  setError('');
                  setShowBanForm(true);
                  setShowSuspendForm(false);
                }}
                disabled={actionLoading}
              >
                <Ban size={18} />
                Ban Seller
              </button>
            </>
          )}

          {(isSuspended || isBanned) && (
            <button
              type="button"
              className="seller-action-button reactivate"
              onClick={handleReactivate}
              disabled={actionLoading}
            >
              {actionLoading ? (
                <Loader2 className="spin" size={18} />
              ) : (
                <CheckCircle2 size={18} />
              )}
              Reactivate Seller
            </button>
          )}

          {!isActive && !isSuspended && !isBanned && (
            <p className="seller-action-note">
              Account actions are available after the seller is
              approved.
            </p>
          )}
        </div>

        {showSuspendForm && (
          <form
            className="seller-action-form"
            onSubmit={handleSuspend}
          >
            <h3>Suspend Seller</h3>

            <p>
              The seller's account will become suspended and the
              store will become inactive.
            </p>

            <textarea
              value={suspensionReason}
              onChange={(event) =>
                setSuspensionReason(event.target.value)
              }
              placeholder="Enter the reason for suspension..."
              rows={4}
              maxLength={2000}
              disabled={actionLoading}
            />

            <div className="seller-form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setShowSuspendForm(false);
                  setSuspensionReason('');
                }}
                disabled={actionLoading}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="seller-action-button suspend"
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <Loader2 className="spin" size={18} />
                ) : (
                  <Clock3 size={18} />
                )}
                Confirm Suspension
              </button>
            </div>
          </form>
        )}

        {showBanForm && (
          <form
            className="seller-action-form danger-form"
            onSubmit={handleBan}
          >
            <h3>Ban Seller</h3>

            <p>
              The seller's account will be permanently marked as
              banned until an administrator reactivates it.
            </p>

            <textarea
              value={banReason}
              onChange={(event) =>
                setBanReason(event.target.value)
              }
              placeholder="Enter the reason for banning..."
              rows={4}
              maxLength={2000}
              disabled={actionLoading}
            />

            <div className="seller-form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setShowBanForm(false);
                  setBanReason('');
                }}
                disabled={actionLoading}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="seller-action-button ban"
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <Loader2 className="spin" size={18} />
                ) : (
                  <Ban size={18} />
                )}
                Confirm Ban
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="seller-details-card seller-appeals-card">
        <div className="seller-card-title">
          <FileText size={20} />
          <h2>Seller Appeals</h2>

          {hasPendingAppeal && (
            <span className="appeal-pending-badge">
              Pending Review
            </span>
          )}
        </div>

        {appealsLoading ? (
          <div className="appeals-loading">
            <Loader2 className="spin" size={22} />
            <span>Loading appeals...</span>
          </div>
        ) : appeals.length === 0 ? (
          <div className="empty-appeals">
            <FileText size={28} />
            <p>No appeals have been submitted by this seller.</p>
          </div>
        ) : (
          <div className="appeals-list">
            {appeals.map((appeal) => {
              const appealId =
                appeal._id ||
                appeal.id ||
                '';

              return (
                <div
                  className="appeal-item"
                  key={appealId}
                >
                  <div className="appeal-item-header">
                    <div>
                      <strong>
                        {appeal.type === 'ban'
                          ? 'Ban Appeal'
                          : 'Suspension Appeal'}
                      </strong>

                      <span className="appeal-date">
                        {formatDate(appeal.createdAt)}
                      </span>
                    </div>

                    <span
                      className={`seller-status ${getStatusClass(
                        appeal.status
                      )}`}
                    >
                      {getStatusLabel(appeal.status)}
                    </span>
                  </div>

                  <div className="appeal-reason">
                    <span>Seller's Reason</span>
                    <p>{appeal.reason}</p>
                  </div>

                  {appeal.adminResponse && (
                    <div className="appeal-response">
                      <span>Admin Response</span>
                      <p>{appeal.adminResponse}</p>
                    </div>
                  )}

                  {appeal.status === 'pending' && (
                    <div className="appeal-actions">
                      <button
                        type="button"
                        className="seller-action-button reactivate"
                        onClick={() =>
                          handleApproveAppeal(appealId)
                        }
                        disabled={actionLoading}
                      >
                        {actionLoading ? (
                          <Loader2
                            className="spin"
                            size={17}
                          />
                        ) : (
                          <CheckCircle2 size={17} />
                        )}
                        Approve Appeal
                      </button>

                      <button
                        type="button"
                        className="seller-action-button ban"
                        onClick={() =>
                          handleRejectAppeal(appealId)
                        }
                        disabled={actionLoading}
                      >
                        <XCircle size={17} />
                        Reject Appeal
                      </button>
                    </div>
                  )}

                  {appeal.reviewedAt && (
                    <div className="appeal-reviewed">
                      Reviewed: {formatDate(appeal.reviewedAt)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {sellerId && (
        <div className="seller-details-footer-actions">
          <Link
            to={`/vendors/${sellerId}/products`}
            className="view-products-link"
          >
            View Seller Products
          </Link>
        </div>
      )}
    </div>
  );
}

export default AdminSellerDetailsPage;