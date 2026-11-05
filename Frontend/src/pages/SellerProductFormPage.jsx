import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  ImagePlus,
  Package,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';

import api from '../services/api';
import './SellerProductFormPage.css';

const MAX_IMAGES = 4;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const initialForm = {
  name: '',
  brand: '',
  category: '',
  subcategory: '',
  sku: '',
  condition: 'New',
  price: '',
  oldPrice: '',
  stock: '',
  shortDescription: '',
  description: '',
  keyFeatures: '',
  warranty: '',
  warrantyDuration: '',
  warrantyTerms: '',
  deliveryDuration: '',
  deliveryFee: '0',
  deliveryTerms: '',
  deliveryLocations: '',
  returnPeriod: '',
  returnPolicy: '',
  returnConditions: '',
  whatsIncluded: '',
  sellerNotes: '',
  isNew: true,
};

const emptySpecification = {
  name: '',
  value: '',
};

const getCategories = (response) => {
  const data = response?.data;

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.categories)) {
    return data.categories;
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  if (Array.isArray(data?.data?.categories)) {
    return data.data.categories;
  }

  return [];
};

const getCategoryId = (category) => {
  if (!category) return '';

  return (
    category._id ||
    category.id ||
    category.value ||
    ''
  );
};

const getCategoryName = (category) => {
  if (!category) return '';

  return (
    category.name ||
    category.title ||
    category.label ||
    ''
  );
};

const getErrorMessage = (error) => {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    'Unable to create the product. Please try again.'
  );
};

