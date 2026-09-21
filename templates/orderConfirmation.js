const orderConfirmationTemplate = ({ customerName, order, orderDate }) => `
  <div style="font-family: Arial, sans-serif; background:#f4f7fb; padding:24px; color:#1a1a1a;">
    <div style="max-width:700px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e5e7eb;">
      <div style="background:linear-gradient(135deg,#0f172a,#0ea5e9); padding:24px 32px; color:#fff;">
        <h2 style="margin:0; font-size:26px;">Sylva Technologies</h2>
      </div>
      <div style="padding:32px;">
        <h3 style="margin-top:0; font-size:22px;">Order confirmed</h3>
        <p>Hello <strong>${customerName}</strong>,</p>
        <p>Thank you for shopping with Sylva Technologies. Your order has been placed successfully.</p>
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:18px; margin:22px 0;">
          <p><strong>Order number:</strong> ${order.orderNumber}</p>
          <p><strong>Order date:</strong> ${orderDate}</p>
          <p><strong>Payment method:</strong> ${order.paymentMethod}</p>
          <p><strong>Payment status:</strong> ${order.paymentStatus || 'Pending'}</p>
          <p><strong>Status:</strong> ${order.status}</p>
        </div>
        <table style="width:100%; border-collapse:collapse; margin:20px 0;">
          <thead>
            <tr>
              <th style="text-align:left; border-bottom:1px solid #e2e8f0; padding:8px;">Item</th>
              <th style="text-align:right; border-bottom:1px solid #e2e8f0; padding:8px;">Qty</th>
              <th style="text-align:right; border-bottom:1px solid #e2e8f0; padding:8px;">Price</th>
              <th style="text-align:right; border-bottom:1px solid #e2e8f0; padding:8px;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${order.items.map((item) => `
              <tr>
                <td style="padding:10px 8px; border-bottom:1px solid #f1f5f9;">${item.name}</td>
                <td style="padding:10px 8px; border-bottom:1px solid #f1f5f9; text-align:right;">${item.quantity}</td>
                <td style="padding:10px 8px; border-bottom:1px solid #f1f5f9; text-align:right;">KES ${Number(item.price).toLocaleString()}</td>
                <td style="padding:10px 8px; border-bottom:1px solid #f1f5f9; text-align:right;">KES ${Number(item.subtotal).toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div style="text-align:right; line-height:1.8;">
          <p><strong>Subtotal:</strong> KES ${Number(order.subtotal || 0).toLocaleString()}</p>
          <p><strong>Delivery fee:</strong> KES ${Number(order.deliveryFee || 0).toLocaleString()}</p>
          <p><strong>Total:</strong> KES ${Number(order.total || 0).toLocaleString()}</p>
        </div>
        <p>Delivery information: ${order.customerDetails?.deliveryLocation || order.customerDetails?.address || 'N/A'}</p>
        <p>Need help? Contact support@sylvatechnologies.com or call +254 700 000 000.</p>
      </div>
      <div style="background:#f8fafc; color:#475569; padding:18px 32px; font-size:12px; border-top:1px solid #e5e7eb;">
        © 2026 Sylva Technologies. All rights reserved.
      </div>
    </div>
  </div>
`;

module.exports = { orderConfirmationTemplate };
