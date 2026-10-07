import {
  BrowserRouter as Router,
  Routes,
  Route,
} from 'react-router-dom';

import Header from './components/Header';
import Footer from './components/Footer';
import ProtectedRoute from './components/ProtectedRoute';

import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';

import ChatWidget from './components/ChatWidget';

import HomePage from './pages/HomePage';
import ShopPage from './pages/ShopPage';
import CartPage from './pages/CartPage';
import ProductDetailPage from './pages/ProductDetailPage';
import AuthPage from './pages/AuthPage';

import AdminLoginPage from './pages/AdminLoginPage';
import AdminDashboardPage from './pages/AdminDashboardPage';
import AdminProductsPage from './pages/AdminProductsPage';
import AdminProductFormPage from './pages/AdminProductFormPage';
import AdminImportPage from './pages/AdminImportPage';
import AdminAdsPage from './pages/AdminAdsPage';
import AdminOrdersPage from './pages/AdminOrdersPage';
import AdminCustomersPage from './pages/AdminCustomersPage';
import AdminRevenuePage from './pages/AdminRevenuePage';
import AdminSellerApplicationsPage from './pages/AdminSellerApplicationsPage';
import AdminProductApprovalsPage from './pages/AdminProductApprovalsPage';
import AdminSellerDetailsPage from './pages/AdminSellerDetailsPage';

import ProfilePage from './pages/ProfilePage';
import CheckoutPage from './pages/CheckoutPage';
import InformationPage from './pages/InformationPage';
import ContactPage from './pages/ContactPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import VerifyEmailPage from './pages/VerifyEmailPage';

import SellPage from './pages/SellPage';
import SellerRegisterPage from './pages/SellerRegisterPage';
import SellerLoginPage from './pages/SellerLoginPage';
import SellerDashboardPage from './pages/SellerDashboardPage';
import SellerApplicationPage from './pages/SellerApplicationPage';
import SellerProductFormPage from './pages/SellerProductFormPage';
import SellerAppealPage from './pages/SellerAppealPage';
import CategoriesPage from './pages/CategoriesPage';
import SupportPage from './pages/SupportPage';


import VendorStoresPage from './pages/VendorStoresPage';
import VendorProductsPage from './pages/VendorProductsPage';

import './App.css';

function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <Router>
          <div className="app-shell">
            <Header />

            <main className="page-content">
              <Routes>

                {/* =========================
                    PUBLIC PAGES
                ========================== */}
                <Route
  path="/admin/sellers/:id"
  element={
    <ProtectedRoute adminOnly>
      <AdminSellerDetailsPage />
    </ProtectedRoute>
  }
/>

                <Route
                  path="/"
                  element={<HomePage />}
                />

                <Route
                  path="/shop"
                  element={<ShopPage />}
                />

                <Route
                  path="/categories"
                  element={<CategoriesPage />}
                />

                <Route
                  path="/deals"
                  element={<ShopPage />}
                />

                <Route
                  path="/support"
                  element={<SupportPage />}
                />

                <Route
                  path="/about"
                  element={
                    <InformationPage type="about" />
                  }
                />

                <Route
                  path="/privacy"
                  element={
                    <InformationPage type="privacy" />
                  }
                />

                <Route
                  path="/terms"
                  element={
                    <InformationPage type="terms" />
                  }
                />

                <Route
                  path="/contact"
                  element={<ContactPage />}
                />

                <Route
                  path="/product/:slug"
                  element={<ProductDetailPage />}
                />
                <Route
  path="/seller/appeal"
  element={
    <ProtectedRoute sellerOnly>
      <SellerAppealPage />
    </ProtectedRoute>
  }
