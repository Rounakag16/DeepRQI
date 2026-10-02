import React, { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "../styles/global.css";

export default function LandingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      navigate(user.role === "ADMIN" ? "/dashboard" : "/upload");
    }
  }, [user, navigate]);

  return (
    <div className="landing-container">
      <div className="landing-hero">
        <div className="hero-content">
          <h1 className="hero-title">
            Next-Gen Road Quality <br />
            <span className="gradient-text">Intelligence</span>
          </h1>
          <p className="hero-subtitle">
            Leverage AI to detect, analyze, and prioritize road defects with pinpoint accuracy. 
            Streamline your road maintenance operations today.
          </p>
          <div className="hero-actions">
            <Link to="/login" className="btn-glow">
              Get Started
            </Link>
            <a href="#features" className="btn-outline">
              Learn More
            </a>
          </div>
        </div>

        <div className="hero-visual">
          <div className="glass-card">
            <div className="mock-ui">
              <div className="mock-header">
                <span className="dot red"></span>
                <span className="dot yellow"></span>
                <span className="dot green"></span>
              </div>
              <div className="mock-body">
                <div className="mock-item pulse"></div>
                <div className="mock-item"></div>
                <div className="mock-item"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section id="features" className="features-section">
        <h2 className="section-title">Powerful Features</h2>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">🔍</div>
            <h3>Automated Detection</h3>
            <p>Our deep learning models identify potholes, cracks, and road degradation instantly.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">📊</div>
            <h3>Smart Prioritization</h3>
            <p>Automatically rank road repairs based on severity and traffic volume.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🌍</div>
            <h3>Geospatial Mapping</h3>
            <p>Visualize infrastructure health across your entire city in an interactive map.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
