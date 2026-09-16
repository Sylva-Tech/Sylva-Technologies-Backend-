import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
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
import ProfilePage from './pages/ProfilePage';
import CheckoutPage from './pages/CheckoutPage';
import InformationPage from './pages/InformationPage';
import ContactPage from './pages/ContactPage';
import { CartProvider } from './context/CartContext';
import ChatWidget from './components/ChatWidget';
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
                <Route path="/" element={<HomePage />} />
                <Route path="/shop" element={<ShopPage />} />
                <Route path="/categories" element={<ShopPage />} />
                <Route path="/about" element={<InformationPage type="about" />} />
                <Route path="/privacy" element={<InformationPage type="privacy" />} />
                <Route path="/terms" element={<InformationPage type="terms" />} />
                <Route path="/contact" element={<ContactPage />} />
                <Route path="/product/:slug" element={<ProductDetailPage />} />
                <Route path="/cart" element={<CartPage />} />
                <Route
                  path="/checkout"
                  element={
                    <ProtectedRoute>
                      <CheckoutPage />
                    </ProtectedRoute>
                  }
                />
                <Route path="/login" element={<AuthPage mode="login" />} />
                <Route path="/register" element={<AuthPage mode="register" />} />
                <Route
                  path="/profile"
                  element={
                    <ProtectedRoute>
                      <ProfilePage />
                    </ProtectedRoute>
                  }
                />
                <Route path="/admin/login" element={<AdminLoginPage />} />
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute adminOnly>
                      <AdminDashboardPage />
                    </ProtectedRoute>
                  }
                />
                <Route path="/admin/products" element={<ProtectedRoute adminOnly><AdminProductsPage /></ProtectedRoute>} />
                <Route path="/admin/products/new" element={<ProtectedRoute adminOnly><AdminProductFormPage /></ProtectedRoute>} />
                <Route path="/admin/products/import" element={<ProtectedRoute adminOnly><AdminImportPage /></ProtectedRoute>} />
                <Route path="/admin/products/:id/edit" element={<ProtectedRoute adminOnly><AdminProductFormPage /></ProtectedRoute>} />
                <Route path="/admin/ads" element={<ProtectedRoute adminOnly><AdminAdsPage /></ProtectedRoute>} />
                <Route path="*" element={<HomePage />} />
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