export default function SellerProductFormPage() {
  const navigate = useNavigate();

  const [form, setForm] = useState(initialForm);
  const [categories, setCategories] = useState([]);
  const [categoryLoading, setCategoryLoading] = useState(true);

  const [images, setImages] = useState([]);
  const [specifications, setSpecifications] = useState([
    { ...emptySpecification },
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let mounted = true;

    const loadCategories = async () => {
      try {
        setCategoryLoading(true);

        const response = await api.get('/categories');

        if (mounted) {
          setCategories(getCategories(response));
        }
      } catch (requestError) {
        if (mounted) {
          setError(
            getErrorMessage(requestError)
          );
        }
      } finally {
        if (mounted) {
          setCategoryLoading(false);
        }
      }
    };

    loadCategories();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      images.forEach((image) => {
        if (image.preview) {
          URL.revokeObjectURL(image.preview);
        }
      });
    };
  }, [images]);

  const selectedCategory = useMemo(() => {
    return categories.find(
      (category) =>
        String(getCategoryId(category)) ===
        String(form.category)
    );
  }, [categories, form.category]);

  const handleChange = (event) => {
    const { name, value, type, checked } =
      event.target;

    setForm((current) => ({
      ...current,
      [name]:
        type === 'checkbox'
          ? checked
          : value,
    }));

    if (error) {
      setError('');
    }

    if (success) {
      setSuccess('');
    }
  };

  const handleImageChange = (event) => {
    const selectedFiles = Array.from(
      event.target.files || []
    );

    if (!selectedFiles.length) {
      return;
    }

    setError('');
    setSuccess('');

    const remainingSlots =
      MAX_IMAGES - images.length;

    if (remainingSlots <= 0) {
      setError(
        `You can upload a maximum of ${MAX_IMAGES} product images.`
      );
      event.target.value = '';
      return;
    }

    const filesToAdd = selectedFiles.slice(
      0,
      remainingSlots
    );

    const invalidFile = filesToAdd.find(
      (file) => {
        const validType = [
          'image/jpeg',
          'image/png',
          'image/webp',
        ].includes(file.type);

        return (
          !validType ||
          file.size > MAX_FILE_SIZE
        );
      }
    );

    if (invalidFile) {
      setError(
        'Images must be JPG, PNG or WEBP and each image must not exceed 5 MB.'
      );
      event.target.value = '';
      return;
    }

    const newImages = filesToAdd.map(
      (file) => ({
        file,
        preview: URL.createObjectURL(file),
      })
    );

    setImages((current) => [
      ...current,
      ...newImages,
    ]);

    if (
      selectedFiles.length >
      filesToAdd.length
    ) {
      setError(
        `Only ${MAX_IMAGES} images can be uploaded. Extra images were not added.`
      );
    }

    event.target.value = '';
  };

  const removeImage = (index) => {
    setImages((current) => {
      const imageToRemove = current[index];

      if (imageToRemove?.preview) {
        URL.revokeObjectURL(
          imageToRemove.preview
        );
      }

      return current.filter(
        (_, imageIndex) =>
          imageIndex !== index
      );
    });
  };

  const handleSpecificationChange = (
    index,
    field,
    value
  ) => {
    setSpecifications((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]: value,
            }
          : item
      )
    );
  };

  const addSpecification = () => {
    setSpecifications((current) => [
      ...current,
      { ...emptySpecification },
    ]);
  };

  const removeSpecification = (index) => {
    setSpecifications((current) => {
      if (current.length === 1) {
        return [
          { ...emptySpecification },
        ];
      }

      return current.filter(
        (_, itemIndex) =>
          itemIndex !== index
      );
    });
  };

  const validateForm = () => {
    if (!images.length) {
      return 'Please upload at least one product image.';
    }

    if (images.length > MAX_IMAGES) {
      return `You can upload a maximum of ${MAX_IMAGES} images.`;
    }

    if (!form.name.trim()) {
      return 'Product name is required.';
    }

    if (!form.brand.trim()) {
      return 'Brand is required.';
    }

    if (!form.category) {
      return 'Please select a category.';
    }

    if (!form.sku.trim()) {
      return 'SKU is required.';
    }

    if (
      form.price === '' ||
      Number(form.price) < 0
    ) {
      return 'Please enter a valid product price.';
    }

    if (
      form.oldPrice !== '' &&
      Number(form.oldPrice) < 0
    ) {
      return 'Previous price cannot be negative.';
    }

    if (
      form.stock === '' ||
      Number(form.stock) < 0
    ) {
      return 'Please enter a valid stock quantity.';
    }

    if (!form.description.trim()) {
      return 'Full product description is required.';
    }

    if (
      form.deliveryFee !== '' &&
      Number(form.deliveryFee) < 0
    ) {
      return 'Delivery fee cannot be negative.';
    }

    return '';
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    setError('');
    setSuccess('');

    const validationError =
      validateForm();

    if (validationError) {
      setError(validationError);
      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
      return;
    }

    try {
      setSubmitting(true);

      const formData = new FormData();

      formData.append(
        'name',
        form.name.trim()
      );

      formData.append(
        'brand',
        form.brand.trim()
      );

      formData.append(
        'category',
        form.category
      );

      formData.append(
        'subcategory',
        form.subcategory.trim()
      );

      formData.append(
        'sku',
        form.sku.trim()
      );

      formData.append(
        'condition',
        form.condition
      );

      formData.append(
        'price',
        form.price
      );

      formData.append(
        'oldPrice',
        form.oldPrice || '0'
      );

      formData.append(
        'stock',
        form.stock
      );

      formData.append(
        'shortDescription',
        form.shortDescription.trim()
      );

      formData.append(
        'description',
        form.description.trim()
      );

      formData.append(
        'keyFeatures',
        form.keyFeatures.trim()
      );

      formData.append(
        'warranty',
        form.warranty.trim()
      );

      formData.append(
        'warrantyDuration',
        form.warrantyDuration.trim()
      );

      formData.append(
        'warrantyTerms',
        form.warrantyTerms.trim()
      );

      formData.append(
        'deliveryDuration',
        form.deliveryDuration.trim()
      );

      formData.append(
        'deliveryFee',
        form.deliveryFee || '0'
      );

      formData.append(
        'deliveryTerms',
        form.deliveryTerms.trim()
      );

      formData.append(
        'deliveryLocations',
        form.deliveryLocations.trim()
      );

      formData.append(
        'returnPeriod',
        form.returnPeriod.trim()
      );

      formData.append(
        'returnPolicy',
        form.returnPolicy.trim()
      );

      formData.append(
        'returnConditions',
        form.returnConditions.trim()
      );

      formData.append(
        'whatsIncluded',
        form.whatsIncluded.trim()
      );

      formData.append(
        'sellerNotes',
        form.sellerNotes.trim()
      );

      formData.append(
        'isNew',
        String(form.isNew)
      );

      const specificationObject =
        specifications.reduce(
          (result, specification) => {
            const key =
              specification.name.trim();
            const value =
              specification.value.trim();

            if (key && value) {
              result[key] = value;
            }

            return result;
          },
          {}
        );

      formData.append(
        'specifications',
        JSON.stringify(
          specificationObject
        )
      );

      images.forEach((image) => {
        formData.append(
          'images',
          image.file
        );
      });

      const response = await api.post(
        '/products/seller',
        formData
      );

      const responseMessage =
        response?.data?.message ||
        'Product submitted successfully.';

      setSuccess(responseMessage);

      setTimeout(() => {
        navigate('/seller/dashboard');
      }, 1800);
    } catch (requestError) {
      setError(
        getErrorMessage(requestError)
      );

      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="seller-product-form-page">
      <div className="seller-product-form-container">
        <div className="seller-product-form-header">
          <Link
            to="/seller/dashboard"
            className="seller-back-link"
          >
            <ArrowLeft size={18} />
            Back to Seller Dashboard
          </Link>

          <div>
            <h1>Add New Product</h1>
            <p>
              Add your product information,
              images, delivery details and
              return policy.
            </p>
          </div>
        </div>

        {error && (
          <div className="seller-form-alert seller-form-alert-error">
            <X size={19} />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="seller-form-alert seller-form-alert-success">
            <CheckCircle2 size={19} />
            <span>{success}</span>
          </div>
        )}

        <form
          className="seller-product-form"
          onSubmit={handleSubmit}
        >
          <section className="seller-form-section">
            <div className="seller-section-heading">
              <div className="seller-section-icon">
                <ImagePlus size={21} />
              </div>

              <div>
                <h2>Product Images</h2>
                <p>
                  Upload up to 4 clear product
                  images.
                </p>
              </div>
            </div>

            <div className="seller-image-upload">
              <div className="seller-image-grid">
                {images.map(
                  (image, index) => (
                    <div
                      className="seller-image-preview"
                      key={image.preview}
                    >
                      <img
                        src={image.preview}
                        alt={`Product preview ${
                          index + 1
                        }`}
                      />

                      <button
                        type="button"
                        className="seller-remove-image"
                        onClick={() =>
                          removeImage(index)
                        }
                        aria-label={`Remove image ${
                          index + 1
                        }`}
                      >
                        <X size={16} />
                      </button>

                      {index === 0 && (
                        <span className="seller-main-image-label">
                          Main image
                        </span>
                      )}
                    </div>
                  )
                )}

                {images.length <
                  MAX_IMAGES && (
                  <label className="seller-image-add">
                    <ImagePlus size={28} />
                    <strong>
                      Add Image
                    </strong>
                    <span>
                      {images.length}/
                      {MAX_IMAGES}
                    </span>

                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      onChange={
                        handleImageChange
                      }
                    />
                  </label>
                )}
              </div>

              <p className="seller-form-help">
                JPG, PNG or WEBP only. Maximum
                5 MB per image. You can upload
                up to 4 images.
              </p>
            </div>
          </section>

          <section className="seller-form-section">
            <div className="seller-section-heading">
              <div className="seller-section-icon">
                <Package size={21} />
              </div>

              <div>
                <h2>Basic Information</h2>
                <p>
                  Tell customers what you are
                  selling.
                </p>
              </div>
            </div>

            <div className="seller-form-grid">
              <label className="seller-field seller-field-full">
                <span>
                  Product Name
                  <b>*</b>
                </span>

                <input
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  placeholder="e.g. Dell Latitude 5420 Core i5"
                  required
                />
              </label>

              <label className="seller-field">
                <span>
                  Brand
                  <b>*</b>
                </span>

                <input
                  type="text"
                  name="brand"
                  value={form.brand}
                  onChange={handleChange}
                  placeholder="e.g. Dell"
                  required
                />
              </label>

              <label className="seller-field">
                <span>
                  Category
                  <b>*</b>
                </span>

                <select
                  name="category"
                  value={form.category}
                  onChange={handleChange}
                  required
                  disabled={categoryLoading}
                >
                  <option value="">
                    {categoryLoading
                      ? 'Loading categories...'
                      : 'Select category'}
                  </option>

                  {categories.map(
                    (category) => (
                      <option
                        key={getCategoryId(
                          category
                        )}
                        value={getCategoryId(
                          category
                        )}
                      >
                        {getCategoryName(
                          category
                        )}
                      </option>
                    )
                  )}
                </select>

                {selectedCategory && (
                  <small>
                    Selected:{' '}
                    {getCategoryName(
                      selectedCategory
                    )}
                  </small>
                )}
              </label>

              <label className="seller-field">
                <span>
                  Subcategory
                </span>

                <input
                  type="text"
                  name="subcategory"
                  value={
                    form.subcategory
                  }
                  onChange={handleChange}
                  placeholder="e.g. Business Laptops"
                />
              </label>

              <label className="seller-field">
                <span>
                  SKU
                  <b>*</b>
                </span>

                <input
                  type="text"
                  name="sku"
                  value={form.sku}
                  onChange={handleChange}
                  placeholder="e.g. DELL-LAT-5420-001"
                  required
                />
              </label>

              <label className="seller-field">
                <span>
                  Condition
                </span>

                <select
                  name="condition"
                  value={form.condition}
                  onChange={handleChange}
                >
                  <option value="New">
                    New
                  </option>
                  <option value="Refurbished">
                    Refurbished
                  </option>
                  <option value="Used">
                    Used
                  </option>
                </select>
              </label>

              <label className="seller-checkbox-field seller-field-full">
                <input
                  type="checkbox"
                  name="isNew"
                  checked={form.isNew}
                  onChange={handleChange}
                />

                <span>
                  Mark this as a new product
                </span>
              </label>
            </div>
          </section>

          <section className="seller-form-section">
            <div className="seller-section-heading">
              <div className="seller-section-icon">
                <Package size={21} />
              </div>

              <div>
                <h2>
                  Pricing & Inventory
                </h2>
                <p>
                  Set your selling price and
                  available quantity.
                </p>
              </div>
            </div>

            <div className="seller-form-grid">
              <label className="seller-field">
                <span>
                  Selling Price (KSh)
                  <b>*</b>
                </span>

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  name="price"
                  value={form.price}
                  onChange={handleChange}
                  placeholder="85000"
                  required
                />
              </label>

              <label className="seller-field">
                <span>
                  Previous Price (KSh)
                </span>

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  name="oldPrice"
                  value={form.oldPrice}
                  onChange={handleChange}
                  placeholder="95000"
                />
              </label>

              <label className="seller-field">
                <span>
                  Stock Quantity
                  <b>*</b>
                </span>

                <input
                  type="number"
                  min="0"
                  step="1"
                  name="stock"
                  value={form.stock}
                  onChange={handleChange}
                  placeholder="10"
                  required
                />
              </label>
            </div>
          </section>

          <section className="seller-form-section">
            <div className="seller-section-heading">
              <div className="seller-section-icon">
                <Package size={21} />
              </div>

              <div>
                <h2>
                  Product Description
                </h2>
                <p>
                  Give customers enough
                  information to understand the
                  product.
                </p>
              </div>
            </div>

            <div className="seller-form-stack">
              <label className="seller-field">
                <span>
                  Short Description
                </span>

                <textarea
                  name="shortDescription"
                  value={
                    form.shortDescription
                  }
                  onChange={handleChange}
                  rows="3"
                  placeholder="A short summary shown in product listings."
                />
              </label>

              <label className="seller-field">
                <span>
                  Full Description
                  <b>*</b>
                </span>

                <textarea
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  rows="7"
                  placeholder="Describe the product, its condition, usage, compatibility and important details."
                  required
                />
              </label>

              <label className="seller-field">
                <span>
                  Key Features
                </span>

                <textarea
                  name="keyFeatures"
                  value={form.keyFeatures}
                  onChange={handleChange}
                  rows="6"
                  placeholder={`Intel Core i5 processor
16GB RAM
512GB SSD
14-inch Full HD display
Wi-Fi and Bluetooth`}
                />

                <small>
                  Enter one feature per line.
                </small>
              </label>
            </div>
          </section>

          <section className="seller-form-section">
            <div className="seller-section-heading">
              <div className="seller-section-icon">
                <Package size={21} />
              </div>

              <div>
                <h2>
                  Specifications
                </h2>
                <p>
                  Add technical details such as
                  RAM, storage, processor and
                  screen size.
                </p>
              </div>
            </div>

            <div className="seller-specifications">
              {specifications.map(
                (
                  specification,
                  index
                ) => (
                  <div
                    className="seller-specification-row"
                    key={index}
                  >
                    <input
                      type="text"
                      value={
                        specification.name
                      }
                      onChange={(event) =>
                        handleSpecificationChange(
                          index,
                          'name',
                          event.target.value
                        )
                      }
                      placeholder="Specification e.g. RAM"
                    />

                    <input
                      type="text"
                      value={
                        specification.value
                      }
                      onChange={(event) =>
                        handleSpecificationChange(
                          index,
                          'value',
                          event.target.value
                        )
                      }
                      placeholder="Value e.g. 16GB"
                    />

                    <button
                      type="button"
                      className="seller-delete-spec"
                      onClick={() =>
                        removeSpecification(
                          index
                        )
                      }
                      title="Remove specification"
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                )
              )}

              <button
                type="button"
                className="seller-add-spec"
                onClick={
                  addSpecification
                }
              >
                <Plus size={17} />
                Add Specification
              </button>
            </div>
          </section>

          <section className="seller-form-section">
            <div className="seller-section-heading">
              <div className="seller-section-icon">
                <CheckCircle2 size={21} />
              </div>

              <div>
                <h2>
                  Warranty & Support
                </h2>
                <p>
                  Clearly explain the warranty
                  offered with the product.
                </p>
              </div>
            </div>

            <div className="seller-form-grid">
              <label className="seller-field">
                <span>
                  Warranty
                </span>

                <input
                  type="text"
                  name="warranty"
                  value={form.warranty}
                  onChange={handleChange}
                  placeholder="e.g. 6 Months Seller Warranty"
                />
              </label>

              <label className="seller-field">
                <span>
                  Warranty Duration
                </span>

                <input
                  type="text"
                  name="warrantyDuration"
                  value={
                    form.warrantyDuration
                  }
                  onChange={handleChange}
                  placeholder="e.g. 6 months"
                />
              </label>

              <label className="seller-field seller-field-full">
                <span>
                  Warranty Terms
                </span>

                <textarea
                  name="warrantyTerms"
                  value={
                    form.warrantyTerms
                  }
                  onChange={handleChange}
                  rows="4"
                  placeholder="Explain what is covered and what is not covered."
                />
              </label>
            </div>
          </section>

          <section className="seller-form-section">
            <div className="seller-section-heading">
              <div className="seller-section-icon">
                <Package size={21} />
              </div>

              <div>
                <h2>
                  Delivery Information
                </h2>
                <p>
                  Tell customers when and where
                  the product can be delivered.
                </p>
              </div>
            </div>

            <div className="seller-form-grid">
              <label className="seller-field">
                <span>
                  Delivery Duration
                </span>

                <input
                  type="text"
                  name="deliveryDuration"
                  value={
                    form.deliveryDuration
                  }
                  onChange={handleChange}
                  placeholder="e.g. 1–3 business days"
                />
              </label>

              <label className="seller-field">
                <span>
                  Delivery Fee (KSh)
                </span>

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  name="deliveryFee"
                  value={form.deliveryFee}
                  onChange={handleChange}
                  placeholder="300"
                />
              </label>

              <label className="seller-field seller-field-full">
                <span>
                  Delivery Locations
                </span>

                <input
                  type="text"
                  name="deliveryLocations"
                  value={
                    form.deliveryLocations
                  }
                  onChange={handleChange}
                  placeholder="e.g. Nairobi, Kiambu, Thika and selected towns countrywide"
                />
              </label>

              <label className="seller-field seller-field-full">
                <span>
                  Delivery Terms
                </span>

                <textarea
                  name="deliveryTerms"
                  value={
                    form.deliveryTerms
                  }
                  onChange={handleChange}
                  rows="4"
                  placeholder="Explain dispatch times, delivery arrangements and any conditions."
                />
              </label>
            </div>
          </section>

          <section className="seller-form-section">
            <div className="seller-section-heading">
              <div className="seller-section-icon">
                <CheckCircle2 size={21} />
              </div>

              <div>
                <h2>
                  Returns & Refunds
                </h2>
                <p>
                  Provide a clear return policy
                  for customers.
                </p>
              </div>
            </div>

            <div className="seller-form-grid">
              <label className="seller-field">
                <span>
                  Return Period
                </span>

                <input
                  type="text"
                  name="returnPeriod"
                  value={
                    form.returnPeriod
                  }
                  onChange={handleChange}
                  placeholder="e.g. 7 days"
                />
              </label>

              <label className="seller-field seller-field-full">
                <span>
                  Return Policy
                </span>

                <textarea
                  name="returnPolicy"
                  value={
                    form.returnPolicy
                  }
                  onChange={handleChange}
                  rows="4"
                  placeholder="Explain whether returns, exchanges or refunds are available."
                />
              </label>

              <label className="seller-field seller-field-full">
                <span>
                  Return Conditions
                </span>

                <textarea
                  name="returnConditions"
                  value={
                    form.returnConditions
                  }
                  onChange={handleChange}
                  rows="4"
                  placeholder="For example: item must be returned in original condition with accessories and packaging."
                />
              </label>
            </div>
          </section>

          <section className="seller-form-section">
            <div className="seller-section-heading">
              <div className="seller-section-icon">
                <Package size={21} />
              </div>

              <div>
                <h2>
                  Package & Seller Information
                </h2>
                <p>
                  Add additional information
                  customers may need.
                </p>
              </div>
            </div>

            <div className="seller-form-stack">
              <label className="seller-field">
                <span>
                  What's Included
                </span>

                <textarea
                  name="whatsIncluded"
                  value={
                    form.whatsIncluded
                  }
                  onChange={handleChange}
                  rows="4"
                  placeholder={`Laptop
Charger
User documentation`}
                />
              </label>

              <label className="seller-field">
                <span>
                  Additional Seller Notes
                </span>

                <textarea
                  name="sellerNotes"
                  value={form.sellerNotes}
                  onChange={handleChange}
                  rows="4"
                  placeholder="Additional information about stock, packaging or product handling."
                />
              </label>
            </div>
          </section>

          <section className="seller-submission-notice">
            <CheckCircle2 size={22} />

            <div>
              <strong>
                Admin approval required
              </strong>

              <p>
                After submission, your product
                will be reviewed by Sylva
                Technologies before it becomes
                visible to customers. The product
                will remain pending until an
                administrator approves it.
              </p>
            </div>
          </section>

          <div className="seller-form-actions">
            <button
              type="button"
              className="seller-cancel-button"
              onClick={() =>
                navigate(
                  '/seller/dashboard'
                )
              }
              disabled={submitting}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="seller-submit-button"
              disabled={submitting}
            >
              <Save size={18} />

              {submitting
                ? 'Submitting Product...'
                : 'Submit Product for Approval'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}