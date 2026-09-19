require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const run = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is required before running the admin seed script.');
    }

    await mongoose.connect(process.env.MONGODB_URI);

    const email = process.env.ADMIN_EMAIL || 'admin@sylvatechnologies.co.ke';
    const password = process.env.ADMIN_PASSWORD;

    if (!password) {
      throw new Error('ADMIN_PASSWORD is required. Set it in your .env file before running this script.');
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      console.log('Admin user already exists:', existing.email);
      process.exit(0);
    }

    const user = await User.create({
      name: 'Sylva Admin',
      email,
      phone: '0700000000',
      password,
      role: 'admin',
    });

    console.log('Admin user created successfully');
    console.log('Email:', user.email);
    console.log('Password:', password);
    process.exit(0);
  } catch (error) {
    console.error('Failed to create admin user:', error.message);
    process.exit(1);
  }
};

run();
