import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

const REQUIRED_COLUMNS = [
  'name',
  'sku',
  'brand',
  'price',
  'category',
  'stock',
  'description',
];

const VALID_CONDITIONS = ['New', 'Refurbished', 'Used'];

/*
|--------------------------------------------------------------------------
| NORMALIZE HEADER
|--------------------------------------------------------------------------
*/
const normalizeHeader = (value) =>
  String(value ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

/*
|--------------------------------------------------------------------------
| CSV PARSER
|--------------------------------------------------------------------------
*/
const parseCSV = (text) => {
  const rows = [];
  let row = [];
  let cell = '';
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        cell += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (character === ',' && !insideQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if (
      (character === '\n' || character === '\r') &&
      !insideQuotes
    ) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1;
      }

      row.push(cell);
      cell = '';

      if (
        row.some(
          (value) => String(value ?? '').trim() !== ''
        )
      ) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    cell += character;
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
  }

  if (
    row.some(
      (value) => String(value ?? '').trim() !== ''
    )
  ) {
    rows.push(row);
  }

  if (rows.length < 2) {
    return {
      headers: [],
      rows: [],
    };
  }

  const headers = rows[0].map(normalizeHeader);

  const dataRows = rows.slice(1).map((values) => {
    const object = {};

    headers.forEach((header, index) => {
      object[header] = String(
        values[index] ?? ''
      ).trim();
    });

    return object;
  });

  return {
    headers,
    rows: dataRows,
  };
};

/*
|--------------------------------------------------------------------------
| NUMBER HELPERS
|--------------------------------------------------------------------------
*/
const cleanNumericString = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '';
  }

  return String(value)
    .replace(/ksh/gi, '')
    .replace(/kes/gi, '')
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .trim();
};

const parseNumber = (value, fallback = 0) => {
  const cleaned = cleanNumericString(value);

  if (cleaned === '') {
    return fallback;
  }

  const number = Number(cleaned);

  return Number.isFinite(number)
    ? number
    : fallback;
};

/*
|--------------------------------------------------------------------------
| BOOLEAN HELPER
|--------------------------------------------------------------------------
*/
const parseBoolean = (
  value,
  defaultValue = false
) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();

  if (
    ['true', '1', 'yes', 'y'].includes(
      normalized
    )
  ) {
    return true;
  }

  if (
    ['false', '0', 'no', 'n', ''].includes(
      normalized
    )
  ) {
    return false;
  }

  return defaultValue;
};

/*
|--------------------------------------------------------------------------
| SAFE DATE
|--------------------------------------------------------------------------
|
| Only valid dates are sent to the backend.
| TRUE/FALSE, blank cells and invalid values are
| never sent as dates.
|
|--------------------------------------------------------------------------
*/
const parseOptionalDate = (value) => {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    return undefined;
  }

  if (
    ['true', 'false', 'yes', 'no'].includes(
      normalized.toLowerCase()
    )
  ) {
    return undefined;
  }

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
};

/*
|--------------------------------------------------------------------------
| IMAGE URL
|--------------------------------------------------------------------------
*/
const cleanImageUrl = (value) => {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    return '';
  }

  if (
    !/^https?:\/\/.+/i.test(normalized)
  ) {
    return '';
  }

  return normalized;
};

const isValidImageUrl = (value) => {
  if (!value) {
    return true;
  }

  return /^https?:\/\/.+/i.test(
    String(value).trim()
  );
};

/*
|--------------------------------------------------------------------------
| DISCOUNT
|--------------------------------------------------------------------------
*/
const calculateDiscount = (
  oldPrice,
  price
) => {
  const oldValue = Number(oldPrice);
  const currentValue = Number(price);

  if (
    !Number.isFinite(oldValue) ||
    !Number.isFinite(currentValue) ||
    oldValue <= 0 ||
    currentValue < 0 ||
    currentValue >= oldValue
  ) {
    return 0;
  }

  return Math.round(
    ((oldValue - currentValue) /
      oldValue) *
      100
  );
};

/*
|--------------------------------------------------------------------------
| CREATE OLD PRICE FROM DISCOUNT
|--------------------------------------------------------------------------
*/
const calculateOldPriceFromDiscount = (
  price,
  discount
) => {
  const numericPrice = Number(price);
  const numericDiscount = Number(discount);

  if (
    !Number.isFinite(numericPrice) ||
    !Number.isFinite(numericDiscount) ||
    numericPrice <= 0 ||
    numericDiscount <= 0 ||
    numericDiscount >= 100
  ) {
    return 0;
  }

  return Math.round(
    numericPrice /
      (1 - numericDiscount / 100)
  );
};

