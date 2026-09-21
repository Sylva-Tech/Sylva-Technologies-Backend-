const adminOrderNotificationTemplate = ({ order, customer }) => `
  <div style="font-family: Arial, sans-serif; background:#f4f7fb; padding:24px; color:#1a1a1a;">
    <div style="max-width:700px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e5e7eb;">
      <div style="background:linear-gradient(135deg,#111827,#dc2626); padding:24px 32px; color:#fff;">
        <h2 style="margin:0; font-size:26px;">New order received</h2>
      </div>
      <div style="padding:32px;">
        <p><strong>Order number:</strong> ${order.orderNumber}</p>
        <p><strong>Customer:</strong> ${customer.name}</p>
        <p><strong>Email:</strong> ${customer.email}</p>
        <p><strong>Phone:</strong> ${customer.phone || 'N/A'}</p>
        <p><strong>Delivery location:</strong> ${order.customerDetails?.deliveryLocation || order.customerDetails?.address || 'N/A'}</p>
        <p><strong>Total:</strong> KES ${Number(order.total || 0).toLocaleString()}</p>
        <p><strong>Payment method:</strong> ${order.paymentMethod}</p>
        <p><strong>Payment status:</strong> ${order.paymentStatus || 'Pending'}</p>
        <table style="width:100%; border-collapse:collapse; margin-top:20px;">
          <thead>
            <tr>
              <th style="text-align:left; border-bottom:1px solid #e2e8f0; padding:8px;">Item</th>
              <th style="text-align:right; border-bottom:1px solid #e2e8f0; padding:8px;">Qty</th>
              <th style="text-align:right; border-bottom:1px solid #e2e8f0; padding:8px;">Price</th>
            </tr>
          </thead>
          <tbody>
            ${order.items.map((item) => `
              <tr>
                <td style="padding:10px 8px; border-bottom:1px solid #f1f5f9;">${item.name}</td>
                <td style="padding:10px 8px; border-bottom:1px solid #f1f5f9; text-align:right;">${item.quantity}</td>
                <td style="padding:10px 8px; border-bottom:1px solid #f1f5f9; text-align:right;">KES ${Number(item.price).toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div style="background:#f8fafc; color:#475569; padding:18px 32px; font-size:12px; border-top:1px solid #e5e7eb;">
        Sylva Technologies admin notification.
      </div>
    </div>
  </div>
`;

module.exports = { adminOrderNotificationTemplate };
