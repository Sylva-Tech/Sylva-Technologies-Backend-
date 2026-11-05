import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import api from '../services/api';

const AuthContext = createContext();

const normalizeUser = (userPayload, userData = {}) => {
  if (!userPayload) {
    return null;
  }

  const sellerProfile =
    userPayload?.sellerProfile ||
    userData?.sellerProfile ||
    {};

  return {
    _id: userPayload._id,
    name: userPayload.name,
    email: userPayload.email,
    phone: userPayload.phone,
    role: userPayload.role,

    emailVerified:
      userData?.emailVerified ??
      userPayload?.emailVerified ??
      userPayload?.isVerified ??
      false,

    isVerified:
      userPayload?.isVerified ??
      userData?.isVerified ??
      false,

    /*
     * Seller application status.
     *
     * Possible values:
     * none
     * pending
     * approved
     * rejected
     */
    sellerStatus:
      userPayload?.sellerStatus ??
      userData?.sellerStatus ??
      'none',

    /*
     * Seller operational account status.
     *
     * Possible values:
     * active
     * warning
     * suspended
     * banned
     */
    accountStatus:
      userPayload?.accountStatus ??
      userData?.accountStatus ??
      'active',

    /*
     * Store operational status.
     *
     * Possible values:
     * inactive
     * active
     */
    storeStatus:
      userPayload?.storeStatus ??
      userData?.storeStatus ??
      'inactive',

    /*
     * Account restriction information.
     */
    warningReason:
      userPayload?.warningReason ??
      userData?.warningReason ??
      '',

    warnedAt:
      userPayload?.warnedAt ??
      userData?.warnedAt ??
      null,

    warnedBy:
      userPayload?.warnedBy ??
      userData?.warnedBy ??
      null,

    suspensionReason:
      userPayload?.suspensionReason ??
      userData?.suspensionReason ??
      '',

    suspendedAt:
      userPayload?.suspendedAt ??
      userData?.suspendedAt ??
      null,

    suspendedBy:
      userPayload?.suspendedBy ??
      userData?.suspendedBy ??
      null,

    banReason:
      userPayload?.banReason ??
      userData?.banReason ??
      '',

    bannedAt:
      userPayload?.bannedAt ??
      userData?.bannedAt ??
      null,

    bannedBy:
      userPayload?.bannedBy ??
      userData?.bannedBy ??
      null,

    /*
     * Complete seller profile.
     */
    sellerProfile:
      userPayload?.sellerProfile ||
      userData?.sellerProfile ||
      null,

    /*
     * Store information.
     *
     * The main source is sellerProfile because
     * that is where the User model stores it.
     */
    storeName:
      userPayload?.storeName ||
      sellerProfile?.storeName ||
      userData?.storeName ||
      '',

    storeProfile:
      userPayload?.storeProfile ||
      sellerProfile?.storeProfile ||
      userData?.storeProfile ||
      '',

    storeLocation:
      userPayload?.storeLocation ||
      sellerProfile?.storeLocation ||
      userData?.storeLocation ||
      '',

    storeEmail:
      userPayload?.storeEmail ||
      sellerProfile?.storeEmail ||
      userData?.storeEmail ||
      '',

    storePhone:
      userPayload?.storePhone ||
      sellerProfile?.storePhone ||
      userData?.storePhone ||
      '',

    storeLogo:
      userPayload?.storeLogo ||
      sellerProfile?.storeLogo ||
      userData?.storeLogo ||
      '',

    consent:
      userPayload?.consent ||
      userData?.consent ||
      null,
  };
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  /*
   * Restore the logged-in user when the application starts.
   */
  useEffect(() => {
    const token = localStorage.getItem('sylva-token');

    if (!token) {
      setLoading(false);
      return;
    }

    api
      .get('/auth/me', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      .then((response) => {
        const payload =
          response.data ?? response;

        const userData =
          payload?.data ?? payload;

        const userPayload =
          userData?.user ?? userData;

        setUser(
          normalizeUser(
            userPayload,
            userData
          )
        );
      })
      .catch((error) => {
        console.error(
          'Failed to restore authentication:',
          error
        );

        localStorage.removeItem('sylva-token');
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  /*
   * Login
   */
  const login = async (email, password) => {
    const response = await api.post(
      '/auth/login',
      {
        email,
        password,
      }
    );

    const payload =
      response.data ?? response;

    const userData =
      payload?.data ?? payload;

    const userPayload =
      userData?.user ?? userData;

    const token =
      userData?.token ??
      userPayload?.token;

    if (!token) {
      throw new Error(
        'Login succeeded but no authentication token was returned.'
      );
    }

    localStorage.setItem(
      'sylva-token',
      token
    );

    const normalizedUser =
      normalizeUser(
        userPayload,
        userData
      );

    setUser(normalizedUser);

    return normalizedUser;
  };

  /*
   * Customer registration
   */
  const register = async (payload) => {
    const response = await api.post(
      '/auth/register',
      payload
    );

    const authPayload =
      response.data ?? response;

    const userData =
      authPayload?.data ??
      authPayload;

    const userPayload =
      userData?.user ??
      userData;

    const normalizedUser =
      normalizeUser(
        userPayload,
        userData
      );

    setUser(null);
    localStorage.removeItem('sylva-token');

    return {
      ...normalizedUser,
      message: authPayload?.message || 'Verification email sent.',
    };
  };

  /*
   * Logout
   */
  const logout = () => {
    localStorage.removeItem(
      'sylva-token'
    );

    setUser(null);
  };

  const refreshUser = async () => {
    const token = localStorage.getItem('sylva-token');

    if (!token) {
      setUser(null);
      return null;
    }

    try {
      const response = await api.get('/auth/me', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = response.data ?? response;
      const userData = payload?.data ?? payload;
      const userPayload = userData?.user ?? userData;
      const normalizedUser = normalizeUser(userPayload, userData);

      setUser(normalizedUser);
      return normalizedUser;
    } catch (error) {
      console.error('Failed to refresh authentication:', error);
      localStorage.removeItem('sylva-token');
      setUser(null);
      return null;
    }
  };

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      register,
      logout,
      refreshUser,
    }),
    [user, loading]
  );

  return (
    <AuthContext.Provider
      value={value}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context =
    useContext(AuthContext);

  if (!context) {
    throw new Error(
      'useAuth must be used within an AuthProvider'
    );
  }

  return context;
}