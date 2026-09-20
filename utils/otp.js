const crypto = require('crypto');

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const hashOtp = (otp) => crypto.createHash('sha256').update(String(otp)).digest('hex');

const compareOtp = ({ providedOtp, storedHash }) => hashOtp(providedOtp) === storedHash;

module.exports = { generateOtp, hashOtp, compareOtp };
