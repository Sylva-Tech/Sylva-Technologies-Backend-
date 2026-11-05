import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  Headphones,
  LockKeyhole,
  PackageCheck,
  ShieldCheck,
  ShoppingBag,
  Store,
  Upload,
  UserPlus,
  WalletCards,
} from 'lucide-react';

import './SellPage.css';

function SellPage() {
  const benefits = [
    {
      icon: ShoppingBag,
      title: 'Reach More Technology Customers',
      text: 'Showcase your computers, laptops, accessories, networking equipment and other IT products to customers shopping on Sylva Technologies.',
    },
    {
      icon: WalletCards,
      title: 'Grow Your Business',
      text: 'Create an online presence for your technology business and make your products easier for customers to discover.',
    },
    {
      icon: PackageCheck,
      title: 'Focus on Your Products',
      text: 'Once your seller account is approved, you can prepare your product listings with prices, descriptions, images and offers.',
    },
    {
      icon: Store,
      title: 'Build Your Online Store',
      text: 'Present your technology products professionally through your Sylva Technologies seller profile and marketplace listings.',
    },
    {
      icon: FileCheck2,
      title: 'Simple Seller Onboarding',
      text: 'Register your account, provide the required verification information and follow a clear application process.',
    },
    {
      icon: Headphones,
      title: 'Seller Support',
      text: 'Need assistance? Our support team is available to help you understand the seller process and marketplace requirements.',
    },
  ];

  const steps = [
    {
      number: '01',
      icon: UserPlus,
      title: 'Register',
      text: 'Create your seller account and provide your official seller information.',
    },
    {
      number: '02',
      icon: ShieldCheck,
      title: 'Get Verified',
      text: 'Submit the required documents and wait for the administration team to review your application.',
    },
    {
      number: '03',
      icon: Upload,
      title: 'Add Products',
      text: 'After approval, prepare your products with images, prices, descriptions and stock information.',
    },
    {
      number: '04',
      icon: ShoppingBag,
      title: 'Start Selling',
      text: 'Your approved products can then be made available to customers through the marketplace.',
    },
  ];

  const requirements = [
    'Official name or registered business name',
    'Identification document — front',
    'Identification document — back',
    'KRA PIN document',
    'Valid email address',
    'M-Pesa phone number',
    'Secure account password',
    'Agreement to Terms & Conditions',
    'Agreement to Privacy Policy',
  ];

  return (
    <main className="sell-page">

      {/* HERO */}
      <section className="sell-hero">
        <div className="sell-hero-overlay" />

        <div className="sell-container sell-hero-inner">
          <div className="sell-hero-content">
            <span className="sell-hero-badge">
              <Store size={15} />
              SYLVA TECHNOLOGIES SELLER PORTAL
            </span>

            <h1>
              Start Selling Your
              <span>Technology Products Online</span>
            </h1>

            <p>
              Take your technology business online and connect with customers
              looking for computers, laptops, accessories, networking
              equipment, components and other IT products.
            </p>

            <div className="sell-hero-buttons">
              <Link
                to="/seller/register"
                className="sell-primary-cta"
              >
                Become a Seller
                <ArrowRight size={19} />
              </Link>

              <Link
                to="/seller/login"
                className="sell-outline-cta"
              >
                Seller Login
              </Link>
            </div>

            <div className="sell-hero-note">
              <CheckCircle2 size={17} />
              <span>Simple registration • Seller verification • Technology marketplace</span>
            </div>
          </div>

          <div className="sell-hero-panel">
            <div className="sell-panel-icon">
              <Store size={30} />
            </div>

            <span className="sell-panel-label">
              SELL WITH SYLVA
            </span>

            <h2>
              Put your products where technology buyers are looking.
            </h2>

            <p>
              Register your seller account, complete verification and prepare
              your products for the Sylva Technologies marketplace.
            </p>

            <div className="sell-panel-divider" />

            <div className="sell-panel-feature">
              <CheckCircle2 size={19} />
              <div>
                <strong>Professional marketplace</strong>
                <span>Built for technology products.</span>
              </div>
            </div>

            <div className="sell-panel-feature">
              <CheckCircle2 size={19} />
              <div>
                <strong>Verified seller accounts</strong>
                <span>Seller applications are reviewed.</span>
              </div>
            </div>

            <div className="sell-panel-feature">
              <CheckCircle2 size={19} />
              <div>
                <strong>Clear onboarding</strong>
                <span>Know what you need before applying.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* INTRODUCTION */}
      <section className="sell-introduction">
        <div className="sell-container">
          <div className="sell-intro-heading">
            <span>WHY SELL WITH SYLVA?</span>

            <h2>
              Grow your technology business online.
            </h2>

            <p>
              Sylva Technologies is building a marketplace focused on
              computers, electronics and IT products. Our seller portal gives
              businesses and technology suppliers a structured way to bring
              their products online.
            </p>
          </div>

          <div className="sell-benefits-grid">
            {benefits.map((benefit) => {
              const Icon = benefit.icon;

              return (
                <article
                  className="sell-benefit-card"
                  key={benefit.title}
                >
                  <div className="sell-benefit-icon">
                    <Icon size={25} />
                  </div>

                  <h3>{benefit.title}</h3>

                  <p>{benefit.text}</p>

                  <div className="sell-card-line" />
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="sell-process">
        <div className="sell-container">
          <div className="sell-section-heading">
            <span>HOW IT WORKS</span>

            <h2>Start Selling in 4 Simple Steps</h2>

            <p>
              We keep the seller onboarding process straightforward so you
              know what happens at each stage.
            </p>
          </div>

          <div className="sell-process-grid">
            {steps.map((step) => {
              const Icon = step.icon;

              return (
                <article
                  className="sell-process-card"
                  key={step.number}
                >
                  <div className="sell-process-top">
                    <div className="sell-process-icon">
                      <Icon size={23} />
                    </div>

                    <span>{step.number}</span>
                  </div>

                  <h3>{step.title}</h3>

                  <p>{step.text}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* VERIFICATION */}
      <section className="sell-verification">
        <div className="sell-container">
          <div className="sell-verification-box">
            <div className="sell-verification-info">
              <span>SELLER VERIFICATION</span>

              <h2>
                What do you need to become a Sylva seller?
              </h2>

              <p>
                To create a trusted marketplace, seller accounts are reviewed
                before products can be listed. Prepare the following
                information and documents before starting your application.
              </p>

              <div className="sell-verification-message">
                <LockKeyhole size={20} />

                <div>
                  <strong>Secure seller onboarding</strong>

                  <span>
                    Your registration information is collected as part of the
                    seller verification process.
                  </span>
                </div>
              </div>
            </div>

            <div className="sell-requirements-box">
              <h3>Seller requirements</h3>

              <div className="sell-requirements-list">
                {requirements.map((requirement) => (
                  <div
                    className="sell-requirement-item"
                    key={requirement}
                  >
                    <CheckCircle2 size={18} />
                    <span>{requirement}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ASSISTANCE */}
      <section className="sell-assistance">
        <div className="sell-container">
          <div className="sell-assistance-box">
            <div className="sell-assistance-icon">
              <Headphones size={31} />
            </div>

            <div className="sell-assistance-content">
              <span>NEED ASSISTANCE?</span>

              <h2>We're here to help you get started.</h2>

              <p>
                If you have questions about becoming a seller, registration,
                verification or the marketplace, contact the Sylva
                Technologies team.
              </p>
            </div>

            <Link
              to="/contact"
              className="sell-assistance-button"
            >
              Contact Support
              <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="sell-final">
        <div className="sell-container">
          <div className="sell-final-box">
            <div className="sell-final-icon">
              <Store size={34} />
            </div>

            <span className="sell-final-label">
              READY TO START?
            </span>

            <h2>
              Become a Sylva Technologies Seller
            </h2>

            <p>
              Bring your technology products online and take the first step
              towards reaching more customers through the Sylva Technologies
              marketplace.
            </p>

            <Link
              to="/seller/register"
              className="sell-become-button"
            >
              <UserPlus size={21} />
              BECOME A SELLER
              <ArrowRight size={20} />
            </Link>

            <div className="sell-final-login">
              Already registered?
              <Link to="/seller/login">
                Login to Seller Centre
              </Link>
            </div>
          </div>
        </div>
      </section>

    </main>
  );
}

export default SellPage;