import axios from 'axios';

// Production backend API
const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL ||
  'https://sylva-technologies-backend.onrender.com/api';

const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// attach token if present
api.interceptors.request.use((config) => {
  try {
    const token = localStorage.getItem('sylva-token');
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (err) {
    // ignore
  }
  return config;
});

// Products
export const fetchProducts = async (params = {}) => {
  const response = await api.get('/products', { params });
  return response.data;
};

// Product by slug
export const fetchProductBySlug = async (slug) => {
  const response = await api.get(`/products/slug/${slug}`);
  return response.data;
};

// Categories
export const fetchCategories = async () => {
  const response = await api.get('/categories');
  return response.data;
};

// Advertisements
export const fetchAdvertisements = async () => {
  const response = await api.get('/advertisements');
  return response.data;
};

export const fetchFlipAdvertisements = async () => {
  const response = await api.get('/flip-advertisements');
  return response.data;
};

// Health check
export const healthCheck = async () => {
  const response = await api.get('/health');
  return response.data;
};
export const getAdminSellers =
  async () => {
    const response =
      await api.get(
        '/seller-management/admin/sellers'
      );

    return response.data;
  };

export const getAdminSeller =
  async (sellerId) => {
    const response =
      await api.get(
        `/seller-management/admin/sellers/${sellerId}`
      );

    return response.data;
  };

export const updateSellerStoreName =
  async (
    sellerId,
    storeName
  ) => {
    const response =
      await api.patch(
        `/seller-management/admin/sellers/${sellerId}/store`,
        {
          storeName,
        }
      );

    return response.data;
  };

export const suspendSeller =
  async (
    sellerId,
    reason
  ) => {
    const response =
      await api.patch(
        `/seller-management/admin/sellers/${sellerId}/suspend`,
        {
          reason,
        }
      );

    return response.data;
  };

export const banSeller =
  async (
    sellerId,
    reason
  ) => {
    const response =
      await api.patch(
        `/seller-management/admin/sellers/${sellerId}/ban`,
        {
          reason,
        }
      );

    return response.data;
  };

export const reactivateSeller =
  async (
    sellerId
  ) => {
    const response =
      await api.patch(
        `/seller-management/admin/sellers/${sellerId}/reactivate`
      );

    return response.data;
  };

export const getSellerStatus =
  async () => {
    const response =
      await api.get(
        '/seller-management/seller/status'
      );

    return response.data;
  };

export const submitSellerAppeal =
  async (
    type,
    reason
  ) => {
    const response =
      await api.post(
        '/seller-management/seller/appeals',
        {
          type,
          reason,
        }
      );

    return response.data;
  };

export const getSellerAppeals =
  async () => {
    const response =
      await api.get(
        '/seller-management/seller/appeals'
      );

    return response.data;
  };

export const getAdminAppeals =
  async () => {
    const response =
      await api.get(
        '/seller-management/admin/appeals'
      );

    return response.data;
  };

export const approveSellerAppeal =
  async (
    appealId,
    responseText = ''
  ) => {
    const response =
      await api.patch(
        `/seller-management/admin/appeals/${appealId}/approve`,
        {
          response:
            responseText,
        }
      );

    return response.data;
  };

export const rejectSellerAppeal =
  async (
    appealId,
    responseText
  ) => {
    const response =
      await api.patch(
        `/seller-management/admin/appeals/${appealId}/reject`,
        {
          response:
            responseText,
        }
      );

    return response.data;
  };
export default api;