const orderStatusUpdateTemplate = ({ customerName, orderNumber, status }) => `
  <div style="font-family: Arial, sans-serif; background:#f4f7fb; padding:24px; color:#1a1a1a;">
    <div style="max-width:620px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e5e7eb;">
      <div style="background:linear-gradient(135deg,#14532d,#15803d); padding:24px 32px; color:#fff;">
        <h2 style="margin:0; font-size:26px;">Sylva Technologies</h2>
      </div>
      <div style="padding:32px;">
        <h3 style="margin-top:0; font-size:22px;">Order status updated</h3>
        <p>Hello <strong>${customerName}</strong>,</p>
        <p>Your order <strong>${orderNumber}</strong> is now marked as:</p>
        <div style="background:#ecfdf5; border:1px solid #a7f3d0; border-radius:10px; padding:18px; text-align:center; margin:24px 0;">
          <div style="font-size:24px; font-weight:700; color:#166534;">${status}</div>
        </div>
        <p>Thank you for choosing Sylva Technologies.</p>
      </div>
      <div style="background:#f8fafc; color:#475569; padding:18px 32px; font-size:12px; border-top:1px solid #e5e7eb;">
        © 2026 Sylva Technologies. All rights reserved.
      </div>
    </div>
  </div>
`;

module.exports = { orderStatusUpdateTemplate };
