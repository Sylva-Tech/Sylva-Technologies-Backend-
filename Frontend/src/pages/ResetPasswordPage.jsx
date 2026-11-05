import { useEffect, useState } from 'react';
import {
  Link,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';

import api from '../services/api';

const initialPasswordState = {
  password: '',
  confirmPassword: '',
};

const RESET_TOKEN_STORAGE_KEY =
  'sylva_password_reset_token';

const RESET_EMAIL_STORAGE_KEY =
  'sylva_password_reset_email';

function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  /*
   * Token and email may come from the password-reset
   * email link.
   */
  const initialEmail =
    searchParams.get('email') || '';

  const linkToken =
    searchParams.get('token') || '';

  const [email, setEmail] =
    useState(initialEmail);

  const [code, setCode] =
    useState('');

  const [passwordForm, setPasswordForm] =
    useState(initialPasswordState);

  const [verifiedToken, setVerifiedToken] =
    useState(() => {
      try {
        return (
          sessionStorage.getItem(
            RESET_TOKEN_STORAGE_KEY
          ) || ''
        );
      } catch {
        return '';
      }
    });

  const [step, setStep] = useState(() => {
    try {
      const savedToken =
        sessionStorage.getItem(
          RESET_TOKEN_STORAGE_KEY
        );

      return savedToken
        ? 'password'
        : 'code';
    } catch {
      return 'code';
    }
  });

  const [error, setError] =
    useState('');

  const [success, setSuccess] =
    useState('');

  const [loading, setLoading] =
    useState(false);

  const [showPassword, setShowPassword] =
    useState(false);

  const [showConfirmPassword, setShowConfirmPassword] =
    useState(false);

  /*
   * Keep the email synchronized with the URL.
   */
  useEffect(() => {
    if (initialEmail) {
      setEmail(initialEmail);

      try {
        sessionStorage.setItem(
          RESET_EMAIL_STORAGE_KEY,
          initialEmail
        );
      } catch {
        // Ignore storage errors.
      }
    }
  }, [initialEmail]);

  /*
   * If there is no email in the URL, recover
   * the previously entered email from sessionStorage.
   */
  useEffect(() => {
    if (!initialEmail) {
      try {
        const savedEmail =
          sessionStorage.getItem(
            RESET_EMAIL_STORAGE_KEY
          );

        if (savedEmail) {
          setEmail(savedEmail);
        }
      } catch {
        // Ignore storage errors.
      }
    }
  }, [initialEmail]);

  /*
   * If the page contains a token in the URL but there
   * is no verified session token, keep the user on the
   * code verification step.
   */
  useEffect(() => {
    if (linkToken && !verifiedToken) {
      setStep('code');
    }
  }, [linkToken, verifiedToken]);

  /*
   * Verify the 6-digit reset code.
   */
  const verifyCode = async (event) => {
    event.preventDefault();

    setError('');
    setSuccess('');

    const normalizedEmail =
      email.trim().toLowerCase();

    const normalizedCode =
      code.trim();

    if (!normalizedEmail) {
      setError(
        'Please enter the email address associated with your account.'
      );
      return;
    }

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        normalizedEmail
      )
    ) {
      setError(
        'Please enter a valid email address.'
      );
      return;
    }

    if (!/^\d{6}$/.test(normalizedCode)) {
      setError(
        'Please enter the 6-digit reset code from your email.'
      );
      return;
    }

    setLoading(true);

    try {
      /*
       * Save the email so it survives a refresh.
       */
      try {
        sessionStorage.setItem(
          RESET_EMAIL_STORAGE_KEY,
          normalizedEmail
        );
      } catch {
        // Ignore storage errors.
      }

      /*
       * Send the code to the backend.
       */
      const response = await api.post(
        '/auth/verify-password-reset-code',
        {
          email: normalizedEmail,
          code: normalizedCode,
          token: linkToken || undefined,
        }
      );

      /*
       * The backend returns:
       *
       * {
       *   message: 'Reset code verified successfully.',
       *   resetToken: '...'
       * }
       */
      const newResetToken =
        response.data?.resetToken;

      if (
        !newResetToken ||
        typeof newResetToken !== 'string'
      ) {
        console.error(
          'Password reset verification response:',
          response.data
        );

        throw new Error(
          'The server did not return a valid password reset token.'
        );
      }

      /*
       * Save the actual verified token.
       */
      setVerifiedToken(newResetToken);

      try {
        sessionStorage.setItem(
          RESET_TOKEN_STORAGE_KEY,
          newResetToken
        );
      } catch {
        // Ignore storage errors.
      }

      /*
       * Move to password step only after receiving
       * a valid reset token.
       */
      setStep('password');

      setSuccess(
        'Code verified. You can now create your new password.'
      );
    } catch (err) {
      console.error(
        'Verify password reset code error:',
        err
      );

      setError(
        err.response?.data?.message ||
          err.message ||
          'We could not verify the reset code.'
      );
    } finally {
      setLoading(false);
    }
  };

  /*
   * Handle password fields.
   */
  const handlePasswordChange = (event) => {
    const { name, value } =
      event.target;

    setPasswordForm((current) => ({
      ...current,
      [name]: value,
    }));
  };

  /*
   * Reset the password.
   */
  const resetPassword = async (event) => {
    event.preventDefault();

    setError('');
    setSuccess('');

    const password =
      passwordForm.password;

    const confirmPassword =
      passwordForm.confirmPassword;

    /*
     * First try the React state token.
     */
    let resetToken =
      verifiedToken?.trim() || '';

    /*
     * If React state is empty, recover the token
     * from sessionStorage.
     */
    if (!resetToken) {
      try {
        resetToken =
          sessionStorage.getItem(
            RESET_TOKEN_STORAGE_KEY
          )?.trim() || '';
      } catch {
        resetToken = '';
      }
    }

    /*
     * Do NOT fall back to the original link token
     * after code verification.
     *
     * The backend requires the short-lived
     * password-reset-verified token.
     */
    if (!resetToken) {
      setError(
        'Your password reset session is invalid or has expired. Please request a new reset code.'
      );
      return;
    }

    /*
     * Validate the new password.
     */
    if (!password) {
      setError(
        'Please enter your new password.'
      );
      return;
    }

    if (password.length < 6) {
      setError(
        'Password must be at least 6 characters long.'
      );
      return;
    }

    if (!confirmPassword) {
      setError(
        'Please confirm your new password.'
      );
      return;
    }

    if (password !== confirmPassword) {
      setError(
        'Passwords do not match.'
      );
      return;
    }

    setLoading(true);

    try {
      const resetPayload = {
        token: resetToken,
        password,
        confirmPassword,
      };

      /*
       * Debug information without exposing the
       * actual reset token.
       */
      console.log(
        'Submitting password reset:',
        {
          hasToken:
            Boolean(resetPayload.token),

          tokenLength:
            resetPayload.token.length,

          hasPassword:
            Boolean(resetPayload.password),

          passwordLength:
            resetPayload.password.length,

          hasConfirmPassword:
            Boolean(
              resetPayload.confirmPassword
            ),
        }
      );

      const response = await api.post(
        '/auth/reset-password',
        resetPayload
      );

      /*
       * IMPORTANT:
       * The backend successfully changed the password.
       * Now show a clear success message.
       */
      setError('');

      setSuccess(
        response.data?.message ||
          'Password reset successfully!'
      );

      /*
       * Clear the password fields.
       */
      setPasswordForm(
        initialPasswordState
      );

      /*
       * Clear the reset token from React state.
       */
      setVerifiedToken('');

      /*
       * Clear the reset session from storage.
       */
      try {
        sessionStorage.removeItem(
          RESET_TOKEN_STORAGE_KEY
        );

        sessionStorage.removeItem(
          RESET_EMAIL_STORAGE_KEY
        );
      } catch {
        // Ignore storage errors.
      }

      /*
       * Keep the success message visible for
       * 2 seconds, then return to login.
       */
      setTimeout(() => {
        navigate('/login', {
          replace: true,
          state: {
            passwordResetSuccess:
              'Password reset successful. Please login with your new password.',
          },
        });
      }, 1500);
    } catch (err) {
      console.error(
        'Reset password error:',
        err
      );

      setError(
        err.response?.data?.message ||
          err.message ||
          'We could not reset your password. Your reset session may have expired.'
      );
    } finally {
      setLoading(false);
    }
  };

  /*
   * Start a completely new reset session.
   */
  const startNewReset = () => {
    setVerifiedToken('');

    setCode('');

    setPasswordForm(
      initialPasswordState
    );

    setError('');

    setSuccess('');

    setStep('code');

    try {
      sessionStorage.removeItem(
        RESET_TOKEN_STORAGE_KEY
      );
    } catch {
      // Ignore storage errors.
    }
  };

  return (
    <section className="container section-block auth-page">
      <div className="auth-card">

        <div className="auth-intro">
          <span className="eyebrow">
            Account recovery
          </span>

          {step === 'code' ? (
            <>
              <h2>
                Verify reset code
              </h2>

              <p>
                Enter the 6-digit code sent to
                your email address to continue.
              </p>
            </>
          ) : (
            <>
              <h2>
                Create a new password
              </h2>

              <p>
                Your reset code has been
                verified. Choose a new password
                for your account.
              </p>
            </>
          )}
        </div>

        {step === 'code' && (
          <form
            onSubmit={verifyCode}
            className="auth-form"
          >
            <div className="form-group">
              <label htmlFor="email">
                Email address
              </label>

              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(
                    event.target.value
                  )
                }
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="code">
                6-digit reset code
              </label>

              <input
                id="code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => {
                  const value =
                    event.target.value
                      .replace(/\D/g, '')
                      .slice(0, 6);

                  setCode(value);
                }}
                placeholder="123456"
                autoComplete="one-time-code"
                required
              />
            </div>

            {error && (
              <p className="auth-error">
                {error}
              </p>
            )}

            {success && (
              <p className="auth-success">
                {success}
              </p>
            )}

            <button
              type="submit"
              className="primary-btn full-btn"
              disabled={loading}
            >
              {loading
                ? 'Verifying...'
                : 'Verify code'}
            </button>
          </form>
        )}

        {step === 'password' && (
          <form
            onSubmit={resetPassword}
            className="auth-form"
          >
            <div className="form-group">
              <label htmlFor="password">
                New password
              </label>

              <div
                style={{
                  position: 'relative',
                }}
              >
                <input
                  id="password"
                  type={
                    showPassword
                      ? 'text'
                      : 'password'
                  }
                  name="password"
                  value={
                    passwordForm.password
                  }
                  onChange={
                    handlePasswordChange
                  }
                  placeholder="Enter your new password"
                  autoComplete="new-password"
                  required
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowPassword(
                      (current) =>
                        !current
                    )
                  }
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: 8,
                  }}
                >
                  {showPassword
                    ? 'Hide'
                    : 'Show'}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="confirmPassword">
                Confirm new password
              </label>

              <div
                style={{
                  position: 'relative',
                }}
              >
                <input
                  id="confirmPassword"
                  type={
                    showConfirmPassword
                      ? 'text'
                      : 'password'
                  }
                  name="confirmPassword"
                  value={
                    passwordForm.confirmPassword
                  }
                  onChange={
                    handlePasswordChange
                  }
                  placeholder="Confirm your new password"
                  autoComplete="new-password"
                  required
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowConfirmPassword(
                      (current) =>
                        !current
                    )
                  }
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: 8,
                  }}
                >
                  {showConfirmPassword
                    ? 'Hide'
                    : 'Show'}
                </button>
              </div>
            </div>

            {error && (
              <p className="auth-error">
                {error}
              </p>
            )}

            {success && (
              <p className="auth-success">
                {success}
              </p>
            )}

            <button
              type="submit"
              className="primary-btn full-btn"
              disabled={loading}
            >
              {loading
                ? 'Changing password...'
                : 'Change password'}
            </button>

            <button
              type="button"
              className="secondary-btn full-btn"
              onClick={startNewReset}
              disabled={loading}
            >
              Start a new reset
            </button>
          </form>
        )}

        <p className="auth-switch">
          <Link to="/login">
            Back to login
          </Link>
        </p>

      </div>
    </section>
  );
}

export default ResetPasswordPage;