/>

                {/* =========================
                    SELLER MARKETPLACE
                ========================== */}

                <Route
                  path="/sell"
                  element={<SellPage />}
                />

                <Route
                  path="/sell-on-sylva"
                  element={<SellPage />}
                />

                <Route
                  path="/seller/login"
                  element={<SellerLoginPage />}
                />

                <Route
                  path="/seller/register"
                  element={<SellerRegisterPage />}
                />

                {/* APPROVED SELLER DASHBOARD */}
                <Route
                  path="/seller/dashboard"
                  element={
                    <ProtectedRoute sellerOnly>
                      <SellerDashboardPage />
                    </ProtectedRoute>
                  }
                />

                {/* SELLER ADD PRODUCT */}
                <Route
                  path="/seller/products/new"
                  element={
                    <ProtectedRoute sellerOnly>
                      <SellerProductFormPage />
                    </ProtectedRoute>
                  }
                />

                {/* REJECTED SELLER APPLICATION / RESUBMISSION */}
                <Route
                  path="/seller/application"
                  element={
                    <ProtectedRoute>
                      <SellerApplicationPage />
                    </ProtectedRoute>
                  }
                />

                {/* =========================
                    CART
                ========================== */}

                <Route
                  path="/cart"
                  element={<CartPage />}
                />

                {/* =========================
                    CUSTOMER CHECKOUT
                ========================== */}

                <Route
                  path="/checkout"
                  element={
                    <ProtectedRoute>
                      <CheckoutPage />
                    </ProtectedRoute>
                  }
                />

                {/* =========================
                    CUSTOMER AUTHENTICATION
                ========================== */}

                <Route
                  path="/login"
                  element={
                    <AuthPage mode="login" />
                  }
                />

                <Route
                  path="/register"
                  element={
                    <AuthPage mode="register" />
                  }
                />

                <Route
  path="/forgot-password"
  element={<ForgotPasswordPage />}
/>

<Route
  path="/reset-password"
  element={<ResetPasswordPage />}
/>

<Route
  path="/verify-email"
  element={<VerifyEmailPage />}
/>

                {/* =========================
                    CUSTOMER PROFILE
                ========================== */}

                <Route
                  path="/profile"
                  element={
                    <ProtectedRoute>
                      <ProfilePage />
                    </ProtectedRoute>
                  }
                />

                {/* =========================
                    ADMIN AUTHENTICATION
                ========================== */}

                <Route
                  path="/admin/login"
                  element={<AdminLoginPage />}
                />

                {/* =========================
                    ADMIN DASHBOARD
                ========================== */}

                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute adminOnly>
                      <AdminDashboardPage />
                    </ProtectedRoute>
                  }
                />

                {/* =========================
                    ADMIN PRODUCTS
                ========================== */}

                <Route
                  path="/admin/products"
                  element={
                    <ProtectedRoute adminOnly>
                      <AdminProductsPage />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/admin/products/new"
                  element={
                    <ProtectedRoute adminOnly>
                      <AdminProductFormPage />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/admin/products/import"
                  element={
                    <ProtectedRoute adminOnly>
                      <AdminImportPage />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/admin/products/:id/edit"
                  element={
                    <ProtectedRoute adminOnly>
                      <AdminProductFormPage />
                    </ProtectedRoute>
                  }
                />

                {/* =========================
                    ADMIN ADVERTISEMENTS
                ========================== */}

                <Route
                  path="/admin/ads"
                  element={
                    <ProtectedRoute adminOnly>
                      <AdminAdsPage />
                    </ProtectedRoute>
                  }
                />

                {/* =========================
                    ADMIN ORDERS
                ========================== */}

                <Route
                  path="/admin/orders"
                  element={
                    <ProtectedRoute adminOnly>
                      <AdminOrdersPage />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/admin/revenue"
                  element={
                    <ProtectedRoute adminOnly>
                      <AdminRevenuePage />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/admin/customers"
                  element={
                    <ProtectedRoute adminOnly>
                      <AdminCustomersPage />
                    </ProtectedRoute>
                  }
                />

                {/* =========================
                    ADMIN SELLER MANAGEMENT
                ========================== */}

                <Route
                  path="/admin/sellers"
                  element={
                    <ProtectedRoute adminOnly>
                      <AdminSellerApplicationsPage />
                    </ProtectedRoute>
                  }
                />

                {/* =========================
                    ADMIN PRODUCT APPROVALS
                ========================== */}

                <Route
                  path="/admin/product-approvals"
                  element={
                    <ProtectedRoute adminOnly>
                      <AdminProductApprovalsPage />
                    </ProtectedRoute>
                  }
                />

                {/* =========================
                    ADMIN VENDOR STORES
                ========================== */}

                <Route
                  path="/vendors"
                  element={
                    <ProtectedRoute adminOnly>
                      <VendorStoresPage />
                    </ProtectedRoute>
                  }
                />

                {/* =========================
                    ADMIN VENDOR PRODUCTS
                ========================== */}

                <Route
                  path="/vendors/:sellerId/products"
                  element={
                    <ProtectedRoute adminOnly>
                      <VendorProductsPage />
                    </ProtectedRoute>
                  }
                />

                {/* =========================
                    FALLBACK
                ========================== */}

                <Route
                  path="*"
                  element={<HomePage />}
                />

              </Routes>
            </main>

            <Footer />
            <ChatWidget />
          </div>
        </Router>
      </CartProvider>
    </AuthProvider>
  );
}

export default App;