import React from 'react';
import { 
  Facebook, 
  Twitter, 
  Linkedin, 
  Instagram, 
  Mail, 
  Phone, 
  MapPin, 
  ShieldCheck, 
  IndianRupee,
  Cpu,
  Github
} from 'lucide-react';
import { motion } from 'motion/react';

export const Footer = () => {
  const currentYear = new Date().getFullYear();

  const footerLinks = [
    {
      title: 'Product',
      links: [
        { label: 'GST Invoicing', href: '#' },
        { label: 'AI Bill Processing', href: '#' },
        { label: 'Inventory Management', href: '#' },
        { label: 'Financial Reporting', href: '#' },
      ]
    },
    {
      title: 'Company',
      links: [
        { label: 'About Us', href: '#' },
        { label: 'Success Stories', href: '#' },
        { label: 'Contact', href: '#' },
        { label: 'Release Notes', href: '#' },
      ]
    },
    {
      title: 'Resources',
      links: [
        { label: 'GST Guide', href: '#' },
        { label: 'Help Center', href: '#' },
        { label: 'Developer API', href: '#' },
        { label: 'Community', href: '#' },
      ]
    },
    {
      title: 'Legal',
      links: [
        { label: 'Privacy Policy', href: '#' },
        { label: 'Terms of Service', href: '#' },
        { label: 'Security', href: '#' },
        { label: 'Cookies', href: '#' },
      ]
    }
  ];

  return (
    <footer className="bg-slate-900 text-slate-400 py-16 mt-12 border-t border-slate-800 print:hidden">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-12 mb-16">
          {/* Logo and Brand */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2 font-bold text-2xl tracking-tight text-white mb-6">
              <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center">
                <IndianRupee size={22} />
              </div>
              <span>Lekha Sahayak</span>
            </div>
            <p className="text-sm leading-relaxed mb-8 max-w-xs">
              Modern GST-compliant ERP designed for the unique needs of Indian businesses. 
              Manage your finances with the power of AI.
            </p>
            <div className="flex gap-4">
              {[Twitter, Facebook, Linkedin, Instagram, Github].map((Icon, i) => (
                <a 
                  key={i} 
                  href="#" 
                  className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center hover:bg-orange-600 hover:text-white transition-all transform hover:-translate-y-1"
                >
                  <Icon size={18} />
                </a>
              ))}
            </div>
          </div>

          {/* Links */}
          {footerLinks.map((section, idx) => (
            <div key={idx}>
              <h4 className="text-white font-bold mb-6 uppercase text-xs tracking-widest">{section.title}</h4>
              <ul className="space-y-4">
                {section.links.map((link, lIdx) => (
                  <li key={lIdx}>
                    <a href={link.href} className="text-sm hover:text-orange-400 transition-colors">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Contact Info & Trust Badges */}
        <div className="border-t border-slate-800 pt-12 pb-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-500">
              <Phone size={18} />
            </div>
            <div>
              <div className="text-xs text-slate-500 uppercase font-bold">Support Hotline</div>
              <div className="text-slate-300 font-medium">+91 1800-123-4567</div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
              <Mail size={18} />
            </div>
            <div>
              <div className="text-xs text-slate-500 uppercase font-bold">Enterprise Sales</div>
              <div className="text-slate-300 font-medium">sales@lekhasahayak.io</div>
            </div>
          </div>

          <div className="flex items-center gap-4 lg:justify-end">
            <div className="flex items-center gap-3 bg-slate-800/50 px-4 py-2 rounded-xl border border-slate-700">
              <ShieldCheck className="text-emerald-500" size={20} />
              <div className="text-left">
                <div className="text-[10px] text-slate-500 uppercase font-bold leading-none mb-1">Secured By</div>
                <div className="text-xs text-white font-bold leading-none">ISO 27001 Certified</div>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-slate-800/50 px-4 py-2 rounded-xl border border-slate-700">
              <Cpu className="text-orange-500" size={20} />
              <div className="text-left">
                <div className="text-[10px] text-slate-500 uppercase font-bold leading-none mb-1">AI Powered</div>
                <div className="text-xs text-white font-bold leading-none">Gemini LLM</div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-slate-800 pt-8 mt-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-xs text-slate-500 font-medium">
            © {currentYear} Lekha Sahayak Technologies Pvt. Ltd. All rights reserved.
          </div>
          <div className="flex items-center gap-6">
            <div className="text-xs text-slate-500 font-medium flex items-center gap-1">
              <MapPin size={12} /> Made with ❤️ in India
            </div>
            <div className="text-xs bg-orange-500/10 text-orange-400 font-bold px-2 py-0.5 rounded">v2.4.0-pro</div>
          </div>
        </div>
      </div>
    </footer>
  );
};
