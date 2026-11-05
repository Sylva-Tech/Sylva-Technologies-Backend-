import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FileCheck2,
  FileText,
  LockKeyhole,
  Mail,
  Phone,
  ShieldCheck,
  Store,
  Upload,
  UserRound,
} from 'lucide-react';

import api from '../services/api';
import './SellerRegisterPage.css';

function SellerRegisterPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',

    storeName: '',
    storeProfile: '',

    idFront: null,
    idBack: null,
    kraPin: null,

    agreePrivacy: false,
    agreeTerms: false,
  });

  const steps = [
    { number: 1, label: 'Account' },
    { number: 2, label: 'Store' },
    { number: 3, label: 'Verification' },
    { number: 4, label: 'Finish' },
  ];

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));

    setError('');
  };

  const validateEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  /*
   * Seller phone number must use a valid Kenyan
   * international mobile format:
   *
   * +2547XXXXXXXX
   * +2541XXXXXXXX
   *
   * Examples:
   * +254712345678
   * +254112345678
   */
  const validatePhone = (phone) => {
    const cleaned = String(phone || '')
      .trim()
      .replace(/\s+/g, '');

    return /^\+254[17]\d{8}$/.test(cleaned);
  };

  const validateStep = () => {
    setError('');

    /* =========================
       STEP 1 - ACCOUNT
    ========================== */
    if (step === 1) {
      if (!form.name.trim()) {
        setError('Please enter your official name.');
        return false;
      }

      if (!form.email.trim()) {
        setError('Please enter your email address.');
        return false;
      }

      if (!validateEmail(form.email.trim())) {
        setError('Please enter a valid email address.');
        return false;
      }

      if (!form.phone.trim()) {
        setError('Please enter your mobile phone number.');
        return false;
      }

      if (!validatePhone(form.phone)) {
        setError(
          'Please enter a valid Kenyan mobile number in international format, for example +254712345678 or +254112345678.'
        );
        return false;
      }

      if (!form.password) {
        setError('Please create a password.');
        return false;
      }

      if (form.password.length < 6) {
        setError(
          'Your password must contain at least 6 characters.'
        );
        return false;
      }

      if (!form.confirmPassword) {
        setError('Please confirm your password.');
        return false;
      }

      if (form.password !== form.confirmPassword) {
        setError('The passwords do not match.');
        return false;
      }
    }

    /* =========================
       STEP 2 - STORE
    ========================== */
    if (step === 2) {
      const storeName = form.storeName.trim();
      const storeProfile = form.storeProfile.trim();

      if (!storeName) {
        setError('Please enter your store name.');
        return false;
      }

      if (storeName.length < 2) {
        setError('Your store name is too short.');
        return false;
      }

      if (storeName.length > 100) {
        setError('Your store name cannot exceed 100 characters.');
        return false;
      }

      if (!storeProfile) {
        setError(
          'Please provide a short description of your store.'
        );
        return false;
      }

      if (storeProfile.length < 20) {
        setError(
          'Please provide a little more information about your store.'
        );
        return false;
      }
    }

    /* =========================
       STEP 3 - VERIFICATION
    ========================== */
    if (step === 3) {
      if (!form.idFront) {
        setError(
          'Please upload the front of your identification document.'
        );
        return false;
      }

      if (!form.idBack) {
        setError(
          'Please upload the back of your identification document.'
        );
        return false;
      }

      if (!form.kraPin) {
        setError('Please upload your KRA PIN document.');
        return false;
      }
    }

    /* =========================
       STEP 4 - FINISH
    ========================== */
    if (step === 4) {
      if (!form.agreePrivacy || !form.agreeTerms) {
        setError(
          'Please agree to the Privacy Policy and Terms & Conditions before submitting your application.'
        );
        return false;
      }
    }

    return true;
  };

  const nextStep = () => {
    if (!validateStep()) {
      return;
    }

    if (step < 4) {
      setStep((current) => current + 1);

      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    }
  };

  const previousStep = () => {
    setError('');

    if (step > 1) {
      setStep((current) => current - 1);

      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!validateStep()) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const formData = new FormData();

      /*
       * =========================
       * ACCOUNT INFORMATION
       * =========================
       *
       * These names must match:
       * POST /api/auth/seller/register
       */

      formData.append(
        'officialName',
        form.name.trim()
      );

      formData.append(
        'email',
        form.email.trim()
      );

      /*
       * Store the phone in the exact
       * international format required
       * by the backend.
       *
       * Accepted formats:
       * +2547XXXXXXXX
       * +2541XXXXXXXX
       */
      const normalizedPhone = String(form.phone || '')
        .trim()
        .replace(/\s+/g, '');

      formData.append(
        'mpesaPhone',
        normalizedPhone
      );

      formData.append(
        'password',
        form.password
      );

      formData.append(
        'confirmPassword',
        form.confirmPassword
      );

      /*
       * =========================
       * STORE INFORMATION
       * =========================
       */

      formData.append(
        'storeName',
        form.storeName.trim()
      );

      formData.append(
        'storeProfile',
        form.storeProfile.trim()
      );

      /*
       * =========================
       * VERIFICATION DOCUMENTS
       * =========================
       */

      formData.append(
        'idFront',
        form.idFront
      );

      formData.append(
        'idBack',
        form.idBack
      );

      formData.append(
        'kraPin',
        form.kraPin
      );

      /*
       * =========================
       * AGREEMENTS
       * =========================
       */

      formData.append(
        'privacyPolicyAccepted',
        String(form.agreePrivacy)
      );

      formData.append(
        'termsAndConditionsAccepted',
        String(form.agreeTerms)
      );

      /*
       * =========================
       * SUBMIT SELLER APPLICATION
       * =========================
       */

      const response = await api.post(
        '/auth/seller/register',
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      navigate('/seller/login', {
        replace: true,
        state: {
          registrationSuccess:
            response?.data?.message ||
            'Your seller application has been submitted successfully. Your account and store will be reviewed before seller access is approved.',
        },
      });
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          err?.response?.data?.error ||
          'We could not submit your seller application. Please check your details and try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const fileName = (file) => {
    if (!file) {
      return 'No document selected';
    }

    return file.name;
  };

  const renderFileUpload = (
    field,
    title,
    description
  ) => (
    <label
      className={`seller-file-box ${
        form[field] ? 'has-file' : ''
      }`}
    >
      <input
        type="file"
        accept=".jpg,.jpeg,.png,.webp"
        onChange={(event) =>
          updateField(
            field,
            event.target.files?.[0] || null
          )
        }
      />

      <div className="seller-file-icon">
        {form[field] ? (
          <CheckCircle2 size={22} />
        ) : (
          <Upload size={22} />
        )}
      </div>

      <div className="seller-file-content">
        <strong>{title}</strong>
        <span>{description}</span>
        <small>{fileName(form[field])}</small>
      </div>

      <div className="seller-file-action">
        {form[field] ? 'Change' : 'Upload'}
      </div>
    </label>
  );

  return (
    <main className="seller-register-page">
      <section className="seller-register-shell">

        {/* =========================
            LEFT BRAND PANEL
        ========================== */}
        <aside className="seller-register-brand">
          <Link
            to="/sell"
            className="seller-brand-logo"
          >
            <span className="seller-logo-mark">
              ST
            </span>

            <span>
              <strong>SYLVA</strong>
              <small>TECHNOLOGIES</small>
            </span>
          </Link>

          <div className="seller-brand-content">
            <span className="seller-brand-eyebrow">
              SELLER CENTRE
            </span>

            <h1>
              Build your store.
              <span>Sell your technology.</span>
            </h1>

            <p>
              Create your seller account, set up your
              store, submit your verification documents
              and wait for approval before listing
              products.
            </p>

            <div className="seller-brand-points">
              <div>
                <CheckCircle2 size={18} />
                <span>Simple seller registration</span>
              </div>

              <div>
                <ShieldCheck size={18} />
                <span>Secure verification process</span>
              </div>

              <div>
                <Store size={18} />
                <span>
                  Create your own technology store
                </span>
              </div>
            </div>

            <div className="seller-approval-flow">
              <strong>Seller journey</strong>

              <div>
                <span>1</span>
                <p>Register account</p>
              </div>

              <div>
                <span>2</span>
                <p>Create your store</p>
              </div>

              <div>
                <span>3</span>
                <p>Submit verification</p>
              </div>

              <div>
                <span>4</span>
                <p>Get approved & list products</p>
              </div>
            </div>
          </div>

          <div className="seller-brand-footer">
            <LockKeyhole size={15} />

            <span>
              Your information is handled securely.
            </span>
          </div>
        </aside>

        {/* =========================
            FORM AREA
        ========================== */}
        <section className="seller-register-content">

          {/* MOBILE LOGO */}
          <div className="seller-mobile-logo">
            <Link
              to="/sell"
              className="seller-brand-logo"
            >
              <span className="seller-logo-mark">
                ST
              </span>

              <span>
                <strong>SYLVA</strong>
                <small>TECHNOLOGIES</small>
              </span>
            </Link>
          </div>

          {/* PROGRESS */}
          <div className="seller-progress">
            {steps.map((item, index) => (
              <div
                className={`seller-progress-item ${
                  step >= item.number
                    ? 'active'
                    : ''
                }`}
                key={item.number}
              >
                <div className="seller-progress-circle">
                  {step > item.number ? (
                    <Check size={15} />
                  ) : (
                    item.number
                  )}
                </div>

                <span>{item.label}</span>

                {index < steps.length - 1 && (
                  <div
                    className={`seller-progress-line ${
                      step > item.number
                        ? 'completed'
                        : ''
                    }`}
                  />
                )}
              </div>
            ))}
          </div>

          {/* HEADER */}
          <div className="seller-form-header">
            <span>
              STEP {step} OF 4
            </span>

            {step === 1 && (
              <>
                <h2>Create your account</h2>

                <p>
                  Register using your official name,
                  active email address and mobile phone
                  number.
                </p>
              </>
            )}

            {step === 2 && (
              <>
                <h2>Create your store</h2>

                <p>
                  Give your store a professional identity
                  and tell customers what your business
                  sells.
                </p>
              </>
            )}

            {step === 3 && (
              <>
                <h2>Verify your business</h2>

                <p>
                  Upload the required identification and
                  KRA documents for seller verification.
                </p>
              </>
            )}

            {step === 4 && (
              <>
                <h2>Review and submit</h2>

                <p>
                  Check your account and store details,
                  accept our policies and submit your
                  seller application.
                </p>
              </>
            )}
          </div>

          {/* ERROR */}
          {error && (
            <div className="seller-form-error">
              <FileText size={18} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>

            {/* =========================
                STEP 1 - ACCOUNT
            ========================== */}
            {step === 1 && (
              <div className="seller-step-content">

                <div className="seller-info-note">
                  <UserRound size={19} />

                  <div>
                    <strong>
                      Use your official information
                    </strong>

                    <span>
                      Your official name should match
                      the identification document you
                      submit for verification.
                    </span>
                  </div>
                </div>

                <div className="seller-field">
                  <label htmlFor="name">
                    Official name
                  </label>

                  <div className="seller-input-wrap">
                    <UserRound size={18} />

                    <input
                      id="name"
                      type="text"
                      value={form.name}
                      onChange={(event) =>
                        updateField(
                          'name',
                          event.target.value
                        )
                      }
                      placeholder="Enter your official full name"
                      autoComplete="name"
                    />
                  </div>
                </div>

                <div className="seller-two-columns">

                  <div className="seller-field">
                    <label htmlFor="email">
                      Email address
                    </label>

                    <div className="seller-input-wrap">
                      <Mail size={18} />

                      <input
                        id="email"
                        type="email"
                        value={form.email}
                        onChange={(event) =>
                          updateField(
                            'email',
                            event.target.value
                          )
                        }
                        placeholder="you@example.com"
                        autoComplete="email"
                      />
                    </div>

                    <small>
                      Use an active email address you
                      can access.
                    </small>
                  </div>

                  <div className="seller-field">
                    <label htmlFor="phone">
                      Mobile phone number
                    </label>

                    <div className="seller-input-wrap">
                      <Phone size={18} />

                      <input
                        id="phone"
                        type="tel"
                        value={form.phone}
                        onChange={(event) =>
                          updateField(
                            'phone',
                            event.target.value
                          )
                        }
                        placeholder="+254712345678"
                        autoComplete="tel"
                        inputMode="tel"
                      />
                    </div>

                    <small>
                      Use international Kenyan format:
                      +2547XXXXXXXX or +2541XXXXXXXX.
                    </small>
                  </div>

                </div>

                <div className="seller-two-columns">

                  <div className="seller-field">
                    <label htmlFor="password">
                      Password
                    </label>

                    <div className="seller-input-wrap">
                      <LockKeyhole size={18} />

                      <input
                        id="password"
                        type="password"
                        value={form.password}
                        onChange={(event) =>
                          updateField(
                            'password',
                            event.target.value
                          )
                        }
                        placeholder="Create a password"
                        autoComplete="new-password"
                      />
                    </div>
                  </div>

                  <div className="seller-field">
                    <label htmlFor="confirmPassword">
                      Confirm password
                    </label>

                    <div className="seller-input-wrap">
                      <LockKeyhole size={18} />

                      <input
                        id="confirmPassword"
                        type="password"
                        value={form.confirmPassword}
                        onChange={(event) =>
                          updateField(
                            'confirmPassword',
                            event.target.value
                          )
                        }
                        placeholder="Repeat your password"
                        autoComplete="new-password"
                      />
                    </div>
                  </div>

                </div>

                <div className="seller-requirement-note">
                  <Check size={16} />
                  Password must contain at least 6
                  characters.
                </div>

              </div>
            )}

            {/* =========================
                STEP 2 - STORE
            ========================== */}
            {step === 2 && (
              <div className="seller-step-content">

                <div className="seller-info-note">
                  <Store size={19} />

                  <div>
                    <strong>
                      Set up your store
                    </strong>

                    <span>
                      Your store name and profile will
                      represent your business to customers
                      after your seller application is
                      approved.
                    </span>
                  </div>
                </div>

                <div className="seller-field">
                  <label htmlFor="storeName">
                    Store name
                  </label>

                  <div className="seller-input-wrap">
                    <Store size={18} />

                    <input
                      id="storeName"
                      type="text"
                      value={form.storeName}
                      onChange={(event) =>
                        updateField(
                          'storeName',
                          event.target.value
                        )
                      }
                      placeholder="e.g. Evans Tech Solutions"
                      autoComplete="organization"
                      maxLength={100}
                    />
                  </div>

                  <small>
                    Choose a professional name that
                    customers can easily identify.
                  </small>
                </div>

                <div className="seller-field">
                  <label htmlFor="storeProfile">
                    Store profile
                  </label>

                  <textarea
                    id="storeProfile"
                    value={form.storeProfile}
                    onChange={(event) =>
                      updateField(
                        'storeProfile',
                        event.target.value
                      )
                    }
                    placeholder="Tell customers what your store sells. For example: We specialize in laptops, computers, accessories, networking equipment and other technology products."
                    rows={7}
                  />

                  <small>
                    Briefly describe the products or
                    technology categories your store
                    intends to sell.
                  </small>
                </div>

                <div className="seller-store-preview">
                  <div className="seller-store-preview-icon">
                    <Store size={23} />
                  </div>

                  <div>
                    <span>STORE PREVIEW</span>

                    <strong>
                      {form.storeName ||
                        'Your Store Name'}
                    </strong>

                    <p>
                      {form.storeProfile ||
                        'Your store profile will appear here after your store is approved.'}
                    </p>
                  </div>
                </div>

                <div className="seller-verification-card">
                  <div className="seller-verification-card-icon">
                    <ShieldCheck size={22} />
                  </div>

                  <div>
                    <strong>
                      Store approval comes first
                    </strong>

                    <p>
                      Your store must be reviewed and
                      approved before you can upload and
                      publish products.
                    </p>
                  </div>
                </div>

              </div>
            )}

            {/* =========================
                STEP 3 - VERIFICATION
            ========================== */}
            {step === 3 && (
              <div className="seller-step-content">

                <div className="seller-info-note">
                  <FileCheck2 size={19} />

                  <div>
                    <strong>
                      Required verification documents
                    </strong>

                    <span>
                      Upload clear and readable copies
                      of your identification document and
                      KRA PIN document.
                    </span>
                  </div>
                </div>

                {renderFileUpload(
                  'idFront',
                  'Identification document — Front',
                  'Upload the front side of your identification document'
                )}

                {renderFileUpload(
                  'idBack',
                  'Identification document — Back',
                  'Upload the back side of your identification document'
                )}

                {renderFileUpload(
                  'kraPin',
                  'KRA PIN document',
                  'Upload your KRA PIN certificate/document'
                )}

                <div className="seller-document-security">
                  <LockKeyhole size={18} />

                  <div>
                    <strong>
                      Document security
                    </strong>

                    <p>
                      Upload genuine and readable
                      documents belonging to the seller
                      applying for this account.
                    </p>
                  </div>
                </div>

              </div>
            )}

            {/* =========================
                STEP 4 - FINISH
            ========================== */}
            {step === 4 && (
              <div className="seller-step-content">

                <div className="seller-completion-card">
                  <div className="seller-completion-icon">
                    <CheckCircle2 size={30} />
                  </div>

                  <h3>
                    Your seller application is ready
                  </h3>

                  <p>
                    Review your account, store and
                    verification information before
                    submitting your application.
                  </p>
                </div>

                <div className="seller-summary">

                  <div className="seller-summary-row">
                    <span>Official name</span>

                    <strong>
                      {form.name ||
                        'Not provided'}
                    </strong>
                  </div>

                  <div className="seller-summary-row">
                    <span>Email</span>

                    <strong>
                      {form.email ||
                        'Not provided'}
                    </strong>
                  </div>

                  <div className="seller-summary-row">
                    <span>Phone</span>

                    <strong>
                      {form.phone ||
                        'Not provided'}
                    </strong>
                  </div>

                  <div className="seller-summary-row">
                    <span>Store</span>

                    <strong>
                      {form.storeName ||
                        'Not provided'}
                    </strong>
                  </div>

                  <div className="seller-summary-row">
                    <span>Documents</span>

                    <strong>
                      {form.idFront &&
                      form.idBack &&
                      form.kraPin
                        ? '3 documents attached'
                        : 'Documents incomplete'}
                    </strong>
                  </div>

                </div>

                <div className="seller-approval-message">
                  <ShieldCheck size={21} />

                  <div>
                    <strong>
                      What happens after submission?
                    </strong>

                    <p>
                      Your seller account, store details
                      and verification documents will be
                      reviewed. Once approved, you will
                      receive seller access and can begin
                      adding products to your store.
                    </p>
                  </div>
                </div>

                <div className="seller-agreements">

                  <label className="seller-checkbox">
                    <input
                      type="checkbox"
                      checked={form.agreePrivacy}
                      onChange={(event) =>
                        updateField(
                          'agreePrivacy',
                          event.target.checked
                        )
                      }
                    />

                    <span>
                      I agree to the{' '}
                      <Link to="/privacy">
                        Privacy Policy
                      </Link>
                      .
                    </span>
                  </label>

                  <label className="seller-checkbox">
                    <input
                      type="checkbox"
                      checked={form.agreeTerms}
                      onChange={(event) =>
                        updateField(
                          'agreeTerms',
                          event.target.checked
                        )
                      }
                    />

                    <span>
                      I agree to the{' '}
                      <Link to="/terms">
                        Terms & Conditions
                      </Link>
                      .
                    </span>
                  </label>

                </div>

              </div>
            )}

            {/* =========================
                ACTION BUTTONS
            ========================== */}
            <div className="seller-form-actions">

              {step > 1 ? (
                <button
                  type="button"
                  className="seller-back-button"
                  onClick={previousStep}
                >
                  <ArrowLeft size={18} />
                  Back
                </button>
              ) : (
                <Link
                  to="/sell"
                  className="seller-back-button"
                >
                  <ArrowLeft size={18} />
                  Back
                </Link>
              )}

              {step < 4 ? (
                <button
                  type="button"
                  className="seller-next-button"
                  onClick={nextStep}
                >
                  Continue
                  <ArrowRight size={18} />
                </button>
              ) : (
                <button
                  type="submit"
                  className="seller-next-button seller-submit-button"
                  disabled={loading}
                >
                  {loading
                    ? 'Submitting...'
                    : 'Submit Application'}

                  {!loading && (
                    <CheckCircle2 size={18} />
                  )}
                </button>
              )}

            </div>
          </form>

          <div className="seller-login-footer">
            Already have a seller account?{' '}
            <Link to="/seller/login">
              Sign in
            </Link>
          </div>

          <div className="seller-security-footer">
            <LockKeyhole size={14} />
            Secure seller registration
          </div>

        </section>
      </section>
    </main>
  );
}

export default SellerRegisterPage;
