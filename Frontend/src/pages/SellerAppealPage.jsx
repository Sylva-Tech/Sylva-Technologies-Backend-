import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Send,
} from 'lucide-react';
import {
  Link,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';

import api from '../services/api';

function SellerAppealPage() {
  const navigate = useNavigate();

  const [
    searchParams,
  ] = useSearchParams();

  const type =
    searchParams.get('type') ===
    'ban'
      ? 'ban'
      : 'suspension';

  const [status, setStatus] =
    useState(null);

  const [reason, setReason] =
    useState('');

  const [loading, setLoading] =
    useState(true);

  const [submitting, setSubmitting] =
    useState(false);

  const [message, setMessage] =
    useState('');

  const [error, setError] =
    useState('');

  useEffect(() => {
    const loadStatus =
      async () => {
        try {
          const response =
            await api.get(
              '/seller-management/seller/status'
            );

          setStatus(
            response.data?.data
          );
        } catch (err) {
          setError(
            err.response?.data?.message ||
              'Unable to load seller status.'
          );
        } finally {
          setLoading(false);
        }
      };

    loadStatus();
  }, []);

  const submitAppeal = async (
    event
  ) => {
    event.preventDefault();

    if (reason.trim().length < 10) {
      setError(
        'Please provide at least 10 characters explaining your appeal.'
      );
      return;
    }

    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      const response =
        await api.post(
          '/seller-management/seller/appeals',
          {
            type,
            reason:
              reason.trim(),
          }
        );

      setMessage(
        response.data?.message ||
          'Your appeal has been submitted.'
      );

      setReason('');
    } catch (err) {
      setError(
        err.response?.data?.message ||
          'Unable to submit your appeal.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="seller-appeal-page">
        Loading...
      </main>
    );
  }

  const isBan =
    type === 'ban';

  return (
    <main className="seller-appeal-page">
      <section
        className="seller-appeal-card"
        style={{
          maxWidth: '720px',
          margin: '50px auto',
          padding: '30px',
          border: '1px solid #e0e8e3',
          borderRadius: '15px',
          background: '#fff',
        }}
      >

        <Link
          to="/seller/dashboard"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            color: '#087044',
            fontSize: '12px',
            fontWeight: 800,
            textDecoration: 'none',
            marginBottom: '25px',
          }}
        >
          <ArrowLeft size={16} />
          Back to Seller Centre
        </Link>

        <div
          style={{
            color: isBan
              ? '#a23d34'
              : '#876314',
            marginBottom: '15px',
          }}
        >
          <AlertTriangle
            size={30}
          />
        </div>

        <h1>
          {isBan
            ? 'Appeal Seller Ban'
            : 'Appeal Store Suspension'}
        </h1>

        <p
          style={{
            color: '#718078',
            fontSize: '13px',
            lineHeight: 1.6,
          }}
        >
          {isBan
            ? 'Your seller account is currently banned. Submit an appeal explaining why you believe the decision should be reviewed.'
            : 'Your store is currently inactive. Submit an appeal explaining why you believe the suspension should be reviewed.'}
        </p>

        {status && (
          <div
            style={{
              margin: '20px 0',
              padding: '15px',
              borderRadius: '10px',
              background:
                '#f5f8f6',
            }}
          >
            <strong>
              Store:{' '}
              {status.storeName ||
                'Not provided'}
            </strong>

            <div
              style={{
                marginTop: '5px',
                color: '#718078',
                fontSize: '11px',
              }}
            >
              Status:{' '}
              {String(
                status.effectiveStatus ||
                  ''
              ).toUpperCase()}
            </div>

            {status.suspensionReason && (
              <div
                style={{
                  marginTop: '8px',
                  color: '#8a6415',
                  fontSize: '11px',
                }}
              >
                Reason:{' '}
                {
                  status.suspensionReason
                }
              </div>
            )}

            {status.banReason && (
              <div
                style={{
                  marginTop: '8px',
                  color: '#9c3d34',
                  fontSize: '11px',
                }}
              >
                Reason:{' '}
                {status.banReason}
              </div>
            )}
          </div>
        )}

        {message && (
          <div
            style={{
              padding: '13px',
              marginBottom: '15px',
              borderRadius: '9px',
              background: '#e9f8ef',
              color: '#176b43',
              fontSize: '12px',
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
            }}
          >
            <CheckCircle2
              size={17}
            />
            {message}
          </div>
        )}

        {error && (
          <div
            style={{
              padding: '13px',
              marginBottom: '15px',
              borderRadius: '9px',
              background: '#fff2f0',
              color: '#9c3d34',
              fontSize: '12px',
            }}
          >
            {error}
          </div>
        )}

        <form
          onSubmit={submitAppeal}
        >
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 800,
              color: '#53635b',
              marginBottom: '7px',
            }}
          >
            Explain your appeal
          </label>

          <textarea
            value={reason}
            onChange={(event) =>
              setReason(
                event.target.value
              )
            }
            rows={8}
            placeholder="Explain the circumstances and why you believe your store/account should be reinstated..."
            style={{
              width: '100%',
              boxSizing: 'border-box',
              resize: 'vertical',
              padding: '12px',
              border: '1px solid #d8e3dd',
              borderRadius: '9px',
              outline: 'none',
              fontSize: '12px',
            }}
          />

          <button
            type="submit"
            disabled={submitting}
            style={{
              marginTop: '12px',
              minHeight: '43px',
              padding: '0 18px',
              border: 0,
              borderRadius: '8px',
              background: '#087044',
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            <Send size={16} />

            {submitting
              ? 'Submitting...'
              : 'Submit Appeal'}
          </button>
        </form>

      </section>
    </main>
  );
}

export default SellerAppealPage;

