import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function ProtectedRoute({
  children,
  adminOnly = false,
  sellerOnly = false,
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="container section-block">
        Loading...
      </div>
    );
  }

  if (!user) {
    if (sellerOnly) {
      return <Navigate to="/seller/login" replace />;
    }

    if (adminOnly) {
      return <Navigate to="/admin/login" replace />;
    }

    return <Navigate to="/login" replace />;
  }

  if (adminOnly && user.role !== 'admin') {
    return <Navigate to="/admin/login" replace />;
  }

  if (sellerOnly && user.role !== 'seller') {
    return <Navigate to="/seller/login" replace />;
  }

  return children;
}

export default ProtectedRoute;