/*
|--------------------------------------------------------------------------
| KEY FEATURES
|--------------------------------------------------------------------------
*/
const parseKeyFeatures = (value) => {
  if (!value) {
    return [];
  }

  return String(value)
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
};

/*
|--------------------------------------------------------------------------
| SPECIFICATIONS
|--------------------------------------------------------------------------
*/
const parseSpecifications = (value) => {
  if (!value) {
    return '';
  }

  const trimmed = String(value).trim();

  if (!trimmed) {
    return '';
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
};

/*
|--------------------------------------------------------------------------
| ADMIN IMPORT PAGE
|--------------------------------------------------------------------------
*/
function AdminImportPage() {
  const [rows, setRows] = useState([]);
  const [errors, setErrors] = useState([]);
  const [message, setMessage] = useState('');
  const [importing, setImporting] =
    useState(false);

  /*
  |--------------------------------------------------------------------------
  | CSV PREVIEW
  |--------------------------------------------------------------------------
  */
  const preview = (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setRows([]);
    setErrors([]);
    setMessage('');

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const result = parseCSV(
          String(reader.result || '')
        );

        const parsedRows = result.rows;
        const headers = result.headers;
        const validationErrors = [];

        /*
        |--------------------------------------------------------------------------
        | REQUIRED HEADERS
        |--------------------------------------------------------------------------
        */
        const missingColumns =
          REQUIRED_COLUMNS.filter(
            (column) =>
              !headers.includes(column)
          );

        if (missingColumns.length > 0) {
          validationErrors.push(
            `Missing required column${
              missingColumns.length === 1
                ? ''
                : 's'
            }: ${missingColumns.join(', ')}`
          );
        }

        /*
        |--------------------------------------------------------------------------
        | EMPTY CSV
        |--------------------------------------------------------------------------
        */
        if (parsedRows.length === 0) {
          validationErrors.push(
            'The CSV file does not contain any product rows.'
          );
        }

        /*
        |--------------------------------------------------------------------------
        | ROW VALIDATION
        |--------------------------------------------------------------------------
        */
        parsedRows.forEach(
          (row, index) => {
            const rowNumber = index + 2;

            /*
            |--------------------------------------------------------------------------
            | REQUIRED FIELDS
            |--------------------------------------------------------------------------
            */
            REQUIRED_COLUMNS.forEach(
              (field) => {
                if (
                  !String(
                    row[field] ?? ''
                  ).trim()
                ) {
                  validationErrors.push(
                    `Row ${rowNumber}: missing ${field}`
                  );
                }
              }
            );

            /*
            |--------------------------------------------------------------------------
            | PRICE
            |--------------------------------------------------------------------------
            */
            if (row.price !== '') {
              const price =
                parseNumber(row.price);

              if (
                !Number.isFinite(price) ||
                price < 0
              ) {
                validationErrors.push(
                  `Row ${rowNumber}: invalid price`
                );
              }
            }

            /*
            |--------------------------------------------------------------------------
            | OLD PRICE
            |--------------------------------------------------------------------------
            */
            if (row.oldprice !== '') {
              const oldPrice =
                parseNumber(
                  row.oldprice
                );

              if (
                !Number.isFinite(
                  oldPrice
                ) ||
                oldPrice < 0
              ) {
                validationErrors.push(
                  `Row ${rowNumber}: invalid oldPrice`
                );
              }
            }

            /*
            |--------------------------------------------------------------------------
            | DISCOUNT
            |--------------------------------------------------------------------------
            */
            if (
              row.discount !== undefined &&
              row.discount !== ''
            ) {
              const discount =
                parseNumber(
                  row.discount
                );

              if (
                !Number.isFinite(
                  discount
                ) ||
                discount < 0 ||
                discount >= 100
              ) {
                validationErrors.push(
                  `Row ${rowNumber}: discount must be between 0 and 99`
                );
              }
            }

            /*
            |--------------------------------------------------------------------------
            | STOCK
            |--------------------------------------------------------------------------
            */
            if (row.stock !== '') {
              const stock =
                parseNumber(
                  row.stock
                );

              if (
                !Number.isFinite(
                  stock
                ) ||
                stock < 0
              ) {
                validationErrors.push(
                  `Row ${rowNumber}: invalid stock`
                );
              }
            }

            /*
            |--------------------------------------------------------------------------
            | CONDITION
            |--------------------------------------------------------------------------
            */
            if (row.condition) {
              const condition =
                String(
                  row.condition
                ).trim();

              if (
                !VALID_CONDITIONS.includes(
                  condition
                )
              ) {
                validationErrors.push(
                  `Row ${rowNumber}: condition must be New, Refurbished, or Used`
                );
              }
            }

            /*
            |--------------------------------------------------------------------------
            | IMAGES
            |--------------------------------------------------------------------------
            |
            | Blank image fields are completely ignored.
            |
            |--------------------------------------------------------------------------
            */
            [
              'image1',
              'image2',
              'image3',
              'image4',
            ].forEach(
              (imageField) => {
                const image =
                  String(
                    row[imageField] ??
                      ''
                  ).trim();

                if (
                  image &&
                  !isValidImageUrl(
                    image
                  )
                ) {
                  validationErrors.push(
                    `Row ${rowNumber}: invalid ${imageField} URL`
                  );
                }
              }
            );

            /*
            |--------------------------------------------------------------------------
            | PRICE / DISCOUNT RELATIONSHIP
            |--------------------------------------------------------------------------
            */
            const price =
              parseNumber(row.price);

            const oldPrice =
              parseNumber(
                row.oldprice
              );

            const discount =
              parseNumber(
                row.discount
              );

            if (
              oldPrice > 0 &&
              price > 0 &&
              oldPrice < price
            ) {
              validationErrors.push(
                `Row ${rowNumber}: oldPrice cannot be lower than price`
              );
            }

            if (
              discount > 0 &&
              !oldPrice &&
              price > 0
            ) {
              const calculatedOldPrice =
                calculateOldPriceFromDiscount(
                  price,
                  discount
                );

              if (
                !calculatedOldPrice
              ) {
                validationErrors.push(
                  `Row ${rowNumber}: could not calculate oldPrice from discount`
                );
              }
            }

            /*
            |--------------------------------------------------------------------------
            | OPTIONAL DATE VALIDATION
            |--------------------------------------------------------------------------
            */
            [
              'offerstartdate',
              'offerenddate',
            ].forEach(
              (dateField) => {
                const value =
                  String(
                    row[dateField] ??
                      ''
                  ).trim();

                if (!value) {
                  return;
                }

                /*
                | TRUE/FALSE must NEVER be treated
                | as an offer date.
                */
                if (
                  [
                    'true',
                    'false',
                  ].includes(
                    value.toLowerCase()
                  )
                ) {
                  return;
                }

                const date =
                  new Date(value);

                if (
                  Number.isNaN(
                    date.getTime()
                  )
                ) {
                  validationErrors.push(
                    `Row ${rowNumber}: invalid ${dateField}`
                  );
                }
              }
            );
          }
        );

        setRows(parsedRows);
        setErrors(validationErrors);

        if (
          validationErrors.length ===
            0 &&
          parsedRows.length > 0
        ) {
          setMessage(
            `${parsedRows.length} product${
              parsedRows.length === 1
                ? ''
                : 's'
            } ready for import.`
          );
        }
      } catch (error) {
        console.error(
          'CSV parsing error:',
          error
        );

        setRows([]);

        setErrors([
          'Could not read this CSV file. Please check that it is a valid CSV exported from Google Sheets.',
        ]);
      }
    };

    reader.onerror = () => {
      setRows([]);

      setErrors([
        'Could not read the selected CSV file.',
      ]);
    };

    reader.readAsText(file);
  };

  /*
  |--------------------------------------------------------------------------
  | IMPORT PRODUCTS
  |--------------------------------------------------------------------------
  */
  const importValid = async () => {
    if (!rows.length) {
      return;
    }

    setImporting(true);
    setMessage('');

    const invalidRows = new Set();

    errors.forEach((error) => {
      const match =
        error.match(/Row (\d+)/);

      if (match) {
        invalidRows.add(
          Number(match[1])
        );
      }
    });

    const token =
      localStorage.getItem(
        'sylva-token'
      );

    if (!token) {
      setErrors((current) => [
        ...current,
        'You are not logged in as an administrator.',
      ]);

      setImporting(false);
      return;
    }

    let imported = 0;

    for (
      let index = 0;
      index < rows.length;
      index += 1
    ) {
      const rowNumber = index + 2;

      if (
        invalidRows.has(rowNumber)
      ) {
        continue;
      }

      const row = rows[index];

      try {
        /*
        |--------------------------------------------------------------------------
        | BASIC VALUES
        |--------------------------------------------------------------------------
        */
        const price =
          parseNumber(row.price);

        let oldPrice =
          parseNumber(
            row.oldprice
          );

        const stock =
          parseNumber(row.stock);

        /*
        |--------------------------------------------------------------------------
        | DISCOUNT
        |--------------------------------------------------------------------------
        */
        const requestedDiscount =
          parseNumber(
            row.discount
          );

        if (
          !oldPrice &&
          requestedDiscount > 0
        ) {
          oldPrice =
            calculateOldPriceFromDiscount(
              price,
              requestedDiscount
            );
        }

        /*
        |--------------------------------------------------------------------------
        | IMAGES
        |--------------------------------------------------------------------------
        */
        const images = [
          row.image1,
          row.image2,
          row.image3,
          row.image4,
        ]
          .map(cleanImageUrl)
          .filter(Boolean)
          .slice(0, 4);

        /*
        |--------------------------------------------------------------------------
        | DISCOUNT
        |--------------------------------------------------------------------------
        */
        const calculatedDiscount =
          calculateDiscount(
            oldPrice,
            price
          );

        /*
        |--------------------------------------------------------------------------
        | IS NEW
        |--------------------------------------------------------------------------
        |
        | Supports BOTH:
        |
        | newArrival
        | isNew
        |
        |--------------------------------------------------------------------------
        */
        const isNewValue =
          row.isnew !== undefined &&
          row.isnew !== ''
            ? row.isnew
            : row.newarrival;

        /*
        |--------------------------------------------------------------------------
        | SAFE OFFER DATES
        |--------------------------------------------------------------------------
        */
        const offerStartDate =
          parseOptionalDate(
            row.offerstartdate
          );

        const offerEndDate =
          parseOptionalDate(
            row.offerenddate
          );

        /*
        |--------------------------------------------------------------------------
        | PRODUCT PAYLOAD
        |--------------------------------------------------------------------------
        */
        const productPayload = {
          name: row.name.trim(),

          brand: row.brand.trim(),

          category:
            row.category.trim(),

          sku: row.sku.trim(),

          subcategory:
            row.subcategory?.trim() ||
            '',

          price,

          oldPrice,

          stock,

          description:
            row.description?.trim() ||
            row.shortdescription?.trim() ||
            '',

          shortDescription:
            row.shortdescription?.trim() ||
            '',

          condition:
            row.condition?.trim() ||
            'New',

          warranty:
            row.warranty?.trim() ||
            '',

          warrantyDuration:
            row.warrantyduration?.trim() ||
            '',

          warrantyTerms:
            row.warrantyterms?.trim() ||
            '',

          deliveryDuration:
            row.deliveryduration?.trim() ||
            '',

          deliveryFee:
            parseNumber(
              row.deliveryfee,
              0
            ),

          deliveryTerms:
            row.deliveryterms?.trim() ||
            '',

          deliveryLocations:
            row.deliverylocations?.trim() ||
            '',

          returnPeriod:
            row.returnperiod?.trim() ||
            '',

          returnPolicy:
            row.returnpolicy?.trim() ||
            '',

          returnConditions:
            row.returnconditions?.trim() ||
            '',

          whatsIncluded:
            row.whatsincluded?.trim() ||
            '',

          keyFeatures:
            parseKeyFeatures(
              row.keyfeatures
            ),

          sellerNotes:
            row.sellernotes?.trim() ||
            '',

          specifications:
            parseSpecifications(
              row.specifications
            ),

          /*
          | Only real image URLs are sent.
          */
          images,

          /*
          |--------------------------------------------------------------------------
          | MERCHANDISING
          |--------------------------------------------------------------------------
          */
          featured:
            parseBoolean(
              row.featured,
              false
            ),

          isNew:
            parseBoolean(
              isNewValue,
              false
            ),

          flashSale:
            parseBoolean(
              row.flashsale,
              false
            ),

          offer:
            parseBoolean(
              row.offer,
              false
            ),

          offerMessage:
            row.offermessage?.trim() ||
            '',

          /*
          | Only include dates when they
          | are valid.
          */
          ...(offerStartDate
            ? {
                offerStartDate,
              }
            : {}),

          ...(offerEndDate
            ? {
                offerEndDate,
              }
            : {}),

          /*
          |--------------------------------------------------------------------------
          | VISIBILITY
          |--------------------------------------------------------------------------
          */
          isActive:
            row.isactive === ''
              ? true
              : parseBoolean(
                  row.isactive,
                  true
                ),

          /*
          |--------------------------------------------------------------------------
          | SELLER
          |--------------------------------------------------------------------------
          |
          | Blank = Sylva Fulfilled.
          |--------------------------------------------------------------------------
          */
          ...(row.seller?.trim()
            ? {
                seller:
                  row.seller.trim(),
              }
            : {}),
        };

        await api.post(
          '/products',
          productPayload,
          {
            headers: {
              Authorization:
                `Bearer ${token}`,
            },
          }
        );

        imported += 1;

        console.log(
          `Imported row ${rowNumber}: ${row.name} (${calculatedDiscount}% discount)`
        );
      } catch (error) {
        console.error(
          `Product import failed for row ${rowNumber}:`,
          error
        );

        const backendMessage =
          error.response?.data?.message ||
          error.response?.data?.error ||
          'could not be imported';

        setErrors((current) => [
          ...current,
          `Row ${rowNumber}: ${backendMessage}`,
        ]);
      }
    }

    if (imported > 0) {
      setMessage(
        `${imported} product${
          imported === 1
            ? ''
            : 's'
        } imported successfully.`
      );
    } else {
      setMessage(
        'No products were imported. Review the errors above.'
      );
    }

    setImporting(false);
  };

  /*
  |--------------------------------------------------------------------------
  | PREVIEW DISCOUNT
  |--------------------------------------------------------------------------
  */
  const getPreviewDiscount = (
    row
  ) => {
    const price =
      parseNumber(row.price);

    let oldPrice =
      parseNumber(
        row.oldprice
      );

    const discount =
      parseNumber(
        row.discount
      );

    if (
      !oldPrice &&
      discount > 0
    ) {
      oldPrice =
        calculateOldPriceFromDiscount(
          price,
          discount
        );
    }

    return calculateDiscount(
      oldPrice,
      price
    );
  };

  /*
  |--------------------------------------------------------------------------
  | UI
  |--------------------------------------------------------------------------
  */
  return (
    <section className="container section-block admin-page">
      <div className="admin-page-head">
        <div>
          <p className="eyebrow">
            Catalog control
          </p>

          <h1>
            Import products
          </h1>
        </div>

        <Link
          to="/admin/products"
          className="secondary-btn"
        >
          Back to products
        </Link>
      </div>

      <div className="import-card">
        <p>
          Upload a CSV exported from
          Google Sheets. Review the
          products before importing them.
          Leave the seller column empty
          for <strong>Sylva Fulfilled</strong>{' '}
          products.
        </p>

        <input
          type="file"
          accept=".csv,text/csv"
          onChange={preview}
        />

        {rows.length > 0 && (
          <>
            <h2>
              Preview ({rows.length} rows)
            </h2>

            <div className="import-preview">
              {rows
                .slice(0, 20)
                .map((row, index) => {
                  const discount =
                    getPreviewDiscount(
                      row
                    );

                  return (
                    <div
                      key={`${row.sku}-${index}`}
                    >
                      <strong>
                        {row.name ||
                          'Unnamed product'}
                      </strong>

                      <span>
                        {row.brand || '-'}
                        {' · '}
                        KSh{' '}
                        {row.price || '-'}
                        {' · '}
                        {row.stock || 0}
                        {' in stock'}

                        {discount > 0 && (
                          <>
                            {' · '}
                            {discount}% off
                          </>
                        )}
                      </span>

                      {row.image1 && (
                        <span>
                          Image 1 ✓
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>

            {rows.length > 20 && (
              <p>
                Showing the first 20 of{' '}
                {rows.length} products.
              </p>
            )}
          </>
        )}

        {errors.length > 0 && (
          <div className="import-errors">
            <strong>
              Review these issues
            </strong>

            {errors.map(
              (error, index) => (
                <span
                  key={`${error}-${index}`}
                >
                  {error}
                </span>
              )
            )}
          </div>
        )}

        {message && (
          <p className="in-stock">
            {message}
          </p>
        )}

        <button
          className="primary-btn"
          type="button"
          disabled={
            !rows.length ||
            importing ||
            errors.length > 0
          }
          onClick={importValid}
        >
          {importing
            ? 'Importing products...'
            : 'Import valid products'}
        </button>
      </div>
    </section>
  );
}

export default AdminImportPage;