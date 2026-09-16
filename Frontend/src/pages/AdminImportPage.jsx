import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

const required = ['name', 'sku', 'price', 'category', 'stock'];
const parseCsv = (text) => {
  const rows = text.trim().split(/\r?\n/).map((line) => line.split(',').map((cell) => cell.trim()));
  if (rows.length < 2) return [];
  return rows.slice(1).map((row) => Object.fromEntries(rows[0].map((key, index) => [key, row[index] || ''])));
};

function AdminImportPage() {
  const [rows, setRows] = useState([]);
  const [errors, setErrors] = useState([]);
  const [message, setMessage] = useState('');
  const [importing, setImporting] = useState(false);

  const preview = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(reader.result);
      const validationErrors = [];
      parsed.forEach((row, index) => {
        required.forEach((field) => { if (!row[field]) validationErrors.push(`Row ${index + 2}: missing ${field}`); });
        if (row.price && Number.isNaN(Number(row.price))) validationErrors.push(`Row ${index + 2}: invalid price`);
        if (row.stock && Number.isNaN(Number(row.stock))) validationErrors.push(`Row ${index + 2}: invalid stock`);
        if (row.image1 && !/^https?:\/\//.test(row.image1)) validationErrors.push(`Row ${index + 2}: invalid image URL`);
      });
      setRows(parsed);
      setErrors(validationErrors);
      setMessage('');
    };
    reader.readAsText(file);
  };

  const importValid = async () => {
    setImporting(true);
    setMessage('');
    const invalidRows = new Set(errors.map((error) => Number(error.match(/Row (\d+)/)?.[1])));
    const token = localStorage.getItem('sylva-token');
    let imported = 0;
    for (let index = 0; index < rows.length; index += 1) {
      if (invalidRows.has(index + 2)) continue;
      const row = rows[index];
      try {
        await api.post('/products', { ...row, price: Number(row.price), oldPrice: Number(row.oldPrice || 0), stock: Number(row.stock), images: [row.image1, row.image2, row.image3, row.image4].filter(Boolean), featured: row.featured === 'true', isNew: row.newArrival === 'true', flashSale: row.flashSale === 'true', offerMessage: row.offerMessage || '' }, { headers: { Authorization: `Bearer ${token}` } });
        imported += 1;
      } catch (error) {
        setErrors((current) => [...current, `Row ${index + 2}: ${error.response?.data?.message || 'could not be imported'}`]);
      }
    }
    setMessage(`${imported} valid product${imported === 1 ? '' : 's'} imported.`);
    setImporting(false);
  };

  return <section className="container section-block admin-page"><div className="admin-page-head"><div><p className="eyebrow">Catalog control</p><h1>Import products</h1></div><Link to="/admin/products" className="secondary-btn">Back to products</Link></div><div className="import-card"><p>Upload a CSV exported from Google Sheets. Credentials stay out of the browser; review rows before importing.</p><input type="file" accept=".csv,text/csv" onChange={preview} />{rows.length > 0 && <><h2>Preview ({rows.length} rows)</h2><div className="import-preview">{rows.slice(0, 10).map((row, index) => <div key={`${row.sku}-${index}`}><strong>{row.name || 'Unnamed product'}</strong><span>{row.brand || '-'} · KSh {row.price || '-'} · {row.stock || 0} in stock</span></div>)}</div></>}{errors.length > 0 && <div className="import-errors"><strong>Review these rows</strong>{errors.map((error) => <span key={error}>{error}</span>)}</div>}{message && <p className="in-stock">{message}</p>}<button className="primary-btn" type="button" disabled={!rows.length || importing} onClick={importValid}>{importing ? 'Importing products...' : 'Import valid products'}</button></div></section>;
}

export default AdminImportPage;
