import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  BarChart3,
  Bell,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  ClipboardList,
  CreditCard,
  ExternalLink,
  LayoutDashboard,
  Menu,
  Package,
  Plus,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Store,
  Users,
  X,
} from 'lucide-react';

import { useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import api from '../services/api';

import SellerStoreProfile from '../components/seller/SellerStoreProfile';
import SellerProducts from '../components/seller/SellerProducts';

import './SellerDashboardPage.css';

function SellerDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // =========================================================
  // STATE
  // =========================================================

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeSection, setActiveSection] =
    useState('overview');

  // Fresh account information loaded directly from backend.
  // This prevents stale AuthContext data from showing
  // "Approved" when the account has been suspended or banned.
  const [accountUser, setAccountUser] = useState(null);
  const [accountLoading, setAccountLoading] =
    useState(true);

  const [notifications, setNotifications] = useState([]);
  const [unreadNotificationCount, setUnreadNotificationCount] =
    useState(0);
  const [notificationsOpen, setNotificationsOpen] =
    useState(false);
  const [notificationsLoading, setNotificationsLoading] =
    useState(false);
  const [notificationError, setNotificationError] =
    useState('');

  // =========================================================
  // CURRENT USER
  // =========================================================

  // Prefer the freshly loaded backend user.
  const currentUser = accountUser || user;

  // =========================================================
  // LOAD FRESH ACCOUNT INFORMATION
  // =========================================================

  const loadAccount = useCallback(async () => {
    if (!user?._id) {
      return;
    }

    try {
      setAccountLoading(true);

      const response = await api.get('/auth/me');

      const freshUser =
        response.data?.user ||
        response.data?.data?.user ||
        null;

      if (freshUser) {
        setAccountUser(freshUser);

        console.log(
          'Fresh seller account loaded:',
          freshUser
        );

        console.log(
          'Fresh sellerStatus:',
          freshUser.sellerStatus
        );

        console.log(
          'Fresh accountStatus:',
          freshUser.accountStatus
        );

        console.log(
          'Fresh storeStatus:',
          freshUser.storeStatus
        );

        console.log(
          'Fresh storeName:',
          freshUser.storeName ||
            freshUser.sellerProfile?.storeName
        );
      }
    } catch (error) {
      console.error(
        'Unable to refresh seller account:',
        error?.response?.data ||
          error?.message ||
          error
      );

      // Keep existing AuthContext user as fallback.
      setAccountUser(null);
    } finally {
      setAccountLoading(false);
    }
  }, [user?._id]);

  // =========================================================
  // SELLER INFORMATION
  // =========================================================

  const sellerStatus = String(
    currentUser?.sellerStatus || 'pending'
  ).toLowerCase();

  const sellerAccountStatus = String(
    currentUser?.accountStatus ||
      currentUser?.sellerProfile?.accountStatus ||
      'active'
  ).toLowerCase();

  const sellerStoreStatus = String(
    currentUser?.storeStatus ||
      currentUser?.sellerProfile?.storeStatus ||
      (sellerStatus === 'approved'
        ? 'active'
        : 'inactive')
  ).toLowerCase();

  // Store name supports all locations currently used
  // by the backend/frontend seller profile.
  const storeName =
    currentUser?.storeName ||
    currentUser?.sellerProfile?.storeName ||
    currentUser?.sellerProfile?.officialName ||
    currentUser?.sellerProfile?.officialBusinessName ||
    'Your Technology Store';

  const sellerName =
    currentUser?.name ||
    currentUser?.sellerProfile?.officialName ||
    'Seller';

  const warningReason =
    currentUser?.warningReason ||
    currentUser?.sellerProfile?.warningReason ||
    '';

  const suspensionReason =
    currentUser?.suspensionReason ||
    currentUser?.sellerProfile?.suspensionReason ||
    '';

  const banReason =
    currentUser?.banReason ||
    currentUser?.sellerProfile?.banReason ||
    '';

  // =========================================================
  // ACCOUNT RESTRICTION
  // =========================================================

  const sellerAccountRestricted =
    sellerAccountStatus === 'suspended' ||
    sellerAccountStatus === 'banned';

  // =========================================================
  // SELLER APPLICATION STATUS
  // =========================================================

  const statusConfig = useMemo(() => {
    if (sellerStatus === 'approved') {
      return {
        label: 'Approved',
        className: 'seller-status-approved',
        title: 'Seller application approved',
        message:
          'Your seller application has been approved.',
      };
    }

    if (sellerStatus === 'rejected') {
      return {
        label: 'Action Required',
        className: 'seller-status-rejected',
        title:
          'Seller verification needs attention',
        message:
          'Your seller application requires changes before store access can be approved.',
      };
    }

    return {
      label: 'Under Review',
      className: 'seller-status-pending',
      title:
        'Your seller application is under review',
      message:
        'Your documents and store information are being reviewed. Product uploads will become available after approval.',
    };
  }, [sellerStatus]);

  // =========================================================
  // OPERATIONAL ACCOUNT STATUS
  // =========================================================

  const accountStatusConfig = useMemo(() => {
    switch (sellerAccountStatus) {
      case 'warning':
        return {
          label: 'Warning',
          className: 'seller-status-pending',
          title: 'Seller account warning',
          reason:
            warningReason ||
            'Your seller account has received a warning.',
        };

      case 'suspended':
        return {
          label: 'Suspended',
          className: 'seller-status-rejected',
          title: 'Seller account suspended',
          reason:
            suspensionReason ||
            'Your seller account has been suspended.',
        };

      case 'banned':
        return {
          label: 'Banned',
          className: 'seller-status-rejected',
          title: 'Seller account banned',
          reason:
            banReason ||
            'Your seller account has been banned.',
        };

      default:
        return {
          label: 'Active',
          className: 'seller-status-approved',
          title: 'Seller account active',
          reason:
            'Your seller account is currently active.',
        };
    }
  }, [
    sellerAccountStatus,
    warningReason,
    suspensionReason,
    banReason,
  ]);

  // =========================================================
  // LOAD NOTIFICATIONS
  // =========================================================

  const loadNotifications = useCallback(async () => {
    if (!user?._id) {
      return;
    }

    try {
      setNotificationsLoading(true);
      setNotificationError('');

      const response =
        await api.get('/notifications');

      if (response.data?.success === false) {
        throw new Error(
          response.data?.message ||
            'Unable to load notifications.'
        );
      }

      setNotifications(
        Array.isArray(
          response.data?.notifications
        )
          ? response.data.notifications
          : []
      );

      setUnreadNotificationCount(
        Number(
          response.data?.unreadCount || 0
        )
      );
    } catch (error) {
      console.error(
        'Unable to load notifications:',
        error?.response?.data ||
          error?.message ||
          error
      );

      setNotificationError(
        error?.response?.data?.message ||
          error?.message ||
          'Unable to load notifications.'
      );
    } finally {
      setNotificationsLoading(false);
    }
  }, [user?._id]);

  // =========================================================
  // REFRESH ACCOUNT + NOTIFICATIONS
  // =========================================================

  useEffect(() => {
    if (!user?._id) {
      return;
    }

    loadAccount();
    loadNotifications();

    const interval = setInterval(() => {
      loadAccount();
      loadNotifications();
    }, 30000);

    return () => {
      clearInterval(interval);
    };
  }, [
    user?._id,
    loadAccount,
    loadNotifications,
  ]);

  // =========================================================
  // MARK SINGLE NOTIFICATION AS READ
  // =========================================================

  const handleNotificationClick = async (
    notification
  ) => {
    try {
      if (!notification?._id) {
        return;
      }

      if (!notification.isRead) {
        await api.patch(
          `/notifications/${notification._id}/read`
        );

        setNotifications((current) =>
          current.map((item) =>
            item._id === notification._id
              ? {
                  ...item,
                  isRead: true,
                  readAt:
                    new Date().toISOString(),
                }
              : item
          )
        );

        setUnreadNotificationCount((count) =>
          Math.max(0, count - 1)
        );
      }
    } catch (error) {
      console.error(
        'Unable to mark notification as read:',
        error?.response?.data ||
          error?.message ||
          error
      );
    }
  };

  // =========================================================
  // MARK ALL NOTIFICATIONS AS READ
  // =========================================================

  const handleMarkAllNotificationsRead =
    async () => {
      try {
        await api.patch(
          '/notifications/read-all'
        );

        setNotifications((current) =>
          current.map((notification) => ({
            ...notification,
            isRead: true,
            readAt:
              notification.readAt ||
              new Date().toISOString(),
          }))
        );

        setUnreadNotificationCount(0);
      } catch (error) {
        console.error(
          'Unable to mark all notifications as read:',
          error?.response?.data ||
            error?.message ||
            error
        );
      }
    };

  // =========================================================
  // NAVIGATION
  // =========================================================

  const navigation = [
    {
      label: 'Overview',
      icon: LayoutDashboard,
      key: 'overview',
    },
    {
      label: 'Store',
      icon: Store,
      key: 'store',
    },
    {
      label: 'Products',
      icon: Package,
      key: 'products',
    },
    {
      label: 'Orders',
      icon: ClipboardList,
      key: 'orders',
    },
    {
      label: 'Sales',
      icon: BarChart3,
      key: 'sales',
    },
    {
      label: 'Customers',
      icon: Users,
      key: 'customers',
    },
    {
      label: 'Store Profile',
      icon: CircleUserRound,
      key: 'profile',
    },
    {
      label: 'Verification',
      icon: ShieldCheck,
      key: 'verification',
    },
    {
      label: 'Settings',
      icon: Settings,
      key: 'settings',
    },
  ];

  const handleNavigation = (key) => {
    // Do not allow suspended/banned sellers
    // to access product management.
    if (
      key === 'products' &&
      sellerAccountRestricted
    ) {
      return;
    }

    setActiveSection(key);
    setSidebarOpen(false);
  };

  // =========================================================
  // ADD PRODUCT
  // =========================================================

  const handleAddProduct = () => {
    console.log(
      'Current seller status:',
      sellerStatus
    );

    console.log(
      'Current account status:',
      sellerAccountStatus
    );

    console.log(
      'Current store status:',
      sellerStoreStatus
    );

    console.log(
      'Current store name:',
      storeName
    );

    console.log(
      'Current user:',
      currentUser
    );

    if (sellerStatus !== 'approved') {
      console.log(
        'Add Product blocked: seller not approved.'
      );
      return;
    }

    if (
      sellerAccountStatus === 'suspended' ||
      sellerAccountStatus === 'banned'
    ) {
      console.log(
        'Add Product blocked: seller account restricted.'
      );
      return;
    }

    if (sellerStoreStatus !== 'active') {
      console.log(
        'Add Product blocked: store inactive.'
      );
      return;
    }

    setSidebarOpen(false);

    navigate('/seller/products/new');
  };

  const activePageTitle =
    navigation.find(
      (item) => item.key === activeSection
    )?.label || 'Dashboard';

  // =========================================================
  // RENDER
  // =========================================================

  return (
    <div className="seller-dashboard">

      {/* =====================================================
          MOBILE OVERLAY
      ====================================================== */}

      {sidebarOpen && (
        <button
          type="button"
          className="seller-dashboard-overlay"
          onClick={() =>
            setSidebarOpen(false)
          }
          aria-label="Close navigation"
        />
      )}

      {/* =====================================================
          SIDEBAR
      ====================================================== */}

      <aside
        className={`seller-dashboard-sidebar ${
          sidebarOpen
            ? 'seller-dashboard-sidebar-open'
            : ''
        }`}
      >
        <div className="seller-dashboard-sidebar-top">

          {/* LOGO */}

          <div className="seller-dashboard-logo">
            <div className="seller-dashboard-logo-mark">
              ST
            </div>

            <div className="seller-dashboard-logo-text">
              <strong>SYLVA</strong>
              <span>SELLER CENTRE</span>
            </div>

            <button
              type="button"
              className="seller-dashboard-mobile-close"
              onClick={() =>
                setSidebarOpen(false)
              }
              aria-label="Close navigation"
            >
              <X size={20} />
            </button>
          </div>

          {/* =================================================
              STORE MINI CARD
          ================================================== */}

          <div
            className="seller-dashboard-store-card"
            style={{
              position: 'relative',
              zIndex: 20,
              overflow: 'visible',
              marginTop: '18px',
              marginBottom: '18px',
            }}
          >
            <div className="seller-dashboard-store-icon">
              <Store size={20} />
            </div>

            <div
              style={{
                minWidth: 0,
                width: '100%',
                overflow: 'visible',
              }}
            >
              {/* STORE NAME */}
              <strong
                title={storeName}
                style={{
                  display: 'block',
                  width: '100%',
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: '14px',
                  lineHeight: 1.4,
                  color: '#ffffff',
                  position: 'relative',
                  zIndex: 30,
                }}
              >
                {storeName}
              </strong>

              {/* APPLICATION STATUS */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  flexWrap: 'wrap',
                  marginTop: '5px',
                }}
              >
                <span
                  style={{
                    fontSize: '11px',
                    color: '#cbd5e1',
                  }}
                >
                  Application:
                </span>

                <span
                  className={`seller-dashboard-store-status ${statusConfig.className}`}
                  style={{
                    whiteSpace: 'nowrap',
                  }}
                >
                  {statusConfig.label}
                </span>
              </div>

              {/* ACCOUNT STATUS */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  flexWrap: 'wrap',
                  marginTop: '4px',
                }}
              >
                <span
                  style={{
                    fontSize: '11px',
                    color: '#cbd5e1',
                  }}
                >
                  Account:
                </span>

                <span
                  className={`seller-dashboard-store-status ${accountStatusConfig.className}`}
                  style={{
                    whiteSpace: 'nowrap',
                  }}
                >
                  {accountStatusConfig.label}
                </span>
              </div>
            </div>
          </div>

          {/* =================================================
              NAVIGATION
          ================================================== */}

          <nav className="seller-dashboard-nav">
            <span className="seller-dashboard-nav-title">
              SELLER CENTRE
            </span>

            {navigation.map((item) => {
              const Icon = item.icon;

              const isActive =
                activeSection === item.key;

              const productsRestricted =
                item.key === 'products' &&
                sellerAccountRestricted;

              return (
                <button
                  key={item.key}
                  type="button"
                  className={`seller-dashboard-nav-item ${
                    isActive
                      ? 'seller-dashboard-nav-active'
                      : ''
                  } ${
                    productsRestricted
                      ? 'seller-dashboard-nav-disabled'
                      : ''
                  }`}
                  onClick={() =>
                    handleNavigation(item.key)
                  }
                  disabled={productsRestricted}
                  title={
                    productsRestricted
                      ? `Products unavailable while account is ${accountStatusConfig.label.toLowerCase()}`
                      : item.label
                  }
                >
                  <Icon size={18} />

                  <span>{item.label}</span>

                  {isActive && (
                    <ChevronRight
                      size={15}
                      className="seller-dashboard-nav-arrow"
                    />
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* SIDEBAR FOOTER */}

        <div className="seller-dashboard-sidebar-footer">
          <div className="seller-dashboard-user-mini">

            <div className="seller-dashboard-avatar">
              {sellerName
                .charAt(0)
                .toUpperCase()}
            </div>

            <div>
              <strong>{sellerName}</strong>
              <span>Seller Account</span>
            </div>

          </div>
        </div>
      </aside>

      {/* =====================================================
          MAIN
      ====================================================== */}

      <div className="seller-dashboard-main">

        {/* ===================================================
            HEADER
        ==================================================== */}

        <header className="seller-dashboard-header">

          <div className="seller-dashboard-header-left">

            <button
              type="button"
              className="seller-dashboard-menu-button"
              onClick={() =>
                setSidebarOpen(true)
              }
              aria-label="Open navigation"
            >
              <Menu size={22} />
            </button>

            <div>
              <span className="seller-dashboard-header-label">
                SELLER CENTRE
              </span>

              <h1>
                {activeSection === 'overview'
                  ? 'Dashboard'
                  : activePageTitle}
              </h1>
            </div>

          </div>

          <div className="seller-dashboard-header-actions">

            {/* =================================================
                NOTIFICATIONS
            ================================================== */}

            <div
              style={{
                position: 'relative',
                zIndex: 2000,
              }}
            >
              <button
                type="button"
                className="seller-dashboard-icon-button"
                aria-label="Notifications"
                onClick={() =>
                  setNotificationsOpen(
                    (current) => !current
                  )
                }
              >
                <Bell size={19} />

                {unreadNotificationCount > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: '-2px',
                      right: '-2px',
                      minWidth: '17px',
                      height: '17px',
                      padding: '0 4px',
                      borderRadius: '999px',
                      background: '#dc2626',
                      color: '#ffffff',
                      fontSize: '10px',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border:
                        '2px solid #ffffff',
                      lineHeight: 1,
                    }}
                  >
                    {unreadNotificationCount > 99
                      ? '99+'
                      : unreadNotificationCount}
                  </span>
                )}
              </button>

              {notificationsOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top:
                      'calc(100% + 12px)',
                    right: 0,
                    width: '380px',
                    maxWidth:
                      'calc(100vw - 30px)',
                    background: '#ffffff',
                    border:
                      '1px solid #e5e7eb',
                    borderRadius: '14px',
                    boxShadow:
                      '0 15px 40px rgba(15, 23, 42, 0.18)',
                    zIndex: 3000,
                    overflow: 'hidden',
                  }}
                >

                  {/* NOTIFICATION HEADER */}

                  <div
                    style={{
                      padding:
                        '16px 18px',
                      borderBottom:
                        '1px solid #e5e7eb',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent:
                        'space-between',
                      gap: '12px',
                    }}
                  >
                    <div>
                      <strong
                        style={{
                          display: 'block',
                          fontSize: '16px',
                          color: '#111827',
                        }}
                      >
                        Notifications
                      </strong>

                      <span
                        style={{
                          fontSize: '12px',
                          color: '#64748b',
                        }}
                      >
                        {unreadNotificationCount >
                        0
                          ? `${unreadNotificationCount} unread`
                          : 'All caught up'}
                      </span>
                    </div>

                    {unreadNotificationCount >
                      0 && (
                      <button
                        type="button"
                        onClick={
                          handleMarkAllNotificationsRead
                        }
                        style={{
                          border: 'none',
                          background:
                            'transparent',
                          color: '#166534',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          padding: '5px',
                        }}
                      >
                        Mark all as read
                      </button>
                    )}
                  </div>

                  {/* NOTIFICATION LIST */}

                  <div
                    style={{
                      maxHeight: '420px',
                      overflowY: 'auto',
                    }}
                  >

                    {notificationError && (
                      <div
                        style={{
                          padding:
                            '15px 18px',
                          background: '#fef2f2',
                          color: '#b91c1c',
                          fontSize: '12px',
                          borderBottom:
                            '1px solid #fee2e2',
                        }}
                      >
                        {notificationError}
                      </div>
                    )}

                    {notificationsLoading &&
                      notifications.length ===
                        0 && (
                        <div
                          style={{
                            padding:
                              '35px 20px',
                            textAlign:
                              'center',
                            color: '#64748b',
                            fontSize: '13px',
                          }}
                        >
                          Loading notifications...
                        </div>
                      )}

                    {!notificationsLoading &&
                      !notificationError &&
                      notifications.length ===
                        0 && (
                        <div
                          style={{
                            padding:
                              '40px 20px',
                            textAlign:
                              'center',
                            color: '#64748b',
                          }}
                        >
                          <Bell
                            size={30}
                            style={{
                              marginBottom:
                                '10px',
                              opacity: 0.5,
                            }}
                          />

                          <strong
                            style={{
                              display:
                                'block',
                              color:
                                '#334155',
                              marginBottom:
                                '5px',
                            }}
                          >
                            No notifications
                          </strong>

                          <span
                            style={{
                              fontSize:
                                '13px',
                            }}
                          >
                            You don't have any
                            notifications yet.
                          </span>
                        </div>
                      )}

                    {notifications.map(
                      (notification) => (
                        <button
                          key={
                            notification._id
                          }
                          type="button"
                          onClick={() =>
                            handleNotificationClick(
                              notification
                            )
                          }
                          style={{
                            width: '100%',
                            border: 'none',
                            borderBottom:
                              '1px solid #f1f5f9',
                            background:
                              notification.isRead
                                ? '#ffffff'
                                : '#f0fdf4',
                            padding:
                              '15px 18px',
                            textAlign:
                              'left',
                            cursor:
                              'pointer',
                            display: 'flex',
                            gap: '12px',
                            alignItems:
                              'flex-start',
                          }}
                        >

                          <div
                            style={{
                              width: '36px',
                              height: '36px',
                              minWidth: '36px',
                              borderRadius:
                                '10px',
                              background:
                                notification.type ===
                                'account_banned'
                                  ? '#fee2e2'
                                  : notification.type ===
                                      'account_suspended'
                                    ? '#fef3c7'
                                    : notification.type ===
                                        'account_warning'
                                      ? '#fff7ed'
                                      : '#dcfce7',
                              display: 'flex',
                              alignItems:
                                'center',
                              justifyContent:
                                'center',
                            }}
                          >

                            {[
                              'account_banned',
                              'account_suspended',
                              'account_warning',
                            ].includes(
                              notification.type
                            ) ? (
                              <ShieldAlert
                                size={18}
                                color="#b45309"
                              />
                            ) : (
                              <Bell
                                size={18}
                                color="#166534"
                              />
                            )}

                          </div>

                          <div
                            style={{
                              flex: 1,
                              minWidth: 0,
                            }}
                          >

                            <div
                              style={{
                                display:
                                  'flex',
                                justifyContent:
                                  'space-between',
                                gap: '8px',
                              }}
                            >
                              <strong
                                style={{
                                  fontSize:
                                    '13px',
                                  color:
                                    '#111827',
                                  lineHeight:
                                    1.4,
                                }}
                              >
                                {
                                  notification.title
                                }
                              </strong>

                              {!notification.isRead && (
                                <span
                                  style={{
                                    width:
                                      '7px',
                                    height:
                                      '7px',
                                    minWidth:
                                      '7px',
                                    borderRadius:
                                      '50%',
                                    background:
                                      '#16a34a',
                                    marginTop:
                                      '5px',
                                  }}
                                />
                              )}
                            </div>

                            <p
                              style={{
                                margin:
                                  '5px 0 7px',
                                fontSize:
                                  '12px',
                                lineHeight:
                                  1.5,
                                color:
                                  '#475569',
                              }}
                            >
                              {
                                notification.message
                              }
                            </p>

                            <span
                              style={{
                                fontSize:
                                  '10px',
                                color:
                                  '#94a3b8',
                              }}
                            >
                              {notification.createdAt
                                ? new Date(
                                    notification.createdAt
                                  ).toLocaleString()
                                : ''}
                            </span>

                          </div>

                        </button>
                      )
                    )}

                  </div>
                </div>
              )}
            </div>

            {/* USER */}

            <div className="seller-dashboard-header-user">

              <div className="seller-dashboard-avatar">
                {sellerName
                  .charAt(0)
                  .toUpperCase()}
              </div>

              <div>
                <strong>{sellerName}</strong>
                <span>Seller</span>
              </div>

              <ChevronDown size={16} />

            </div>

          </div>
        </header>

        {/* ===================================================
            CONTENT
        ==================================================== */}

        <main className="seller-dashboard-content">

          {/* =================================================
              TOP ACCOUNT STATUS
          ================================================== */}

          {sellerAccountStatus ===
            'suspended' && (
            <div className="seller-dashboard-status seller-status-rejected">

              <div className="seller-dashboard-status-icon">
                <ShieldAlert size={20} />
              </div>

              <div className="seller-dashboard-status-content">

                <div className="seller-dashboard-status-heading">
                  <strong>
                    Seller Account Suspended
                  </strong>

                  <span>
                    SUSPENDED
                  </span>
                </div>

                <p>
                  Your seller account is currently
                  suspended. Reason:{' '}
                  {suspensionReason ||
                    'Your seller account has been suspended by Sylva Technologies.'}
                </p>

                <button
                  type="button"
                  className="seller-dashboard-profile-button"
                  onClick={() =>
                    navigate(
                      '/seller/appeal?type=suspension'
                    )
                  }
                >
                  Appeal Suspension
                  <ChevronRight size={16} />
                </button>

              </div>
            </div>
          )}

          {sellerAccountStatus ===
            'banned' && (
            <div className="seller-dashboard-status seller-status-rejected">

              <div className="seller-dashboard-status-icon">
                <ShieldAlert size={20} />
              </div>

              <div className="seller-dashboard-status-content">

                <div className="seller-dashboard-status-heading">
                  <strong>
                    Seller Account Banned
                  </strong>

                  <span>
                    BANNED
                  </span>
                </div>

                <p>
                  Your seller account is currently
                  banned. Reason:{' '}
                  {banReason ||
                    'Your seller account has been banned by Sylva Technologies.'}
                </p>

                <button
                  type="button"
                  className="seller-dashboard-profile-button"
                  onClick={() =>
                    navigate(
                      '/seller/appeal?type=ban'
                    )
                  }
                >
                  Appeal Ban
                  <ChevronRight size={16} />
                </button>

              </div>
            </div>
          )}

          {sellerAccountStatus ===
            'warning' && (
            <div className="seller-dashboard-status seller-status-pending">

              <div className="seller-dashboard-status-icon">
                <ShieldAlert size={20} />
              </div>

              <div className="seller-dashboard-status-content">

                <div className="seller-dashboard-status-heading">
                  <strong>
                    Seller Account Warning
                  </strong>

                  <span>
                    WARNING
                  </span>
                </div>

                <p>
                  Your seller account has received
                  a warning. Reason:{' '}
                  {warningReason ||
                    'Please review your seller account requirements and ensure continued compliance.'}
                </p>

              </div>
            </div>
          )}

          {/* =================================================
              STORE / PROFILE
          ================================================== */}

          {(activeSection === 'store' ||
            activeSection === 'profile') && (
            <SellerStoreProfile />
          )}

          {/* =================================================
              OVERVIEW
          ================================================== */}

          {activeSection === 'overview' && (
            <>

              {/* WELCOME */}

              <section className="seller-dashboard-welcome">

                <div>
                  <span>
                    Welcome back, {sellerName}
                  </span>

                  <h2>
                    Here's your store overview.
                  </h2>

                  <p>
                    Manage your products, orders and
                    seller account from one place.
                  </p>
                </div>

                <button
                  type="button"
                  className="seller-dashboard-store-preview"
                >
                  <ExternalLink size={17} />
                  Preview Store
                </button>

              </section>

              {/* =================================================
                  STORE NAME + STATUS SUMMARY
              ================================================== */}

              <section
                className="seller-dashboard-status"
                style={{
                  marginBottom: '20px',
                }}
              >

                <div
                  className="seller-dashboard-status-icon"
                >
                  <Store size={22} />
                </div>

                <div
                  className="seller-dashboard-status-content"
                >

                  <div
                    className="seller-dashboard-status-heading"
                  >
                    <strong>
                      {storeName}
                    </strong>

                    <span
                      className={
                        accountStatusConfig.className
                      }
                    >
                      {accountStatusConfig.label}
                    </span>
                  </div>

                  <p>
                    <strong>
                      Application:
                    </strong>{' '}
                    {statusConfig.label}
                    {' • '}
                    <strong>
                      Account:
                    </strong>{' '}
                    {accountStatusConfig.label}
                    {' • '}
                    <strong>
                      Store:
                    </strong>{' '}
                    {sellerStoreStatus}
                  </p>

                </div>
              </section>

              {/* =================================================
                  ACCOUNT STATUS
              ================================================== */}

              <section
                className={`seller-dashboard-status ${
                  accountStatusConfig.className
                }`}
              >

                <div className="seller-dashboard-status-icon">

                  {sellerAccountStatus ===
                  'active' ? (
                    <ShieldCheck size={22} />
                  ) : (
                    <ShieldAlert size={22} />
                  )}

                </div>

                <div className="seller-dashboard-status-content">

                  <div className="seller-dashboard-status-heading">

                    <strong>
                      {accountStatusConfig.title}
                    </strong>

                    <span>
                      {accountStatusConfig.label}
                    </span>

                  </div>

                  <p>
                    {accountStatusConfig.reason}
                  </p>

                  {sellerAccountStatus ===
                    'suspended' && (
                    <button
                      type="button"
                      className="seller-dashboard-profile-button"
                      onClick={() =>
                        navigate(
                          '/seller/appeal?type=suspension'
                        )
                      }
                    >
                      Appeal Suspension
                      <ChevronRight size={16} />
                    </button>
                  )}

                  {sellerAccountStatus ===
                    'banned' && (
                    <button
                      type="button"
                      className="seller-dashboard-profile-button"
                      onClick={() =>
                        navigate(
                          '/seller/appeal?type=ban'
                        )
                      }
                    >
                      Appeal Ban
                      <ChevronRight size={16} />
                    </button>
                  )}

                </div>

              </section>

              {/* =================================================
                  SELLER APPLICATION STATUS
              ================================================== */}

              <section
                className={`seller-dashboard-status ${
                  statusConfig.className
                }`}
              >

                <div className="seller-dashboard-status-icon">
                  <ShieldCheck size={22} />
                </div>

                <div className="seller-dashboard-status-content">

                  <div className="seller-dashboard-status-heading">

                    <strong>
                      {statusConfig.title}
                    </strong>

                    <span>
                      {statusConfig.label}
                    </span>

                  </div>

                  <p>
                    {statusConfig.message}
                  </p>

                </div>

              </section>

              {/* =================================================
                  STATISTICS
              ================================================== */}

              <section className="seller-dashboard-stats">

                <div className="seller-dashboard-stat-card">

                  <div className="seller-dashboard-stat-icon">
                    <Package size={20} />
                  </div>

                  <span>
                    Total Products
                  </span>

                  <strong>0</strong>

                  <small>
                    No products added yet
                  </small>

                </div>

                <div className="seller-dashboard-stat-card">

                  <div className="seller-dashboard-stat-icon">
                    <ShoppingBag size={20} />
                  </div>

                  <span>
                    Total Orders
                  </span>

                  <strong>0</strong>

                  <small>
                    Orders will appear here
                  </small>

                </div>

                <div className="seller-dashboard-stat-card">

                  <div className="seller-dashboard-stat-icon">
                    <CreditCard size={20} />
                  </div>

                  <span>
                    Total Sales
                  </span>

                  <strong>
                    KSh 0
                  </strong>

                  <small>
                    Sales summary
                  </small>

                </div>

                <div className="seller-dashboard-stat-card">

                  <div className="seller-dashboard-stat-icon">
                    <Users size={20} />
                  </div>

                  <span>
                    Customers
                  </span>

                  <strong>0</strong>

                  <small>
                    Customer activity
                  </small>

                </div>

              </section>

              {/* =================================================
                  MAIN GRID
              ================================================== */}

              <section className="seller-dashboard-grid">

                {/* STORE OVERVIEW */}

                <div className="seller-dashboard-panel seller-dashboard-store-panel">

                  <div className="seller-dashboard-panel-heading">

                    <div>
                      <span>
                        YOUR STORE
                      </span>

                      <h3>
                        Store Overview
                      </h3>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        handleNavigation(
                          'profile'
                        )
                      }
                    >
                      Manage
                      <ChevronRight size={16} />
                    </button>

                  </div>

                  <div className="seller-dashboard-store-overview">

                    <div className="seller-dashboard-store-large-icon">
                      <Store size={32} />
                    </div>

                    <div className="seller-dashboard-store-info">

                      <h4>
                        {storeName}
                      </h4>

                      <p>
                        Your store profile and business
                        information will appear here.
                      </p>

                      <div className="seller-dashboard-store-meta">

                        <span
                          className={
                            statusConfig.className
                          }
                        >
                          Application:{' '}
                          {statusConfig.label}
                        </span>

                        <span
                          className={
                            accountStatusConfig.className
                          }
                        >
                          Account:{' '}
                          {accountStatusConfig.label}
                        </span>

                        <span>
                          Store:{' '}
                          {sellerStoreStatus}
                        </span>

                      </div>

                    </div>

                  </div>

                  <button
                    type="button"
                    className="seller-dashboard-profile-button"
                    onClick={() =>
                      handleNavigation(
                        'profile'
                      )
                    }
                  >
                    Complete Store Profile
                    <ChevronRight size={17} />
                  </button>

                </div>

                {/* QUICK ACTIONS */}

                <div className="seller-dashboard-panel">

                  <div className="seller-dashboard-panel-heading">

                    <div>
                      <span>
                        QUICK ACTIONS
                      </span>

                      <h3>
                        Manage Store
                      </h3>
                    </div>

                  </div>

                  <div className="seller-dashboard-actions">

                    {/* ADD PRODUCT */}

                    <button
                      type="button"
                      className="seller-dashboard-action"
                      onClick={
                        handleAddProduct
                      }
                      disabled={
                        sellerStatus !==
                          'approved' ||
                        sellerAccountRestricted ||
                        sellerStoreStatus !==
                          'active'
                      }
                    >
                      <div>
                        <Plus size={19} />
                      </div>

                      <span>
                        Add Product
                      </span>

                      <ChevronRight size={16} />
                    </button>

                    {/* MANAGE PRODUCTS */}

                    <button
                      type="button"
                      className="seller-dashboard-action"
                      onClick={() =>
                        handleNavigation(
                          'products'
                        )
                      }
                      disabled={
                        sellerAccountRestricted
                      }
                    >
                      <div>
                        <Package size={19} />
                      </div>

                      <span>
                        {sellerAccountRestricted
                          ? `Products unavailable (${accountStatusConfig.label})`
                          : 'Manage Products'}
                      </span>

                      <ChevronRight size={16} />

                    </button>

                    {/* VIEW ORDERS */}

                    <button
                      type="button"
                      className="seller-dashboard-action"
                      onClick={() =>
                        handleNavigation(
                          'orders'
                        )
                      }
                    >
                      <div>
                        <ClipboardList
                          size={19}
                        />
                      </div>

                      <span>
                        View Orders
                      </span>

                      <ChevronRight size={16} />
                    </button>

                    {/* EDIT STORE PROFILE */}

                    <button
                      type="button"
                      className="seller-dashboard-action"
                      onClick={() =>
                        handleNavigation(
                          'profile'
                        )
                      }
                    >
                      <div>
                        <Store size={19} />
                      </div>

                      <span>
                        Edit Store Profile
                      </span>

                      <ChevronRight size={16} />
                    </button>

                  </div>

                </div>

              </section>

              {/* =================================================
                  RECENT ORDERS
              ================================================== */}

              <section className="seller-dashboard-panel seller-dashboard-orders-panel">

                <div className="seller-dashboard-panel-heading">

                  <div>
                    <span>
                      ORDERS
                    </span>

                    <h3>
                      Recent Orders
                    </h3>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      handleNavigation(
                        'orders'
                      )
                    }
                  >
                    View all
                    <ChevronRight size={16} />
                  </button>

                </div>

                <div className="seller-dashboard-empty">

                  <div className="seller-dashboard-empty-icon">
                    <ClipboardList size={26} />
                  </div>

                  <h4>
                    No orders yet
                  </h4>

                  <p>
                    Customer orders will appear here
                    once your store starts selling.
                  </p>

                  {sellerStatus !==
                    'approved' && (
                    <small>
                      Product selling will be enabled
                      after seller approval.
                    </small>
                  )}

                  {sellerAccountRestricted && (
                    <small>
                      Seller operations are currently
                      unavailable because your account is{' '}
                      {accountStatusConfig.label.toLowerCase()}.
                    </small>
                  )}

                </div>

              </section>

            </>
          )}

          {/* =================================================
              PRODUCTS
          ================================================== */}

          {activeSection === 'products' &&
            !sellerAccountRestricted && (
              <SellerProducts />
            )}

          {activeSection === 'products' &&
            sellerAccountRestricted && (
              <section className="seller-dashboard-panel">

                <div className="seller-dashboard-empty">

                  <div className="seller-dashboard-empty-icon">
                    <ShieldAlert size={26} />
                  </div>

                  <h4>
                    Product Management Unavailable
                  </h4>

                  <p>
                    Your seller account is currently{' '}
                    <strong>
                      {accountStatusConfig.label}
                    </strong>
                    .
                  </p>

                  <small>
                    {accountStatusConfig.reason}
                  </small>

                  {sellerAccountStatus ===
                    'suspended' && (
                    <button
                      type="button"
                      className="seller-dashboard-profile-button"
                      onClick={() =>
                        navigate(
                          '/seller/appeal?type=suspension'
                        )
                      }
                    >
                      Appeal Suspension
                      <ChevronRight size={16} />
                    </button>
                  )}

                  {sellerAccountStatus ===
                    'banned' && (
                    <button
                      type="button"
                      className="seller-dashboard-profile-button"
                      onClick={() =>
                        navigate(
                          '/seller/appeal?type=ban'
                        )
                      }
                    >
                      Appeal Ban
                      <ChevronRight size={16} />
                    </button>
                  )}

                </div>

              </section>
            )}

          {/* =================================================
              ORDERS
          ================================================== */}

          {activeSection === 'orders' && (
            <section className="seller-dashboard-panel">

              <div className="seller-dashboard-panel-heading">

                <div>
                  <span>
                    SALES
                  </span>

                  <h3>
                    Orders
                  </h3>
                </div>

              </div>

              <div className="seller-dashboard-empty">

                <div className="seller-dashboard-empty-icon">
                  <ClipboardList size={26} />
                </div>

                <h4>
                  No orders yet
                </h4>

                <p>
                  Customer orders will appear here once
                  your store starts selling.
                </p>

              </div>

            </section>
          )}

          {/* =================================================
              SALES
          ================================================== */}

          {activeSection === 'sales' && (
            <section className="seller-dashboard-panel">

              <div className="seller-dashboard-panel-heading">

                <div>
                  <span>
                    ANALYTICS
                  </span>

                  <h3>
                    Sales
                  </h3>
                </div>

              </div>

              <div className="seller-dashboard-empty">

                <div className="seller-dashboard-empty-icon">
                  <BarChart3 size={26} />
                </div>

                <h4>
                  Sales Analytics
                </h4>

                <p>
                  Sales statistics and revenue reports
                  will appear here.
                </p>

              </div>

            </section>
          )}

          {/* =================================================
              CUSTOMERS
          ================================================== */}

          {activeSection === 'customers' && (
            <section className="seller-dashboard-panel">

              <div className="seller-dashboard-panel-heading">

                <div>
                  <span>
                    CUSTOMERS
                  </span>

                  <h3>
                    Customers
                  </h3>
                </div>

              </div>

              <div className="seller-dashboard-empty">

                <div className="seller-dashboard-empty-icon">
                  <Users size={26} />
                </div>

                <h4>
                  No customers yet
                </h4>

                <p>
                  Customer information and activity will
                  appear here after your first sales.
                </p>

              </div>

            </section>
          )}

          {/* =================================================
              VERIFICATION
          ================================================== */}

          {activeSection === 'verification' && (
            <section className="seller-dashboard-panel">

              <div className="seller-dashboard-panel-heading">

                <div>
                  <span>
                    ACCOUNT SECURITY
                  </span>

                  <h3>
                    Seller Verification
                  </h3>
                </div>

              </div>

              <div className="seller-dashboard-empty">

                <div className="seller-dashboard-empty-icon">

                  {sellerAccountStatus ===
                  'active' ? (
                    <ShieldCheck size={26} />
                  ) : (
                    <ShieldAlert size={26} />
                  )}

                </div>

                <h4>
                  Application:{' '}
                  {statusConfig.label}
                </h4>

                <p>
                  {statusConfig.message}
                </p>

                <p>
                  Account Status:{' '}
                  <strong>
                    {accountStatusConfig.label}
                  </strong>
                </p>

                <p>
                  Store Status:{' '}
                  <strong>
                    {sellerStoreStatus}
                  </strong>
                </p>

                {sellerAccountStatus !==
                  'active' && (
                  <small>
                    {accountStatusConfig.reason}
                  </small>
                )}

              </div>

            </section>
          )}

          {/* =================================================
              SETTINGS
          ================================================== */}

          {activeSection === 'settings' && (
            <section className="seller-dashboard-panel">

              <div className="seller-dashboard-panel-heading">

                <div>
                  <span>
                    ACCOUNT
                  </span>

                  <h3>
                    Settings
                  </h3>
                </div>

              </div>

              <div className="seller-dashboard-empty">

                <div className="seller-dashboard-empty-icon">
                  <Settings size={26} />
                </div>

                <h4>
                  Seller Settings
                </h4>

                <p>
                  Account and seller preferences will be
                  configured here.
                </p>

              </div>

            </section>
          )}

        </main>
      </div>
    </div>
  );
}

export default SellerDashboardPage;