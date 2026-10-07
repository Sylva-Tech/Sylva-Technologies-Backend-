import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import api from '../services/api';

function AdminSellerApplicationsPage() {
  const [sellers, setSellers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filter, setFilter] = useState('all');

  const [rejectingSeller, setRejectingSeller] =
    useState(null);
  const [rejectionReason, setRejectionReason] =
    useState('');

  const loadSellers = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await api.get('/admin/sellers');

      const data =
        response.data?.data ||
        response.data?.sellers ||
        [];

      setSellers(
        Array.isArray(data) ? data : []
      );
    } catch (err) {
      console.error(
        'Failed to load seller applications:',
        err
      );

      setError(
        err.response?.data?.message ||
          'Unable to load seller applications.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSellers();
  }, []);

  const approveSeller = async (sellerId) => {
    const confirmed = window.confirm(
      'Approve this seller application?'
    );

    if (!confirmed) {
      return;
    }

    setProcessingId(sellerId);
    setError('');
    setSuccess('');

    try {
      const response = await api.put(
        `/admin/sellers/${sellerId}/approve`
      );

      setSuccess(
        response.data?.message ||
          'Seller account approved successfully.'
      );

      await loadSellers();
    } catch (err) {
      console.error(
        'Seller approval failed:',
        err
      );

      setError(
        err.response?.data?.message ||
          'Unable to approve this seller.'
      );
    } finally {
      setProcessingId('');
    }
  };

  const openRejectDialog = (seller) => {
    setRejectingSeller(seller);
    setRejectionReason('');
    setError('');
    setSuccess('');
  };

  const closeRejectDialog = () => {
    if (processingId) {
      return;
    }

    setRejectingSeller(null);
    setRejectionReason('');
  };

  const rejectSeller = async () => {
    if (!rejectingSeller?._id) {
      return;
    }

    const reason = rejectionReason.trim();

    if (!reason) {
      setError(
        'Please provide a rejection reason.'
      );
      return;
    }

    setProcessingId(rejectingSeller._id);
    setError('');
    setSuccess('');

    try {
      const response = await api.put(
        `/admin/sellers/${rejectingSeller._id}/reject`,
        {
          reason,
        }
      );

      setSuccess(
        response.data?.message ||
          'Seller application rejected.'
      );

      setRejectingSeller(null);
      setRejectionReason('');

      await loadSellers();
    } catch (err) {
      console.error(
        'Seller rejection failed:',
        err
      );

      setError(
        err.response?.data?.message ||
          'Unable to reject this seller.'
      );
    } finally {
      setProcessingId('');
    }
  };

  const formatDate = (date) => {
    if (!date) {
      return 'Not provided';
    }

    const parsedDate = new Date(date);

    if (Number.isNaN(parsedDate.getTime())) {
      return 'Not provided';
    }

    return parsedDate.toLocaleDateString(
      'en-KE',
      {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }
    );
  };

  const formatTime = (date) => {
    if (!date) {
      return 'Not provided';
    }

    const parsedDate = new Date(date);

    if (Number.isNaN(parsedDate.getTime())) {
      return 'Not provided';
    }

    return parsedDate.toLocaleTimeString(
      'en-KE',
      {
        hour: '2-digit',
        minute: '2-digit',
      }
    );
  };

  const getSellerName = (seller) =>
    seller.sellerProfile?.officialName ||
    seller.name ||
    'Unnamed applicant';

  const getStoreName = (seller) =>
    seller.sellerProfile?.storeName ||
    'Not provided';

  const getEmail = (seller) =>
    seller.sellerProfile?.storeEmail ||
    seller.email ||
    'Not provided';

  const getPhone = (seller) =>
    seller.sellerProfile?.storePhone ||
    seller.phone ||
    'Not provided';

  const getApplicationDate = (seller) =>
    seller.sellerProfile?.applicationDate ||
    seller.createdAt;

  const getRejectionReason = (seller) =>
    seller.sellerProfile?.rejectionReason ||
    seller.rejectionReason ||
    '';

  const filteredSellers = useMemo(() => {
    if (filter === 'all') {
      return sellers;
    }

    return sellers.filter(
      (seller) =>
        seller.sellerStatus === filter
    );
  }, [sellers, filter]);

  const counts = useMemo(
    () => ({
      all: sellers.length,
      pending: sellers.filter(
        (seller) =>
          seller.sellerStatus === 'pending'
      ).length,
      approved: sellers.filter(
        (seller) =>
          seller.sellerStatus === 'approved'
      ).length,
      rejected: sellers.filter(
        (seller) =>
          seller.sellerStatus === 'rejected'
      ).length,
    }),
    [sellers]
  );

  const downloadExcel = () => {
    if (!filteredSellers.length) {
      setError(
        'There are no seller applications to download.'
      );
      return;
    }

    const rows = filteredSellers.map(
      (seller) => ({
        Name: getSellerName(seller),
        Email: getEmail(seller),
        Phone: getPhone(seller),
        'Store Name': getStoreName(seller),
        Status: seller.sellerStatus || '',
        'Date Created': seller.createdAt
          ? formatDate(seller.createdAt)
          : '',
        'Time Created': seller.createdAt
          ? formatTime(seller.createdAt)
          : '',
        'Application Date':
          getApplicationDate(seller)
            ? formatDate(
                getApplicationDate(seller)
              )
            : '',
        'Reviewed Date':
          seller.sellerProfile?.reviewedAt
            ? formatDate(
                seller.sellerProfile
                  .reviewedAt
              )
            : '',
        'Rejection Reason':
          getRejectionReason(seller),
      })
    );

    const worksheet =
      XLSX.utils.json_to_sheet(rows);

    const workbook =
      XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      'Seller Applications'
    );

    XLSX.writeFile(
      workbook,
      `Sylva-Seller-Applications-${filter}-${Date.now()}.xlsx`
    );

    setSuccess(
      'Seller application list downloaded successfully.'
    );
    setError('');
  };

  return (
    <section
      className="container section-block"
      style={{
        paddingBottom: '50px',
      }}
    >
      <div
        className="section-head"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '15px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2>Seller Applications</h2>

          <p>
            Review and manage vendor applications
            for Sylva Technologies.
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <Link
            to="/admin"
            className="secondary-btn"
          >
            Back to Dashboard
          </Link>

          <button
            type="button"
            className="primary-btn"
            onClick={downloadExcel}
            disabled={!filteredSellers.length}
          >
            Download Excel
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            marginTop: '20px',
            padding: '12px 15px',
            borderRadius: '8px',
            background: '#fee2e2',
            color: '#991b1b',
          }}
        >
          {error}
        </div>
      )}

      {success && (
        <div
          style={{
            marginTop: '20px',
            padding: '12px 15px',
            borderRadius: '8px',
            background: '#dcfce7',
            color: '#166534',
          }}
        >
          {success}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: '10px',
          flexWrap: 'wrap',
          marginTop: '25px',
          marginBottom: '20px',
        }}
      >
        {[
          ['all', 'All'],
          ['pending', 'Pending'],
          ['approved', 'Approved'],
          ['rejected', 'Rejected'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setFilter(value);
              setError('');
              setSuccess('');
            }}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              border: '1px solid #d1d5db',
              cursor: 'pointer',
              fontWeight: '600',
              background:
                filter === value
                  ? '#166534'
                  : '#ffffff',
              color:
                filter === value
                  ? '#ffffff'
                  : '#374151',
            }}
          >
            {label} ({counts[value]})
          </button>
        ))}
      </div>

      {loading ? (
        <div
          style={{
            padding: '40px 10px',
            textAlign: 'center',
          }}
        >
          Loading seller applications...
        </div>
      ) : filteredSellers.length === 0 ? (
        <div
          style={{
            padding: '40px 20px',
            textAlign: 'center',
            border: '1px solid #e5e7eb',
            borderRadius: '12px',
          }}
        >
          <h3>No seller applications</h3>

          <p>
            There are no {filter === 'all'
              ? ''
              : filter}{' '}
            seller applications to display.
          </p>
        </div>
      ) : (
        <div
          style={{
            overflowX: 'auto',
            border: '1px solid #e5e7eb',
            borderRadius: '12px',
            background: '#ffffff',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              minWidth: '1200px',
            }}
          >
            <thead>
              <tr
                style={{
                  background: '#f3f4f6',
                }}
              >
                <th style={thStyle}>
                  Name
                </th>

                <th style={thStyle}>
                  Email
                </th>

                <th style={thStyle}>
                  Phone
                </th>

                <th style={thStyle}>
                  Store
                </th>

                <th style={thStyle}>
                  Date Created
                </th>

                <th style={thStyle}>
                  Time
                </th>

                <th style={thStyle}>
                  Status
                </th>

                <th style={thStyle}>
                  Reviewed
                </th>

                {filter === 'rejected' && (
                  <th style={thStyle}>
                    Rejection Reason
                  </th>
                )}

                <th style={thStyle}>
                  Actions
                </th>
              </tr>
            </thead>

            <tbody>
              {filteredSellers.map(
                (seller) => {
                  const sellerId =
                    seller._id ||
                    seller.id;

                  const isProcessing =
                    processingId === sellerId;

                  return (
                    <tr
                      key={sellerId}
                      style={{
                        borderTop:
                          '1px solid #e5e7eb',
                      }}
                    >
                      <td style={tdStyle}>
                        <strong>
                          {getSellerName(
                            seller
                          )}
                        </strong>
                      </td>

                      <td style={tdStyle}>
                        {getEmail(seller)}
                      </td>

                      <td style={tdStyle}>
                        {getPhone(seller)}
                      </td>

                      <td style={tdStyle}>
                        {getStoreName(
                          seller
                        )}
                      </td>

                      <td style={tdStyle}>
                        {formatDate(
                          seller.createdAt
                        )}
                      </td>

                      <td style={tdStyle}>
                        {formatTime(
                          seller.createdAt
                        )}
                      </td>

                      <td style={tdStyle}>
                        <StatusBadge
                          status={
                            seller.sellerStatus
                          }
                        />
                      </td>

                      <td style={tdStyle}>
                        {formatDate(
                          seller.sellerProfile
                            ?.reviewedAt
                        )}
                      </td>

                      {filter ===
                        'rejected' && (
                        <td
                          style={{
                            ...tdStyle,
                            maxWidth: '250px',
                          }}
                        >
                          {getRejectionReason(
                            seller
                          ) || 'No reason provided'}
                        </td>
                      )}

                      <td style={tdStyle}>
                        <div
                          style={{
                            display: 'flex',
                            gap: '7px',
                            flexWrap: 'wrap',
                          }}
                        >
                          <Link
                            to={`/admin/sellers/${sellerId}`}
                            className="secondary-btn"
                            style={{
                              textDecoration:
                                'none',
                            }}
                          >
                            View
                          </Link>

                          {seller.sellerStatus ===
                            'pending' && (
                            <>
                              <button
                                type="button"
                                className="primary-btn"
                                disabled={
                                  isProcessing
                                }
                                onClick={() =>
                                  approveSeller(
                                    sellerId
                                  )
                                }
                              >
                                {isProcessing
                                  ? 'Processing...'
                                  : 'Approve'}
                              </button>

                              <button
                                type="button"
                                className="secondary-btn"
                                disabled={
                                  isProcessing
                                }
                                onClick={() =>
                                  openRejectDialog(
                                    seller
                                  )
                                }
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                }
              )}
            </tbody>
          </table>
        </div>
      )}

      {rejectingSeller && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background:
              'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '520px',
              background: '#ffffff',
              borderRadius: '12px',
              padding: '25px',
            }}
          >
            <h3>
              Reject Seller Application
            </h3>

            <p>
              Applicant:{' '}
              <strong>
                {getSellerName(
                  rejectingSeller
                )}
              </strong>
            </p>

            <label
              htmlFor="rejectionReason"
              style={{
                display: 'block',
                marginTop: '15px',
                marginBottom: '8px',
                fontWeight: '600',
              }}
            >
              Reason for rejection
            </label>

            <textarea
              id="rejectionReason"
              value={rejectionReason}
              onChange={(event) =>
                setRejectionReason(
                  event.target.value
                )
              }
              rows={5}
              placeholder="Explain what the seller needs to correct before resubmitting."
              style={{
                width: '100%',
                padding: '12px',
                border:
                  '1px solid #d1d5db',
                borderRadius: '8px',
                resize: 'vertical',
              }}
            />

            <div
              style={{
                display: 'flex',
                justifyContent:
                  'flex-end',
                gap: '10px',
                marginTop: '18px',
              }}
            >
              <button
                type="button"
                className="secondary-btn"
                onClick={closeRejectDialog}
                disabled={!!processingId}
              >
                Cancel
              </button>

              <button
                type="button"
                className="primary-btn"
                onClick={rejectSeller}
                disabled={
                  !!processingId ||
                  !rejectionReason.trim()
                }
              >
                {processingId
                  ? 'Rejecting...'
                  : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

const thStyle = {
  padding: '14px',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  fontSize: '14px',
};

const tdStyle = {
  padding: '14px',
  verticalAlign: 'top',
  fontSize: '14px',
};

function StatusBadge({ status }) {
  const background =
    status === 'approved'
      ? '#dcfce7'
      : status === 'rejected'
      ? '#fee2e2'
      : '#fef3c7';

  const color =
    status === 'approved'
      ? '#166534'
      : status === 'rejected'
      ? '#991b1b'
      : '#92400e';

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '5px 9px',
        borderRadius: '999px',
        background,
        color,
        fontWeight: '700',
        fontSize: '12px',
        textTransform: 'capitalize',
      }}
    >
      {status || 'unknown'}
    </span>
  );
}

export default AdminSellerApplicationsPage;