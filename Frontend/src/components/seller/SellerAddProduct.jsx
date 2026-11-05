import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ImagePlus,
  PackagePlus,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';

import api from '../../services/api';

import './SellerAddProduct.css';

const initialForm = {
  name: '',
  sku: '',
  brand: '',
  category: '',
  subcategory: '',
  price: '',
  oldPrice: '',
  stock: '',
  condition: 'New',
  warranty: '',
  shortDescription: '',
  description: '',
};

function SellerAddProduct({
  onCancel,
  onSaved,
}) {
  const [form, setForm] = useState(initialForm);
  const [categories, setCategories] = useState([]);
  const [specifications, setSpecifications] = useState([
    { key: '', value: '' },
  ]);

  const [images, setImages] = useState([]);
  const [previews, setPreviews] = useState([]);

  const [loadingCategories, setLoadingCategories] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let mounted = true;

    const loadCategories = async () => {
      try {
        const response = await api.get('/categories');

        const data = response?.data ?? response;

        const categoryList =
          data?.categories ||
          data?.data?.categories ||
          data?.data ||
          data;

        if (mounted && Array.isArray(categoryList)) {
          setCategories(categoryList);
        }
      } catch (err) {
        console.error('Failed to load categories:', err);

        if (mounted) {
          setError(
            err?.response?.data?.message ||
              'Unable to load product categories.'
          );
        }
      } finally {
        if (mounted) {
          setLoadingCategories(false);
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
      previews.forEach((preview) => {
        URL.revokeObjectURL(preview);
      });
    };
  }, [previews]);

  const discount = useMemo(() => {
    const price = Number(form.price);
    const oldPrice = Number(form.oldPrice);

    if (
      !price ||
      !oldPrice ||
      oldPrice <= price
    ) {
      return 0;
    }

    return Math.round(
      ((oldPrice - price) / oldPrice) * 100
    );
  }, [form.price, form.oldPrice]);

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleImageChange = (event) => {
    const selectedFiles = Array.from(
      event.target.files || []
    );

    if (!selectedFiles.length) {
      return;
    }

    setError('');

    const availableSlots = 8 - images.length;

    if (availableSlots <= 0) {
      setError(
        'You can upload a maximum of 8 product images.'
      );
      return;
    }

    const filesToAdd = selectedFiles
      .slice(0, availableSlots)
      .filter((file) =>
        [
          'image/jpeg',
          'image/png',
          'image/webp',
        ].includes(file.type)
      );

    if (filesToAdd.length !== selectedFiles.slice(0, availableSlots).length) {
      setError(
        'Only JPG, PNG and WEBP images are allowed.'
      );
    }

    const oversized = filesToAdd.find(
      (file) => file.size > 5 * 1024 * 1024
    );

    if (oversized) {
      setError(
        'Each product image must be 5MB or smaller.'
      );
      event.target.value = '';
      return;
    }

    const newPreviews = filesToAdd.map((file) =>
      URL.createObjectURL(file)
    );

    setImages((current) => [
      ...current,
      ...filesToAdd,
    ]);

    setPreviews((current) => [
      ...current,
      ...newPreviews,
    ]);

    event.target.value = '';
  };

  const removeImage = (index) => {
    setImages((current) =>
      current.filter((_, itemIndex) => itemIndex !== index)
    );

    setPreviews((current) => {
      const previewToRemove = current[index];

      if (previewToRemove) {
        URL.revokeObjectURL(previewToRemove);
      }

      return current.filter(
        (_, itemIndex) => itemIndex !== index
      );
    });
  };

  const addSpecification = () => {
    setSpecifications((current) => [
      ...current,
      { key: '', value: '' },
    ]);
  };

  const updateSpecification = (
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

  const removeSpecification = (index) => {
    setSpecifications((current) =>
      current.length === 1
        ? [{ key: '', value: '' }]
        : current.filter(
            (_, itemIndex) => itemIndex !== index
          )
    );
  };

  const validateForm = () => {
    if (!form.name.trim()) {
      return 'Product name is required.';
    }

    if (!form.sku.trim()) {
      return 'SKU is required.';
    }

    if (!form.brand.trim()) {
      return 'Brand is required.';
    }

    if (!form.category) {
      return 'Please select a product category.';
    }

    if (!form.price || Number(form.price) <= 0) {
      return 'Please enter a valid product price.';
    }

    if (
      form.oldPrice &&
      Number(form.oldPrice) < Number(form.price)
    ) {
      return 'Old price should be greater than or equal to the current price.';
    }

    if (
      form.stock === '' ||
      Number(form.stock) < 0
    ) {
      return 'Please enter a valid stock quantity.';
    }

    if (!form.description.trim()) {
      return 'Product description is required.';
    }

    if (images.length === 0) {
      return 'Please upload at least one product image.';
    }

    return '';
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    setError('');
    setSuccess('');

    const validationError = validateForm();

    if (validationError) {
      setError(validationError);
      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
      return;
    }

    setSaving(true);

    try {
      const formData = new FormData();

      formData.append(
        'name',
        form.name.trim()
      );

      formData.append(
        'sku',
        form.sku.trim()
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
        'price',
        String(Number(form.price))
      );

      formData.append(
        'oldPrice',
        form.oldPrice
          ? String(Number(form.oldPrice))
          : '0'
      );

      formData.append(
        'stock',
        String(Number(form.stock))
      );

      formData.append(
        'condition',
        form.condition
      );

      formData.append(
        'warranty',
        form.warranty.trim()
      );

      formData.append(
        'shortDescription',
        form.shortDescription.trim()
      );

      formData.append(
        'description',
        form.description.trim()
      );

      const specificationObject = {};

      specifications.forEach((item) => {
        const key = item.key.trim();
        const value = item.value.trim();

        if (key && value) {
          specificationObject[key] = value;
        }
      });

      formData.append(
        'specifications',
        JSON.stringify(specificationObject)
      );

      images.forEach((image) => {
        formData.append('images', image);
      });

      const response = await api.post(
        '/products/seller',
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      console.log(
        'Product created:',
        response?.data
      );

      setSuccess(
        'Product added successfully.'
      );

      setTimeout(() => {
        if (typeof onSaved === 'function') {
          onSaved();
        }
      }, 800);
    } catch (err) {
      console.error(
        'Failed to create seller product:',
        err
      );

      setError(
        err?.response?.data?.message ||
          'Unable to add the product. Please check your details and try again.'
      );

      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="seller-add-product">
      <div className="seller-add-product-header">
        <div>
          <button
            type="button"
            className="seller-back-button"
            onClick={onCancel}
          >
            <ArrowLeft size={18} />
            Back to Products
          </button>

          <div className="seller-add-product-title">
            <div className="seller-add-product-icon">
              <PackagePlus size={24} />
            </div>

            <div>
              <h1>Add Product</h1>
              <p>
                Add a new product to your Sylva
                Technologies store.
              </p>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="seller-form-alert seller-form-error">
          {error}
          <button
            type="button"
            onClick={() => setError('')}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {success && (
        <div className="seller-form-alert seller-form-success">
          {success}
        </div>
      )}

      <form
        className="seller-product-form"
        onSubmit={handleSubmit}
      >
        <div className="seller-form-grid">
          <div className="seller-form-main">
            <section className="seller-form-card">
              <div className="seller-form-card-header">
                <div>
                  <h2>Basic Information</h2>
                  <p>
                    Enter the main details customers
                    will see.
                  </p>
                </div>
              </div>

              <div className="seller-fields-grid">
                <div className="seller-field seller-field-full">
                  <label htmlFor="product-name">
                    Product Name *
                  </label>

                  <input
                    id="product-name"
                    type="text"
                    value={form.name}
                    onChange={(event) =>
                      updateField(
                        'name',
                        event.target.value
                      )
                    }
                    placeholder="e.g. Dell Latitude 5420"
                  />
                </div>

                <div className="seller-field">
                  <label htmlFor="product-sku">
                    SKU *
                  </label>

                  <input
                    id="product-sku"
                    type="text"
                    value={form.sku}
                    onChange={(event) =>
                      updateField(
                        'sku',
                        event.target.value.toUpperCase()
                      )
                    }
                    placeholder="e.g. DELL-5420-I5"
                  />
                </div>

                <div className="seller-field">
                  <label htmlFor="product-brand">
                    Brand *
                  </label>

                  <input
                    id="product-brand"
                    type="text"
                    value={form.brand}
                    onChange={(event) =>
                      updateField(
                        'brand',
                        event.target.value
                      )
                    }
                    placeholder="e.g. Dell"
                  />
                </div>

                <div className="seller-field">
                  <label htmlFor="product-category">
                    Category *
                  </label>

                  <select
                    id="product-category"
                    value={form.category}
                    onChange={(event) =>
                      updateField(
                        'category',
                        event.target.value
                      )
                    }
                    disabled={loadingCategories}
                  >
                    <option value="">
                      {loadingCategories
                        ? 'Loading categories...'
                        : 'Select category'}
                    </option>

                    {categories.map((category) => (
                      <option
                        key={category._id || category.id}
                        value={
                          category._id ||
                          category.id
                        }
                      >
                        {category.name ||
                          category.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="seller-field">
                  <label htmlFor="product-subcategory">
                    Subcategory
                  </label>

                  <input
                    id="product-subcategory"
                    type="text"
                    value={form.subcategory}
                    onChange={(event) =>
                      updateField(
                        'subcategory',
                        event.target.value
                      )
                    }
                    placeholder="e.g. Business Laptops"
                  />
                </div>
              </div>
            </section>

            <section className="seller-form-card">
              <div className="seller-form-card-header">
                <div>
                  <h2>Pricing & Stock</h2>
                  <p>
                    Set your selling price and
                    available quantity.
                  </p>
                </div>
              </div>

              <div className="seller-fields-grid">
                <div className="seller-field">
                  <label htmlFor="product-price">
                    Current Price (KSh) *
                  </label>

                  <input
                    id="product-price"
                    type="number"
                    min="0"
                    step="1"
                    value={form.price}
                    onChange={(event) =>
                      updateField(
                        'price',
                        event.target.value
                      )
                    }
                    placeholder="e.g. 45000"
                  />
                </div>

                <div className="seller-field">
                  <label htmlFor="product-old-price">
                    Old Price (KSh)
                  </label>

                  <input
                    id="product-old-price"
                    type="number"
                    min="0"
                    step="1"
                    value={form.oldPrice}
                    onChange={(event) =>
                      updateField(
                        'oldPrice',
                        event.target.value
                      )
                    }
                    placeholder="e.g. 52000"
                  />
                </div>

                <div className="seller-field">
                  <label htmlFor="product-stock">
                    Stock Quantity *
                  </label>

                  <input
                    id="product-stock"
                    type="number"
                    min="0"
                    step="1"
                    value={form.stock}
                    onChange={(event) =>
                      updateField(
                        'stock',
                        event.target.value
                      )
                    }
                    placeholder="e.g. 10"
                  />
                </div>

                <div className="seller-field">
                  <label htmlFor="product-condition">
                    Condition
                  </label>

                  <select
                    id="product-condition"
                    value={form.condition}
                    onChange={(event) =>
                      updateField(
                        'condition',
                        event.target.value
                      )
                    }
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
                </div>

                {discount > 0 && (
                  <div className="seller-discount-preview">
                    <strong>
                      {discount}% OFF
                    </strong>

                    <span>
                      Customer saves KSh{' '}
                      {(
                        Number(form.oldPrice) -
                        Number(form.price)
                      ).toLocaleString(
                        'en-KE'
                      )}
                    </span>
                  </div>
                )}
              </div>
            </section>

            <section className="seller-form-card">
              <div className="seller-form-card-header">
                <div>
                  <h2>Product Description</h2>
                  <p>
                    Give customers useful information
                    about the product.
                  </p>
                </div>
              </div>

              <div className="seller-field">
                <label htmlFor="product-short-description">
                  Short Description
                </label>

                <textarea
                  id="product-short-description"
                  rows="3"
                  maxLength="300"
                  value={form.shortDescription}
                  onChange={(event) =>
                    updateField(
                      'shortDescription',
                      event.target.value
                    )
                  }
                  placeholder="Briefly describe the product..."
                />
              </div>

              <div className="seller-field">
                <label htmlFor="product-description">
                  Full Description *
                </label>

                <textarea
                  id="product-description"
                  rows="8"
                  value={form.description}
                  onChange={(event) =>
                    updateField(
                      'description',
                      event.target.value
                    )
                  }
                  placeholder="Describe the product, features, condition and what is included..."
                />
              </div>

              <div className="seller-field">
                <label htmlFor="product-warranty">
                  Warranty
                </label>

                <input
                  id="product-warranty"
                  type="text"
                  value={form.warranty}
                  onChange={(event) =>
                    updateField(
                      'warranty',
                      event.target.value
                    )
                  }
                  placeholder="e.g. 6 Months Warranty"
                />
              </div>
            </section>

            <section className="seller-form-card">
              <div className="seller-form-card-header">
                <div>
                  <h2>Specifications</h2>
                  <p>
                    Add technical specifications such
                    as RAM, storage, processor and
                    screen size.
                  </p>
                </div>

                <button
                  type="button"
                  className="seller-small-button"
                  onClick={addSpecification}
                >
                  <Plus size={16} />
                  Add Specification
                </button>
              </div>

              <div className="seller-specifications">
                {specifications.map(
                  (specification, index) => (
                    <div
                      className="seller-spec-row"
                      key={index}
                    >
                      <input
                        type="text"
                        value={specification.key}
                        onChange={(event) =>
                          updateSpecification(
                            index,
                            'key',
                            event.target.value
                          )
                        }
                        placeholder="e.g. RAM"
                      />

                      <input
                        type="text"
                        value={
                          specification.value
                        }
                        onChange={(event) =>
                          updateSpecification(
                            index,
                            'value',
                            event.target.value
                          )
                        }
                        placeholder="e.g. 16GB"
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
              </div>
            </section>
          </div>

          <aside className="seller-form-sidebar">
            <section className="seller-form-card">
              <div className="seller-form-card-header">
                <div>
                  <h2>Product Images</h2>
                  <p>
                    Upload up to 8 clear product
                    images.
                  </p>
                </div>
              </div>

              <label className="seller-image-upload">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={handleImageChange}
                />

                <ImagePlus size={30} />

                <strong>
                  Upload Images
                </strong>

                <span>
                  JPG, PNG or WEBP
                </span>

                <small>
                  Maximum 5MB per image
                </small>
              </label>

              {previews.length > 0 && (
                <div className="seller-image-grid">
                  {previews.map(
                    (preview, index) => (
                      <div
                        className="seller-image-preview"
                        key={preview}
                      >
                        <img
                          src={preview}
                          alt={`Product preview ${
                            index + 1
                          }`}
                        />

                        {index === 0 && (
                          <span className="seller-primary-image">
                            Main
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            removeImage(index)
                          }
                          title="Remove image"
                        >
                          <X size={15} />
                        </button>
                      </div>
                    )
                  )}
                </div>
              )}

              <div className="seller-image-count">
                {images.length} / 8 images
              </div>
            </section>

            <section className="seller-form-card seller-publishing-card">
              <div className="seller-form-card-header">
                <div>
                  <h2>Publishing</h2>
                  <p>
                    Your product will be submitted to
                    the platform.
                  </p>
                </div>
              </div>

              <div className="seller-publishing-note">
                <PackagePlus size={20} />

                <p>
                  Platform-controlled features such as
                  featured products, flash sales and
                  promotional offers can be managed by
                  Sylva Technologies administrators.
                </p>
              </div>

              <div className="seller-form-actions">
                <button
                  type="button"
                  className="seller-cancel-button"
                  onClick={onCancel}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="seller-submit-button"
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save size={18} />
                      Add Product
                    </>
                  )}
                </button>
              </div>
            </section>
          </aside>
        </div>
      </form>
    </section>
  );
}

export default SellerAddProduct;