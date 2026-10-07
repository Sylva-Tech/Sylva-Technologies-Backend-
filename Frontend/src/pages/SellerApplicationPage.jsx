import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

function SellerApplicationPage() {
  const [application, setApplication] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState('');

  const [success, setSuccess] =
    useState('');

  const [form, setForm] = useState({
    officialName: '',
    idType: '',
    idNumber: '',
    dateOfBirth: '',
    storeName: '',
    storeEmail: '',
    storePhone: '',
    mpesaPhone: '',
    kraPin: '',
    storeLocation: '',
  });

  const [files, setFiles] = useState({
    idFront: null,
    idBack: null,
    kraPin: null,
  });

  const loadApplication = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await api.get(
        '/users/seller/application'
      );

      const data =
        response.data?.data;

      if (!data) {
        throw new Error(
          'Seller application data was not returned.'
        );
      }

      setApplication(data);

      const profile =
        data.sellerProfile || {};

      setForm({
        officialName:
          profile.officialName ||
          data.name ||
          '',

        idType:
          profile.idType || '',

        idNumber:
          profile.idNumber || '',

        dateOfBirth:
          profile.dateOfBirth
            ? String(
                profile.dateOfBirth
              ).slice(0, 10)
            : '',

        storeName:
          profile.storeName || '',

        storeEmail:
          profile.storeEmail ||
          data.email ||
          '',

        storePhone:
          profile.storePhone ||
          data.phone ||
          '',

        mpesaPhone:
          profile.mpesaPhone ||
          data.phone ||
          '',

        kraPin:
          profile.kraPin || '',

        storeLocation:
          profile.storeLocation || '',
      });

      /*
       * Clear any previously selected
       * replacement files after loading
       * the application.
       */
      setFiles({
        idFront: null,
        idBack: null,
        kraPin: null,
      });
    } catch (err) {
      console.error(
        'Failed to load seller application:',
        err
      );

      setError(
        err.response?.data?.message ||
          err.message ||
          'Unable to load your seller application.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApplication();
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleFileChange = (event) => {
    const { name, files: selectedFiles } =
      event.target;

    const selectedFile =
      selectedFiles?.[0] || null;

    setFiles((current) => ({
      ...current,
      [name]: selectedFile,
    }));
  };

  const submitResubmission = async (
    event
  ) => {
    event.preventDefault();

    setError('');
    setSuccess('');

    if (
      !form.officialName.trim() ||
      !form.idType ||
      !form.idNumber.trim() ||
      !form.storeName.trim() ||
      !form.mpesaPhone.trim()
    ) {
      setError(
        'Please complete all required fields.'
      );
      return;
    }

    setSaving(true);

    try {
      /*
       * The backend expects multipart/form-data
       * because the seller may upload replacement
       * documents.
       */
      const formData = new FormData();

      formData.append(
        'officialName',
        form.officialName.trim()
      );

      formData.append(
        'idType',
        form.idType
      );

      formData.append(
        'idNumber',
        form.idNumber.trim()
      );

      if (form.dateOfBirth) {
        formData.append(
          'dateOfBirth',
          form.dateOfBirth
        );
      }

      formData.append(
        'storeName',
        form.storeName.trim()
      );

      formData.append(
        'storeEmail',
        form.storeEmail.trim()
      );

      formData.append(
        'storePhone',
        form.storePhone.trim()
      );

      formData.append(
        'mpesaPhone',
        form.mpesaPhone.trim()
      );

      formData.append(
        'kraPin',
        form.kraPin.trim()
      );

      formData.append(
        'storeLocation',
        form.storeLocation.trim()
      );

      /*
       * Only append a document when the seller
       * selected a new replacement file.
       */
      if (files.idFront) {
        formData.append(
          'idFront',
          files.idFront
        );
      }

      if (files.idBack) {
        formData.append(
          'idBack',
          files.idBack
        );
      }

      if (files.kraPin) {
        formData.append(
          'kraPin',
          files.kraPin
        );
      }

      const response = await api.put(
        '/users/seller/application/resubmit',
        formData
      );

      setSuccess(
        response.data?.message ||
          'Your application has been resubmitted successfully.'
      );

      /*
       * Reload the application so the page
       * immediately changes from rejected
       * to pending.
       */
      await loadApplication();
    } catch (err) {
      console.error(
        'Seller application resubmission failed:',
        err
      );

      setError(
        err.response?.data?.message ||
          'Unable to resubmit your application.'
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="container section-block">
        <p>
          Loading your seller application...
        </p>
      </section>
    );
  }

  if (!application) {
    return (
      <section className="container section-block">
        <h2>Seller Application</h2>

        <div
          style={{
            marginTop: '20px',
            padding: '15px',
            background: '#fee2e2',
            color: '#991b1b',
            borderRadius: '8px',
          }}
        >
          {error ||
            'Seller application not found.'}
        </div>
      </section>
    );
  }

  const status =
    application.sellerStatus;

  if (status === 'approved') {
    return (
      <section className="container section-block">
        <h2>
          Seller Application Approved
        </h2>

        <p>
          Your seller application has been
          approved.
        </p>

        <Link
          to="/seller/dashboard"
          className="primary-btn"
        >
          Go to Seller Dashboard
        </Link>
      </section>
    );
  }

  if (status === 'pending') {
    return (
      <section className="container section-block">
        <h2>
          Seller Application Under Review
        </h2>

        <div
          style={{
            marginTop: '20px',
            padding: '20px',
            borderRadius: '10px',
            background: '#fef3c7',
            color: '#92400e',
          }}
        >
          <strong>
            Your application is pending review.
          </strong>

          <p>
            Our administration team will review
            your seller application and update
            its status.
          </p>
        </div>

        <p>
          Application submitted:{' '}
          {application.sellerProfile
            ?.applicationDate
            ? new Date(
                application.sellerProfile
                  .applicationDate
              ).toLocaleString('en-KE')
            : 'Not available'}
        </p>
      </section>
    );
  }

  return (
    <section className="container section-block">
      <div
        style={{
          maxWidth: '850px',
          margin: '0 auto',
        }}
      >
        <h2>
          Seller Application Rejected
        </h2>

        <div
          style={{
            marginTop: '20px',
            padding: '18px',
            borderRadius: '10px',
            background: '#fee2e2',
            color: '#991b1b',
          }}
        >
          <strong>
            Your seller application needs
            changes.
          </strong>

          <p
            style={{
              marginBottom: 0,
            }}
          >
            Please review the reason below,
            correct the required information,
            and resubmit your application.
          </p>
        </div>

        <div
          style={{
            marginTop: '20px',
            padding: '18px',
            borderRadius: '10px',
            border:
              '1px solid #fecaca',
            background: '#fff7f7',
          }}
        >
          <strong>
            Rejection reason
          </strong>

          <p>
            {application.sellerProfile
              ?.rejectionReason ||
              'No rejection reason was provided.'}
          </p>

          {application.sellerProfile
            ?.reviewedAt && (
            <small>
              Reviewed:{' '}
              {new Date(
                application.sellerProfile
                  .reviewedAt
              ).toLocaleString('en-KE')}
            </small>
          )}
        </div>

        {error && (
          <div
            style={{
              marginTop: '20px',
              padding: '12px',
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
              padding: '12px',
              borderRadius: '8px',
              background: '#dcfce7',
              color: '#166534',
            }}
          >
            {success}
          </div>
        )}

        <form
          onSubmit={submitResubmission}
          style={{
            marginTop: '30px',
          }}
        >
          <h3>
            Correct Your Application
          </h3>

          <div
            style={formGridStyle}
          >
            <FormField
              label="Official Name *"
              name="officialName"
              value={form.officialName}
              onChange={handleChange}
            />

            <div>
              <label style={labelStyle}>
                Identification Type *
              </label>

              <select
                name="idType"
                value={form.idType}
                onChange={handleChange}
                style={inputStyle}
              >
                <option value="">
                  Select identification type
                </option>

                <option value="national_id">
                  National ID
                </option>

                <option value="passport">
                  Passport
                </option>

                <option value="military_id">
                  Military ID
                </option>

                <option value="other">
                  Other
                </option>
              </select>
            </div>

            <FormField
              label="ID / Passport Number *"
              name="idNumber"
              value={form.idNumber}
              onChange={handleChange}
            />

            <FormField
              label="Date of Birth"
              name="dateOfBirth"
              type="date"
              value={form.dateOfBirth}
              onChange={handleChange}
            />

            <FormField
              label="Store Name *"
              name="storeName"
              value={form.storeName}
              onChange={handleChange}
            />

            <FormField
              label="Store Email"
              name="storeEmail"
              type="email"
              value={form.storeEmail}
              onChange={handleChange}
            />

            <FormField
              label="Store Phone"
              name="storePhone"
              value={form.storePhone}
              onChange={handleChange}
            />

            <FormField
              label="M-Pesa Phone *"
              name="mpesaPhone"
              value={form.mpesaPhone}
              onChange={handleChange}
            />

            <FormField
              label="KRA PIN"
              name="kraPin"
              value={form.kraPin}
              onChange={handleChange}
            />

            <FormField
              label="Store Location"
              name="storeLocation"
              value={form.storeLocation}
              onChange={handleChange}
            />
          </div>

          {/* ---------------------------------------------------------
              DOCUMENT REPLACEMENT
          ---------------------------------------------------------- */}

          <div
            style={{
              marginTop: '30px',
              padding: '20px',
              borderRadius: '12px',
              border:
                '1px solid #d1d5db',
              background: '#f9fafb',
            }}
          >
            <h3
              style={{
                marginTop: 0,
                marginBottom: '8px',
              }}
            >
              Identity & Tax Documents
            </h3>

            <p
              style={{
                marginTop: 0,
                color: '#4b5563',
                fontSize: '14px',
                lineHeight: 1.5,
              }}
            >
              Upload new documents only if you
              need to replace the documents from
              your previous application. Existing
              documents will remain attached if
              you do not select a replacement.
            </p>

            <div
              style={documentGridStyle}
            >
              <FileField
                label="ID Front"
                name="idFront"
                file={files.idFront}
                onChange={handleFileChange}
              />

              <FileField
                label="ID Back"
                name="idBack"
                file={files.idBack}
                onChange={handleFileChange}
              />

              <FileField
                label="KRA PIN Document"
                name="kraPin"
                file={files.kraPin}
                onChange={handleFileChange}
              />
            </div>
          </div>

          <div
            style={{
              marginTop: '25px',
              display: 'flex',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="submit"
              className="primary-btn"
              disabled={saving}
            >
              {saving
                ? 'Resubmitting...'
                : 'Resubmit Application'}
            </button>

            <Link
              to="/"
              className="secondary-btn"
              style={{
                textDecoration:
                  'none',
              }}
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </section>
  );
}

function FormField({
  label,
  name,
  type = 'text',
  value,
  onChange,
}) {
  return (
    <div>
      <label style={labelStyle}>
        {label}
      </label>

      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        style={inputStyle}
      />
    </div>
  );
}

function FileField({
  label,
  name,
  file,
  onChange,
}) {
  return (
    <div
      style={{
        padding: '16px',
        borderRadius: '10px',
        background: '#ffffff',
        border:
          '1px solid #d1d5db',
      }}
    >
      <label style={labelStyle}>
        {label}
      </label>

      <input
        type="file"
        name={name}
        onChange={onChange}
        accept="image/*,.pdf"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '8px 0',
        }}
      />

      <div
        style={{
          marginTop: '8px',
          fontSize: '13px',
          color: file
            ? '#166534'
            : '#6b7280',
          wordBreak: 'break-word',
        }}
      >
        {file
          ? `Selected: ${file.name}`
          : 'No new file selected'}
      </div>
    </div>
  );
}

const formGridStyle = {
  display: 'grid',
  gridTemplateColumns:
    'repeat(auto-fit, minmax(250px, 1fr))',
  gap: '18px',
  marginTop: '20px',
};

const documentGridStyle = {
  display: 'grid',
  gridTemplateColumns:
    'repeat(auto-fit, minmax(230px, 1fr))',
  gap: '16px',
  marginTop: '18px',
};

const labelStyle = {
  display: 'block',
  marginBottom: '7px',
  fontWeight: '600',
};

const inputStyle = {
  width: '100%',
  padding: '11px 12px',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  boxSizing: 'border-box',
};

export default SellerApplicationPage;

