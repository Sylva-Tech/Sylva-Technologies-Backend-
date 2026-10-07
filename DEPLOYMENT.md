# Sylva Technologies deployment

The application is organized for two deployable repositories:

- `sylva-technologies-frontend`: the `Frontend` directory, deployed to Vercel, Netlify, or another static Vite host.
- `sylva-technologies-backend`: the `Backend` directory, deployed to Render, Railway, or another Node.js host.

## Frontend

1. Copy `Frontend/.env.example` to `Frontend/.env.local`.
2. Set `VITE_API_BASE_URL` to the deployed backend API URL, including `/api`.
3. Set `VITE_PAYPAL_CLIENT_ID` and `VITE_WHATSAPP_NUMBER`.
4. Run `npm install`, `npm run build`, and deploy the generated `dist` directory through the selected Vite host.
5. Configure SPA fallback/rewrite rules so browser routes such as `/product/...` serve `index.html`.

## Backend

1. Deploy the contents of `Backend` as a Node.js service.
2. Set the variables in `Backend/.env.example` in the hosting provider dashboard.
3. Set `CLIENT_URL` to a comma-separated list of allowed frontend origins, for example:

  `https://sylva-technologies-frontend.vercel.app,https://www.example.com`

  Do not add a trailing slash to the origin. The backend also normalizes one if it is present.

4. Set `MONGO_URI`, `JWT_SECRET`, and the email/cloud storage credentials before accepting traffic.
5. Use `npm start` as the production command. The service listens on `PORT` supplied by the host.
6. Verify `GET /api/health` after deployment.

## Repository separation

Create two repositories without copying environment files or build output:

```text
sylva-technologies-frontend/
  src/
  public/
  package.json
  .env.example

sylva-technologies-backend/
  config/
  controllers/
  routes/
  models/
  package.json
  .env.example
```

Keep `.env`, `.env.local`, `node_modules`, and `dist` ignored. The frontend only receives public `VITE_*` values; private database, JWT, email, and cloud credentials stay on the backend.

## API and CORS

The frontend reads `VITE_API_BASE_URL` and falls back to the local API for development. The backend accepts requests from local Vite ports and the comma-separated `CLIENT_URL` origins with credentials enabled.

## PayPal

The checkout already exposes PayPal as a payment method and accepts a transaction reference. Set `VITE_PAYPAL_CLIENT_ID` when wiring the PayPal JavaScript SDK or hosted buttons. Payment verification must remain server-side before marking an order paid.
