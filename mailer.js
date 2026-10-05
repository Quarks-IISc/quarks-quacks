const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendOtp(email, otp, teamName) {
  if (!process.env.SMTP_USER) {
    console.log(`[MAIL DISABLED] OTP for ${teamName} (${email}): ${otp}`);
    return;
  }

  await transporter.sendMail({
    from: `"Quarks Quacks" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `Your Quarks Quacks OTP — ${teamName}`,
    html: `
      <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:2rem;background:#151515;color:#e0ddd8;border-radius:8px">
        <h2 style="color:#d4a843;margin:0 0 0.5rem">Quarks Quacks</h2>
        <p>Hey <strong>${teamName}</strong>! Here's your verification code:</p>
        <div style="font-size:2.5rem;font-weight:700;letter-spacing:0.3em;text-align:center;padding:1rem;color:#d4a843">${otp}</div>
        <p style="font-size:0.85rem;color:#8a8780">This code expires in 15 minutes. Enter it on the verification page to activate your team.</p>
        <p style="font-size:0.8rem;color:#8a8780;margin-top:1rem">— Quarks, IISc Bangalore</p>
      </div>
    `
  });
}

module.exports = { sendOtp };
