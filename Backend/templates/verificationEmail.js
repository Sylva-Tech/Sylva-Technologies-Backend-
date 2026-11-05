const verificationEmailTemplate = ({ name, otp, expiresInMinutes }) => `
  <div style="font-family: Arial, sans-serif; background:#f4f7fb; padding:24px; color:#1a1a1a;">
    <div style="max-width:620px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e5e7eb;">
      <div style="background:linear-gradient(135deg,#0f172a,#1d4ed8); padding:24px 32px; color:#fff;">
        <h2 style="margin:0; font-size:26px;">Sylva Technologies</h2>
      </div>
      <div style="padding:32px;">
        <h3 style="margin-top:0; font-size:22px;">Verify your account</h3>
        <p>Hello <strong>${name}</strong>,</p>
        <p>Use the code below to verify your Sylva Technologies account:</p>
        <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:18px; text-align:center; margin:24px 0;">
          <div style="font-size:32px; font-weight:700; letter-spacing:6px; color:#1d4ed8;">${otp}</div>
        </div>
        <p>This verification code expires in <strong>${expiresInMinutes} minutes</strong>.</p>
        <p>If you did not create this account, please ignore this email and secure your account.</p>
        <p style="margin-top:24px;">Need help? Contact us at support@sylvatechnologies.com or call +254 700 000 000.</p>
      </div>
      <div style="background:#f8fafc; color:#475569; padding:18px 32px; font-size:12px; border-top:1px solid #e5e7eb;">
        © 2026 Sylva Technologies. All rights reserved.
      </div>
    </div>
  </div>
`;

module.exports = { verificationEmailTemplate };
