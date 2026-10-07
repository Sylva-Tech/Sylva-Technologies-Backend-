const { google } = require('googleapis');
const mongoose = require('mongoose');

const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');

function getGoogleSheetsAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!email) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_EMAIL is missing.'
    );
  }

  if (!privateKey) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is missing.'
    );
  }

  return new google.auth.JWT({
    email,
    key: privateKey.replace(/\\n/g, '\n'),
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
  });
}

async function getGoogleSheetRows() {
  const spreadsheetId =
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

  const sheetName =
    process.env.GOOGLE_SHEETS_SHEET_NAME ||
    'Sylva Auto';

  if (!spreadsheetId) {
    throw new Error(
      'GOOGLE_SHEETS_SPREADSHEET_ID is missing.'
    );
  }

  const auth = getGoogleSheetsAuth();

  const sheets = google.sheets({
    version: 'v4',
    auth,
  });

  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:AL`,
    });

  const values = response.data.values || [];

  if (values.length === 0) {
    return [];
  }

  const headers = values[0].map((header) =>
    String(header || '')
      .trim()
      .toLowerCase()
  );

  const rows = [];

  for (let index = 1; index < values.length; index++) {
    const valuesRow = values[index] || [];

    const row = {};

    headers.forEach((header, columnIndex) => {
      row[header] =
        valuesRow[columnIndex] !== undefined
          ? valuesRow[columnIndex]
          : '';
    });

    row.__sheetRowNumber = index + 1;

    /*
     * Completely blank spreadsheet rows are ignored.
     *
     * This is important because Google Sheets may contain
     * formatting or an automatically generated code in
     * column A even when the actual product fields are empty.
     */
    const hasProductData = headers.some((header) => {
      if (header === 'id' || header === 'code') {
        return false;
      }

      return String(row[header] || '').trim() !== '';
    });

    if (!hasProductData) {
      continue;
    }

    rows.push(row);
  }

  return rows;
}

function buildSlug(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function toNumber(value, defaultValue = 0) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    return defaultValue;
  }

  const cleaned = String(value)
    .replace(/,/g, '')
    .replace(/ksh/gi, '')
    .replace(/kes/gi, '')
    .trim();

  const number = Number(cleaned);

  return Number.isFinite(number)
    ? number
    : defaultValue;
}

function parseBoolean(value, defaultValue = false) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    return defaultValue;
  }

  const normalized = String(value)
    .trim()
    .toLowerCase();

  if (
    ['true', '1', 'yes', 'y'].includes(normalized)
  ) {
    return true;
  }

  if (
    ['false', '0', 'no', 'n'].includes(normalized)
  ) {
    return false;
  }

  return defaultValue;
}

function parseDate(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

function parseKeyFeatures(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    return [];
  }

  return String(value)
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSpecifications(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    return {};
  }

  if (
    typeof value === 'object' &&
    value !== null
  ) {
    return value;
  }

  const text = String(value).trim();

  try {
    return JSON.parse(text);
  } catch {
    return {
      details: text,
    };
  }
}

function cleanImageUrl(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  return String(value).trim();
}

function calculateDiscount(price, oldPrice, suppliedDiscount) {
  if (
    suppliedDiscount !== null &&
    suppliedDiscount !== undefined &&
    String(suppliedDiscount).trim() !== ''
  ) {
    return Math.max(
      0,
      toNumber(suppliedDiscount)
    );
  }

  if (
    oldPrice > 0 &&
    price >= 0 &&
    oldPrice > price
  ) {
    return Math.round(
      ((oldPrice - price) / oldPrice) * 100
    );
  }

  return 0;
}

async function findCategory(categoryValue) {
  const categoryName =
    String(categoryValue || '').trim();

  if (!categoryName) {
    throw new Error(
      'Category is required.'
    );
  }

  const categorySlug =
    buildSlug(categoryName);

  let category =
    await Category.findOne({
      $or: [
        {
          slug: categorySlug,
        },
        {
          name: new RegExp(
            `^${categoryName}$`,
            'i'
          ),
        },
      ],
    });

  if (!category) {
    throw new Error(
      `Category "${categoryName}" was not found.`
    );
  }

  return category;
}

async function findSeller(sellerValue) {
  const value =
    String(sellerValue || '').trim();

  if (!value) {
    return null;
  }

  if (
    mongoose.Types.ObjectId.isValid(value)
  ) {
    const seller =
      await User.findOne({
        _id: value,
        role: 'seller',
        sellerStatus: 'approved',
      });

    if (seller) {
      return seller;
    }
  }

  const sellerByEmail =
    await User.findOne({
      email: value.toLowerCase(),
      role: 'seller',
      sellerStatus: 'approved',
    });

  if (sellerByEmail) {
    return sellerByEmail;
  }

  const sellerByStore =
    await User.findOne({
      'sellerProfile.storeName':
        new RegExp(
          `^${value}$`,
          'i'
        ),
      role: 'seller',
      sellerStatus: 'approved',
    });

  if (sellerByStore) {
    return sellerByStore;
  }

  throw new Error(
    `Approved seller "${value}" was not found.`
  );
}

async function generateUniqueSlug(
  name,
  existingProductId = null
) {
  const baseSlug = buildSlug(name);

  if (!baseSlug) {
    throw new Error(
      'Product name cannot produce a valid slug.'
    );
  }

  let slug = baseSlug;
  let counter = 2;

  while (true) {
    const query = {
      slug,
    };

    if (existingProductId) {
      query._id = {
        $ne: existingProductId,
      };
    }

    const existing =
      await Product.findOne(query)
        .select('_id')
        .lean();

    if (!existing) {
      return slug;
    }

    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}

async function syncProductRow(
  row,
  rowNumber
) {
  const code =
    String(row.code || '')
      .trim()
      .toUpperCase();

  const name =
    String(row.name || '').trim();

  const brand =
    String(row.brand || '').trim();

  const categoryValue =
    String(row.category || '').trim();

  /*
   * Ignore completely blank rows.
   */
  if (
    !code &&
    !name &&
    !brand &&
    !categoryValue
  ) {
    return {
      action: 'skipped',
      rowNumber,
      reason: 'Blank spreadsheet row.',
    };
  }

  /*
   * A row containing product information must have
   * the required identifying fields.
   */
  if (!code) {
    throw new Error(
      `Row ${rowNumber}: Product code is required.`
    );
  }

  if (!name) {
    throw new Error(
      `Row ${rowNumber}: Product name is required.`
    );
  }

  if (!brand) {
    throw new Error(
      `Row ${rowNumber}: Brand is required.`
    );
  }

  if (!categoryValue) {
    throw new Error(
      `Row ${rowNumber}: Category is required.`
    );
  }

  const category =
    await findCategory(categoryValue);

  const price =
    toNumber(row.price);

  const oldPrice =
    toNumber(row.oldPrice);

  const discount =
    calculateDiscount(
      price,
      oldPrice,
      row.discount
    );

  const images = [
    row.image1,
    row.image2,
    row.image3,
    row.image4,
  ]
    .map(cleanImageUrl)
    .filter(Boolean)
    .slice(0, 4);

  const seller =
    await findSeller(row.seller);

  const productData = {
    name,
    brand,
    category: category._id,
    subcategory:
      String(row.subcategory || '').trim(),

    description:
      String(row.description || '').trim(),

    shortDescription:
      String(row.shortDescription || '').trim(),

    price,
    oldPrice,
    discount,

    images,

    stock:
      Math.max(
        0,
        Math.floor(
          toNumber(row.stock)
        )
      ),

    condition:
      ['New', 'Refurbished', 'Used'].includes(
        String(row.condition || '').trim()
      )
        ? String(row.condition).trim()
        : 'New',

    warranty:
      String(row.warranty || '').trim(),

    warrantyDuration:
      String(
        row.warrantyDuration || ''
      ).trim(),

    warrantyTerms:
      String(
        row.warrantyTerms || ''
      ).trim(),

    deliveryDuration:
      String(
        row.deliveryDuration || ''
      ).trim(),

    deliveryFee:
      Math.max(
        0,
        toNumber(row.deliveryFee)
      ),

    deliveryTerms:
      String(
        row.deliveryTerms || ''
      ).trim(),

    deliveryLocations:
      String(
        row.deliveryLocations || ''
      ).trim(),

    returnPeriod:
      String(
        row.returnPeriod || ''
      ).trim(),

    returnPolicy:
      String(
        row.returnPolicy || ''
      ).trim(),

    returnConditions:
      String(
        row.returnConditions || ''
      ).trim(),

    whatsIncluded:
      String(
        row.whatsIncluded || ''
      ).trim(),

    keyFeatures:
      parseKeyFeatures(
        row.keyFeatures
      ),

    specifications:
      parseSpecifications(
        row.specifications
      ),

    featured:
      parseBoolean(
        row.featured
      ),

    isNew:
      parseBoolean(
        row.isNew
      ),

    flashSale:
      parseBoolean(
        row.flashSale
      ),

    offer:
      parseBoolean(
        row.offer
      ),

    offerMessage:
      String(
        row.offerMessage || ''
      ).trim(),

    offerStartDate:
      parseDate(
        row.offerStartDate
      ),

    offerEndDate:
      parseDate(
        row.offerEndDate
      ),

    isActive:
      parseBoolean(
        row.isActive,
        true
      ),

    seller:
      seller ? seller._id : null,

    approvalStatus: 'approved',

    rejectionReason: '',

    approvedAt: new Date(),
  };

  /*
   * Code is now the primary product identifier.
   */
  let product =
    await Product.findOne({
      code,
    });

  /*
   * Legacy fallback:
   *
   * If a product still has an old SKU matching the
   * Sheet code, update it rather than creating a duplicate.
   */
  if (!product) {
    product =
      await Product.findOne({
        sku: code,
      });
  }

  if (product) {
    /*
     * Keep the existing product ID.
     * Keep the existing legacy SKU for now.
     */
    const existingSlug =
      product.slug;

    Object.assign(
      product,
      productData
    );

    product.code = code;

    /*
     * Do not unnecessarily change an existing slug.
     */
    if (existingSlug) {
      product.slug = existingSlug;
    }

    await product.save();

    return {
      action: 'updated',
      rowNumber,
      code,
      productId: product._id,
      name: product.name,
    };
  }

  const slug =
    await generateUniqueSlug(
      name
    );

  const newProduct =
    await Product.create({
      ...productData,

      code,

      /*
       * Keep SKU populated for backward compatibility
       * while the rest of the application is migrated
       * from SKU to Code.
       */
      sku: code,

      slug,
    });

  return {
    action: 'created',
    rowNumber,
    code,
    productId: newProduct._id,
    name: newProduct.name,
  };
}

async function syncGoogleSheetProducts() {
  const rows =
    await getGoogleSheetRows();

  const result = {
    success: true,
    totalRows: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    products: [],
    errors: [],
  };

  const processedCodes =
    new Set();

  for (const row of rows) {
    const rowNumber =
      row.__sheetRowNumber;

    const code =
      String(row.code || '')
        .trim()
        .toUpperCase();

    /*
     * Ignore completely blank rows.
     */
    const hasProductData =
      Object.entries(row).some(
        ([key, value]) => {
          if (
            key === '__sheetRowNumber' ||
            key === 'id' ||
            key === 'code'
          ) {
            return false;
          }

          return (
            String(value || '').trim() !== ''
          );
        }
      );

    if (!hasProductData) {
      result.skipped++;

      result.products.push({
        action: 'skipped',
        rowNumber,
        reason: 'Blank spreadsheet row.',
      });

      continue;
    }

    if (!code) {
      result.failed++;

      result.errors.push({
        rowNumber,
        error:
          'Product code is required.',
      });

      continue;
    }

    if (processedCodes.has(code)) {
      result.failed++;

      result.errors.push({
        rowNumber,
        code,
        error:
          `Duplicate product code "${code}" found in the same Google Sheet.`,
      });

      continue;
    }

    processedCodes.add(code);

    try {
      const syncResult =
        await syncProductRow(
          row,
          rowNumber
        );

      if (
        syncResult.action ===
        'created'
      ) {
        result.created++;
      } else if (
        syncResult.action ===
        'updated'
      ) {
        result.updated++;
      } else if (
        syncResult.action ===
        'skipped'
      ) {
        result.skipped++;
      }

      result.products.push(
        syncResult
      );
    } catch (error) {
      result.failed++;

      result.errors.push({
        rowNumber,
        code,
        error:
          error.message ||
          'Unable to sync product.',
      });
    }
  }

  result.success =
    result.failed === 0;

  return result;
}

module.exports = {
  getGoogleSheetRows,
  syncGoogleSheetProducts,
};