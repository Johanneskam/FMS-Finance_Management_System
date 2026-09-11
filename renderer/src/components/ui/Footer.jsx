import React from 'react';
import {
  Facebook, Twitter, Instagram, Linkedin,
  MapPin, Phone, Mail, Clock
} from 'lucide-react';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-grid">
        {/* -------- Brand + Social -------- */}
        <div>
          <div className="footer-logo">
            <img src="../assets/logo.png" alt="Wendy Private School" />
            <div className="footer-logo-text">Wendy Private School</div>
          </div>
          <p className="mb-4">Providing quality education since 1985.</p>
          <div className="flex space-x-4">
            <a href="#" className="text-white hover:text-yellow-300 transition-colors">
              <Facebook size={18} />
            </a>
            <a href="#" className="text-white hover:text-yellow-300 transition-colors">
              <Twitter size={18} />
            </a>
            <a href="#" className="text-white hover:text-yellow-300 transition-colors">
              <Instagram size={18} />
            </a>
            <a href="#" className="text-white hover:text-yellow-300 transition-colors">
              <Linkedin size={18} />
            </a>
          </div>
        </div>

        {/* -------- Payment Links -------- */}
        <div className="footer-links">
          <h4>Payment Links</h4>
          <ul>
            <li><a href="#">Process Payments</a></li>
            <li><a href="#">All Payments</a></li>
            <li><a href="#">Payment Receipts</a></li>
            <li><a href="#">Financial Reports</a></li>
            <li><a href="#">Help Center</a></li>
          </ul>
        </div>

        {/* -------- Resources -------- */}
        <div className="footer-links">
          <h4>Resources</h4>
          <ul>
            <li><a href="#">Fee Payment Guide</a></li>
            <li><a href="#">Payment Schedule</a></li>
            <li><a href="#">Payment Methods</a></li>
            <li><a href="#">FAQ</a></li>
            <li><a href="#">Contact Finance</a></li>
          </ul>
        </div>

        {/* -------- Contact -------- */}
        <div className="footer-contact">
          <h4>Finance Department</h4>
          <div className="contact-item">
            <span className="contact-icon"><MapPin size={18} /></span>
            <span>
              Wendy Private School, Behind Salina Motors,
              Oshakondwa village next to punyu Village
            </span>
          </div>
          <div className="contact-item">
            <span className="contact-icon"><Phone size={18} /></span>
            <span>065 000 000 | 085 000 0000 | 081 000 0000</span>
          </div>
          <div className="contact-item">
            <span className="contact-icon"><Mail size={18} /></span>
            <span>info@wendyprivateschool.com</span>
          </div>
          <div className="contact-item">
            <span className="contact-icon"><Clock size={18} /></span>
            <span>Mon - Fri: 8:00 AM - 5:00 PM</span>
          </div>
        </div>
      </div>

      {/* -------- Copyright -------- */}
      <div className="footer-bottom">
        <p>
          &copy; 2025. All rights reserved. |
        </p>
      </div>
    </footer>
  );
}