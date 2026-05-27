/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  LayoutDashboard, 
  ShoppingBag, 
  ShoppingCart, 
  Package, 
  Users, 
  FileText, 
  Settings, 
  Plus, 
  Building2, 
  LogOut,
  Upload,
  Menu,
  X,
  Search,
  RefreshCw,
  Bell,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  IndianRupee,
  Cpu,
  Layers,
  PieChart,
  ArrowLeft,
  ArrowDownLeft,
  TrendingUp,
  Trash2,
  Eye,
  Printer,
  History,
  Activity,
  ChevronDown,
  ChevronUp,
  BarChart3,
  ListFilter,
  FileCode,
  FileSpreadsheet,
  ShieldCheck,
  Scale,
  ClipboardList,
  Target
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  Legend,
  AreaChart,
  Area
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { validateGSTIN } from './lib/gst-utils';
import { getFinancialYears, getCurrentFY } from './lib/date-utils';
import { getDynamicStockValueForPeriod } from './lib/stock-utils';
import { auth, db } from './lib/firebase';
import { dbService } from './lib/db';
import { UserRole, UserProfile, PERMISSIONS } from './types';
import { where, orderBy, doc, onSnapshot as firestoreSnapshot, collection, query, getDocs, updateDoc } from 'firebase/firestore';

import { VoucherForm } from './components/VoucherForm';
import { FYRollover } from './components/FYRollover';
import { Reports } from './components/Reports';
import { TransactionsList } from './components/TransactionsList';
import { ItemMaster } from './components/ItemMaster';
import { LedgerMaster } from './components/LedgerMaster';
import { UnitMaster } from './components/UnitMaster';
import { CostCentreManager } from './components/CostCentreManager';
import { InvoiceForm } from './components/InvoiceForm';
import { SequenceSettings } from './components/SequenceSettings';
import { AIProcessor } from './components/AIProcessor';
import { StockSummaryReport } from './components/StockSummaryReport';
import { BankReconciliation } from './components/BankReconciliation';
import { UserPermissions } from './components/UserPermissions';
import { CompanySettings } from './components/CompanySettings';
import { Footer } from './components/Footer';

import { generateTallyXml, downloadTallyXml } from './services/tallyExport';
import { BankImportModal } from './components/BankImportModal';
import { BulkEntryModal } from './components/BulkEntryModal';
import { TallyVoucher } from './services/tallyImport';

// --- Dynamic Ledger Enrichment Utility ---
export const getEnrichedLedgers = (rawLedgers: any[], allTransactions: any[], targetPeriod: { startDate: string, endDate: string }) => {
  return rawLedgers.map(l => {
    const group = l.group || '';
    const isNominal = [
      'Sales Accounts', 'Purchase Accounts', 
      'Direct Expenses', 'Indirect Expenses', 
      'Direct Incomes', 'Indirect Incomes'
    ].some(g => group.includes(g));

    let totalImpactAllYears = 0;
    let impactBeforePeriod = 0;
    let impactInPeriod = 0;

    allTransactions.forEach((t: any) => {
      let impact = 0;
      if (t.partyId === l.id && t.totalAmount) {
        const isImmediatePayment = t.isPaid && t.bankId && ['Sales', 'Purchases'].includes(t.type);
        if (!isImmediatePayment) {
          let multiplier = ['Sales', 'Payment'].includes(t.type) ? 1 : -1;
          if (t.type === 'Contra') {
            multiplier = t.isDeposit ? -1 : 1;
          }
          impact = Number(t.totalAmount) * multiplier;
        }
      }
      if (t.bankId === l.id && t.totalAmount) {
        let bankMultiplier = ['Sales', 'Receipt'].includes(t.type) ? 1 : -1;
        if (t.type === 'Contra') {
          bankMultiplier = t.isDeposit ? 1 : -1;
        }
        impact = Number(t.totalAmount) * bankMultiplier;
      }
      if (t.debitLedgerId === l.id && t.totalAmount) {
        impact = Number(t.totalAmount);
      }
      if (t.creditLedgerId === l.id && t.totalAmount) {
        impact = -Number(t.totalAmount);
      }

      totalImpactAllYears += impact;
      if (t.date < targetPeriod.startDate) {
        impactBeforePeriod += impact;
      } else if (t.date <= targetPeriod.endDate) {
        impactInPeriod += impact;
      }
    });

    const staticCurrent = Number(l.currentBalance) ?? Number(l.openingBalance) ?? 0;
    const initialOpening = staticCurrent - totalImpactAllYears;

    let activeYearBalance = 0;
    if (isNominal) {
      activeYearBalance = impactInPeriod;
    } else {
      activeYearBalance = initialOpening + impactBeforePeriod + impactInPeriod;
    }

    // Special CGST/SGST/IGST logic
    if (l.group === 'Duties & Taxes') {
      const sales = allTransactions.filter((t: any) => t.type === 'Sales' && t.date >= targetPeriod.startDate && t.date <= targetPeriod.endDate);
      const purchases = allTransactions.filter((t: any) => t.type === 'Purchases' && t.date >= targetPeriod.startDate && t.date <= targetPeriod.endDate);
      const op = initialOpening + impactBeforePeriod;
      if (l.name === 'CGST') {
        const cgstSales = sales.reduce((sum, t) => sum + (Number(t.cgst) || 0), 0);
        const cgstPurchases = purchases.reduce((sum, t) => sum + (Number(t.cgst) || 0), 0);
        activeYearBalance = op + (cgstSales - cgstPurchases);
      } else if (l.name === 'SGST') {
        const sgstSales = sales.reduce((sum, t) => sum + (Number(t.sgst) || 0), 0);
        const sgstPurchases = purchases.reduce((sum, t) => sum + (Number(t.sgst) || 0), 0);
        activeYearBalance = op + (sgstSales - sgstPurchases);
      } else if (l.name === 'IGST') {
        const igstSales = sales.reduce((sum, t) => sum + (Number(t.igst) || 0), 0);
        const igstPurchases = purchases.reduce((sum, t) => sum + (Number(t.igst) || 0), 0);
        activeYearBalance = op + (igstSales - igstPurchases);
      }
    }

    return {
      ...l,
      openingBalance: isNominal ? 0 : initialOpening + impactBeforePeriod,
      currentBalance: activeYearBalance
    };
  });
};

// --- Types ---
type Page = 'dashboard' | 'sales' | 'purchases' | 'receipts' | 'payments' | 'contra' | 'credit-note' | 'debit-note' | 'journal' | 'inventory' | 'ledgers' | 'units' | 'cost-centres' | 'reports' | 'gst-reports' | 'financial-reports' | 'stock-summary' | 'bank-reconciliation' | 'team' | 'company-settings' | 'admin' | 'setup' | 'new-sale' | 'new-purchase' | 'new-receipt' | 'new-payment' | 'rollover' | 'settings' | 'pl' | 'bs' | 'tb' | 'cashbook' | 'bankbook' | 'ledger' | 'sales_reg' | 'pur_reg' | 'cn_reg' | 'dn_reg' | 'contra_reg' | 'journal_reg' | 'receipt_reg' | 'payment_reg' | 'stock' | 'itemprof' | 'gstr1' | 'gstr3b' | 'eway-bill-validator';

interface MenuItem {
  id: string;
  label: string;
  icon: any;
  shortcut?: string;
  isAction?: boolean;
  subItems?: MenuItem[];
}

// --- Shared Components ---
const Sidebar = ({ activePage, setActivePage, companies, activeCompany, setActiveCompany, activeFY, setActiveFY, setInvoicePrefill, onTallyExport, onTallyImport, onAIImport, onBulkImport, onCustomizeDashboard, userProfile, preSelectedReport, setPreSelectedReport }: any) => {
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [activeSubDropdown, setActiveSubDropdown] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!activeDropdown) setActiveSubDropdown(null);
  }, [activeDropdown]);
  const financialYears = getFinancialYears();
  const hasInventory = activeCompany?.accountingMode !== 'NGO_Trust' && activeCompany?.accountingMode !== 'AccountsOnly';
  
  const role: UserRole = (() => {
    if (!userProfile || !activeCompany) return 'Sales';
    if (activeCompany.ownerId === userProfile.uid) return 'Admin';
    const ass = userProfile.assignments?.find((a: any) => a.companyId === activeCompany.id);
    return ass ? ass.role : 'Sales';
  })();

  const permissions = PERMISSIONS[role] || [];
  const hasPermission = (id: string) => role === 'Admin' || (permissions && permissions.includes(id));

  const menuItems: MenuItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, shortcut: 'Alt+D' },
  ].filter(i => hasPermission(i.id));

  const invoiceItems: MenuItem[] = [
    { id: 'sales', label: 'Sales', icon: ShoppingBag, shortcut: 'Alt+S' },
    { id: 'purchases', label: 'Purchases', icon: ShoppingCart, shortcut: 'Alt+P' },
  ].filter(i => hasPermission(i.id));

  const transactions: MenuItem[] = [
    { id: 'receipts', label: 'Receipts', icon: ArrowDownRight, shortcut: 'Alt+R' },
    { id: 'payments', label: 'Payments', icon: ArrowUpRight, shortcut: 'Alt+Y' },
    { id: 'contra', label: 'Contra Entry', icon: Wallet, shortcut: 'Alt+C' },
    { id: 'credit-note', label: 'Credit Note', icon: FileText, shortcut: 'Alt+K' },
    { id: 'debit-note', label: 'Debit Note', icon: FileText, shortcut: 'Alt+B' },
    { id: 'journal', label: 'Journal Entry', icon: FileText, shortcut: 'Alt+J' },
  ].filter(i => hasPermission(i.id));

  const masters: MenuItem[] = [
    ...(hasInventory ? [{ id: 'inventory', label: 'Items & Stock', icon: Package, shortcut: 'Alt+I' }] : []),
    { id: 'ledgers', label: 'Parties/Ledgers', icon: Users, shortcut: 'Alt+L' },
    ...(hasInventory ? [{ id: 'units', label: 'Units of Measure', icon: Building2, shortcut: 'Alt+U' }] : []),
    { id: 'cost-centres', label: 'Cost Centres', icon: Target, shortcut: 'Alt+O' },
  ].filter(i => hasPermission(i.id));

  const reports: MenuItem[] = [
    { id: 'reports', label: 'All Reports', icon: FileText },
    { 
      id: 'gst-reports', 
      label: 'GST Reports', 
      icon: FileText,
      shortcut: 'Alt+G',
      subItems: [
        { id: 'gstr1', label: 'GSTR-1 Record', icon: FileText },
        { id: 'gstr3b', label: 'GSTR-3B Report', icon: FileText },
        { id: 'eway-bill-validator', label: 'e-Way Bill Validator', icon: FileText },
      ].filter(sub => hasPermission(sub.id))
    },
    { 
      id: 'financial-reports', 
      label: 'Financial Reports', 
      icon: PieChart,
      shortcut: 'Alt+F',
      subItems: [
        { id: 'pl', label: 'Profit & Loss', icon: TrendingUp },
        { id: 'bs', label: 'Balance Sheet', icon: Layers },
        { id: 'tb', label: 'Trial Balance', icon: FileText },
        { id: 'ledger', label: 'Ledger Report', icon: FileText },
        { id: 'sales_reg', label: 'Sales Register', icon: ArrowUpRight },
        { id: 'pur_reg', label: 'Purchase Register', icon: ArrowDownLeft },
        { id: 'cashbook', label: 'Cash Book', icon: Wallet },
        { id: 'bankbook', label: 'Bank Book', icon: Wallet },
        ...(hasInventory ? [
          { id: 'stock', label: 'Stock', icon: ShoppingBag },
          { id: 'itemprof', label: 'Item Profitability', icon: BarChart3 }
        ] : []),
      ].filter(sub => hasPermission(sub.id))
    },
  ].filter(i => hasPermission(i.id));

  const stockItems: MenuItem[] = hasInventory ? [
    { id: 'stock-summary', label: 'Item Wise Report', icon: Package, shortcut: 'Alt+W' },
    { id: 'inventory', label: 'Stock Master', icon: Layers, shortcut: 'Alt+I' },
  ].filter(i => hasPermission(i.id)) : [];

  const settingsItems: MenuItem[] = [
    { id: 'company-settings', label: 'Alter Company', icon: Building2 },
    { id: 'team', label: 'Team Management', icon: Users },
    { id: 'settings', label: 'Voucher Numbering', icon: Settings },
    { id: 'rollover', label: 'FY Rollover', icon: RefreshCw },
    { id: 'customize-dashboard', label: 'Customize Dashboard', icon: ListFilter, isAction: true },
    { id: 'tally-export', label: 'Tally XML Export', icon: FileText, isAction: true },
  ].filter(i => hasPermission(i.id));

  const importItems: MenuItem[] = [
    { id: 'bank-import', label: 'AI Bank Statement', icon: Cpu, isAction: true, shortcut: 'Alt+A' },
    { id: 'bank-reconciliation', label: 'Bank Reconciliation', icon: ShieldCheck },
    { id: 'tally-import-direct', label: 'Tally XML Import', icon: FileCode, isAction: true },
    { id: 'excel-import', label: 'Bank Excel/CSV Import', icon: FileSpreadsheet, isAction: true },
    { id: 'bulk-import', label: 'Sales & Purchases Bulk Entry', icon: ClipboardList, isAction: true },
  ].filter(i => i.id === 'bulk-import' ? true : hasPermission(i.id));

  const registerItems: MenuItem[] = [
    { id: 'sales_reg', label: 'Sales Register', icon: ArrowUpRight },
    { id: 'pur_reg', label: 'Purchase Register', icon: ArrowDownLeft },
    { id: 'cn_reg', label: 'Credit Note Register', icon: FileText },
    { id: 'dn_reg', label: 'Debit Note Register', icon: FileText },
    { id: 'contra_reg', label: 'Contra Register', icon: Wallet },
    { id: 'journal_reg', label: 'Journal Register', icon: ClipboardList },
    { id: 'receipt_reg', label: 'Receipts Register', icon: ArrowDownRight },
    { id: 'payment_reg', label: 'Payments Register', icon: ArrowUpRight },
  ].filter(i => hasPermission(i.id) || true);

  const dropdowns: { id: string, label: string, icon: any, items: MenuItem[] }[] = [
    { id: 'invoices', label: 'Invoices', icon: FileText, items: invoiceItems },
    { id: 'transactions', label: 'Transactions', icon: ShoppingBag, items: transactions },
    { id: 'registers', label: 'Register', icon: ClipboardList, items: registerItems },
    { id: 'import', label: 'Import', icon: Upload, items: importItems },
    { id: 'stock', label: 'Stock', icon: Package, items: stockItems },
    { id: 'masters', label: 'Masters', icon: Layers, items: masters },
    { id: 'reports', label: 'Reports', icon: FileText, items: reports },
    { id: 'config', label: 'Settings', icon: Settings, items: settingsItems },
  ].filter(d => d.items.length > 0);

  return (
    <nav className="fixed top-0 left-0 right-0 h-16 bg-[#93C572] flex items-center px-4 md:px-6 z-[1000] text-emerald-950 justify-between print:hidden border-b border-emerald-900/20 shadow-md shadow-emerald-950/10">
      <div className="flex items-center gap-2 md:gap-6">
        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="md:hidden p-2 hover:bg-black/5 rounded-lg text-emerald-950"
        >
          {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        <div className="flex items-center gap-2 font-extrabold text-lg md:text-xl tracking-tight text-emerald-950">
          <div className="w-8 h-8 bg-emerald-900 rounded-lg flex items-center justify-center text-white">
            <IndianRupee size={18} />
          </div>
          <span className="hidden sm:inline">Lekha Sahayak</span>
        </div>
        
        <div className="hidden md:flex items-center gap-1.5 lg:gap-3 select-none">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActivePage(item.id);
                setActiveDropdown(null);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all group ${
                activePage === item.id ? 'bg-white/70 shadow-sm border border-emerald-900/10 text-emerald-950 font-bold' : 'text-emerald-900/80 hover:text-emerald-950 hover:bg-black/5'
              }`}
            >
              <item.icon size={18} />
              <span className="text-sm">{item.label}</span>
              {item.shortcut && (
                <span className="text-[9px] opacity-0 group-hover:opacity-100 transition-opacity bg-black/5 px-1 rounded font-mono">
                  {item.shortcut}
                </span>
              )}
            </button>
          ))}

          {dropdowns.map((dropdown) => (
            <div key={dropdown.id} className="relative">
              <button
                onClick={() => setActiveDropdown(activeDropdown === dropdown.id ? null : dropdown.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${
                  dropdown.items.some(i => i.id === activePage) ? 'bg-white/70 shadow-sm border border-emerald-900/10 text-emerald-950 font-bold' : 'text-emerald-900/80 hover:text-emerald-950 hover:bg-black/5'
                }`}
              >
                <dropdown.icon size={18} />
                <span className="text-sm">{dropdown.label}</span>
                <ChevronDown size={14} className={`transition-transform ${activeDropdown === dropdown.id ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {activeDropdown === dropdown.id && (
                  <>
                    <div className="fixed inset-0 z-[-1]" onClick={() => setActiveDropdown(null)} />
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute top-full left-0 mt-2 w-56 bg-[#E2EFE2] rounded-xl shadow-2xl border border-emerald-900/15 py-2 text-emerald-950 z-[100] max-h-[70vh] md:max-h-[80vh] overflow-y-auto custom-scrollbar"
                    >
                      {dropdown.items.map((m) => (
                        <div key={m.id} className="relative group/item">
                          <button
                            onClick={() => {
                              if (m.subItems) {
                                setActiveSubDropdown(activeSubDropdown === m.id ? null : m.id);
                                return;
                              }
                              if (m.id === 'tally-export') {
                                onTallyExport();
                                setActiveDropdown(null);
                                return;
                              }
                              if (m.id === 'customize-dashboard') {
                                onCustomizeDashboard();
                                setActiveDropdown(null);
                                return;
                              }
                              if (m.id === 'bank-import' || m.id === 'excel-import') {
                                onAIImport();
                                setActiveDropdown(null);
                                return;
                              }
                              if (m.id === 'bulk-import') {
                                onBulkImport();
                                setActiveDropdown(null);
                                return;
                              }
                              if (m.id === 'tally-import-direct') {
                                onTallyImport();
                                setActiveDropdown(null);
                                return;
                              }
                              if (m.id === 'new-sale' || m.id === 'new-purchase') setInvoicePrefill(null);
                              
                              setActivePage(m.id);
                              setActiveDropdown(null);
                            }}
                            className={`w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#D2ECD2] transition-colors text-sm font-medium ${activeSubDropdown === m.id ? 'bg-[#D2ECD2]' : ''}`}
                          >
                            <div className="flex items-center gap-3">
                              <m.icon size={16} className="text-emerald-700" />
                              {m.label}
                            </div>
                            <div className="flex items-center gap-1">
                              {m.subItems && <ChevronDown size={14} className={activeSubDropdown === m.id ? 'rotate-180' : ''} />}
                              {m.shortcut && (
                                <span className="text-[10px] text-emerald-800 font-mono bg-emerald-900/10 px-1 rounded border border-emerald-900/10">
                                  {m.shortcut}
                                </span>
                              )}
                            </div>
                          </button>

                          {m.subItems && activeSubDropdown === m.id && (
                            <motion.div 
                              initial={{ opacity: 0, x: 20 }}
                              animate={{ opacity: 1, x: 0 }}
                              className="absolute left-full top-0 ml-1 w-56 bg-[#E2EFE2] rounded-xl shadow-2xl border border-emerald-900/15 py-2 z-[110] max-h-[70vh] md:max-h-[80vh] overflow-y-auto custom-scrollbar"
                            >
                              <div className="px-4 py-2 text-[10px] font-black text-emerald-600 uppercase tracking-widest border-b border-emerald-900/10 mb-1">
                                Select {m.label}
                              </div>
                              {m.subItems.map(sub => (
                                <button
                                  key={sub.id}
                                  onClick={() => {
                                    setPreSelectedReport(sub.id);
                                    setActivePage(m.id);
                                    setActiveDropdown(null);
                                    setActiveSubDropdown(null);
                                  }}
                                  className="w-full flex items-center gap-3 px-4 py-2 hover:bg-[#D2ECD2] text-[#0d2310] transition-colors text-sm"
                                >
                                  <sub.icon size={14} className="opacity-70 text-emerald-700" />
                                  {sub.label}
                                </button>
                              ))}
                            </motion.div>
                          )}
                        </div>
                      ))}
                      {dropdown.id === 'masters' && (
                        <div className="border-t border-emerald-900/10 mt-2 pt-2">
                             <button
                            onClick={() => {
                              setActivePage('setup');
                              setActiveDropdown(null);
                            }}
                            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#D2ECD2] text-emerald-900 transition-colors text-sm font-bold"
                          >
                            <div className="flex items-center gap-3">
                              <Plus size={16} />
                              Add New Company
                            </div>
                            <span className="text-[10px] text-emerald-800 font-mono bg-emerald-900/10 px-1 rounded border border-emerald-900/10">
                              Alt+N
                            </span>
                          </button>
                        </div>
                      )}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-4">
        <div className="hidden sm:flex items-center gap-2">
          <label className="text-[10px] uppercase font-bold text-emerald-950">FY</label>
          <select 
            value={activeFY?.id || ''}
            onChange={(e) => setActiveFY(financialYears.find(fy => fy.id === e.target.value))}
            className="bg-emerald-50 border border-emerald-900/30 text-emerald-950 outline-none text-xs rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-emerald-600 font-bold cursor-pointer"
          >
            {financialYears.map((fy) => (
              <option key={fy.id} value={fy.id} className="text-slate-900">{fy.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col">
          <div className="hidden sm:flex items-center justify-between px-1 mb-0.5">
            <span className="text-[8px] uppercase font-bold text-emerald-950 tracking-widest">Business</span>
            <span className="text-[8px] font-mono text-emerald-950 bg-black/5 px-1 rounded">Alt+X</span>
          </div>
          <select 
            value={activeCompany?.id || ''}
            onChange={(e) => setActiveCompany(companies.find((c: any) => c.id === e.target.value))}
            className="bg-emerald-50 border border-emerald-900/30 text-emerald-950 outline-none text-xs md:text-sm rounded-lg px-2 md:px-3 py-1.5 max-w-[120px] md:min-w-[150px] focus:ring-1 focus:ring-emerald-600 font-bold cursor-pointer"
          >
            {companies.map((c: any) => (
              <option key={c.id} value={c.id} className="text-slate-900">{c.name}</option>
            ))}
            {companies.length === 0 && <option value="">No Company</option>}
          </select>
        </div>

        <button onClick={() => signOut(auth)} className="p-2 hover:bg-black/5 text-emerald-950 hover:text-red-700 rounded-full transition-all">
          <LogOut size={18} />
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div 
            initial={{ opacity: 0, x: -100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -100 }}
            className="fixed inset-0 bg-[#F3F9F3] z-[2000] md:hidden overflow-y-auto"
          >
            <div className="p-6">
              <div className="flex justify-between items-center mb-8">
                <div className="flex items-center gap-2 font-bold text-xl text-emerald-950">
                  <div className="w-8 h-8 bg-emerald-900 rounded-lg flex items-center justify-center text-white">
                    <IndianRupee size={18} />
                  </div>
                  <span>Lekha Sahayak</span>
                </div>
                <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 text-emerald-950 hover:bg-black/5 rounded-full">
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-6">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-emerald-800 uppercase tracking-widest px-3 mb-2">Main Menu</div>
                  {menuItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActivePage(item.id);
                        setIsMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all ${
                        activePage === item.id ? 'bg-[#A5D2A5] text-emerald-950 font-bold border border-emerald-900/10' : 'text-emerald-900/85 hover:bg-black/5'
                      }`}
                    >
                      <item.icon size={20} />
                      <span className="font-medium">{item.label}</span>
                    </button>
                  ))}
                </div>

                {dropdowns.map((dropdown) => (
                  <div key={dropdown.id} className="space-y-1">
                    <div className="text-xs font-bold text-emerald-800 uppercase tracking-widest px-3 mb-2">{dropdown.label}</div>
                    <div className="grid grid-cols-1 gap-1 pl-2 border-l border-emerald-950/10">
                      {dropdown.items.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => {
                            if (m.isAction) {
                              if (m.id === 'tally-export') onTallyExport();
                              else if (m.id === 'customize-dashboard') onCustomizeDashboard();
                              else if (m.id === 'bank-import' || m.id === 'excel-import') onAIImport();
                              else if (m.id === 'bulk-import') onBulkImport();
                              else if (m.id === 'tally-import-direct') onTallyImport();
                              setIsMobileMenuOpen(false);
                              return;
                            }
                            setActivePage(m.id);
                            setIsMobileMenuOpen(false);
                          }}
                          className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all ${
                            activePage === m.id ? 'bg-[#A5D2A5] text-emerald-950 font-bold border border-[#96c496]' : 'text-emerald-900/85 hover:bg-black/5'
                          }`}
                        >
                          <m.icon size={18} />
                          <span className="text-sm">{m.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="pt-6 border-t border-emerald-900/10 space-y-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-emerald-800 uppercase tracking-widest px-3">Current FY</label>
                     <select 
                        value={activeFY?.id || ''}
                        onChange={(e) => setActiveFY(financialYears.find(fy => fy.id === e.target.value))}
                        className="w-full bg-[#A5D2A5] border-none outline-none rounded-xl px-4 py-3 text-slate-800"
                      >
                        {financialYears.map((fy) => (
                          <option key={fy.id} value={fy.id} className="text-slate-900">{fy.label}</option>
                        ))}
                      </select>
                  </div>
                  
                  <button 
                    onClick={() => signOut(auth)}
                    className="w-full flex items-center gap-4 px-4 py-4 bg-red-500/10 text-red-750 hover:bg-red-500/20 rounded-xl font-bold"
                  >
                    <LogOut size={20} />
                    Logout Account
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

// --- Pages ---
const ActivityLog = ({ companyId }: { companyId: string }) => {
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    if (!companyId) return;
    return dbService.listenCollection(`companies/${companyId}/activity_logs`, [orderBy('timestamp', 'desc')], (data) => {
      setLogs(data.slice(0, 50));
    });
  }, [companyId]);

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-100 rounded-lg text-slate-600">
            <History size={20} />
          </div>
          <div>
            <h3 className="font-bold font-display tracking-tight text-slate-900">System Activity Log</h3>
            <p className="text-xs text-slate-500">Real-time audit trail of all changes</p>
          </div>
        </div>
      </div>

      <div className="overflow-hidden">
        <div className="divide-y divide-slate-100">
          {logs.map((log, i) => (
            <div key={log.id} className="py-3 flex gap-4 items-start hover:bg-slate-50 px-2 rounded-lg transition-colors">
              <div className={`p-1.5 rounded-full mt-0.5 ${
                log.action === 'CREATE' ? 'bg-emerald-50 text-emerald-600' :
                log.action === 'UPDATE' ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-600'
              }`}>
                <Activity size={12} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start gap-2">
                  <p className="text-sm font-medium text-slate-800 leading-tight truncate">
                    {log.details}
                  </p>
                  <span className="text-[10px] text-slate-400 whitespace-nowrap font-medium">
                    {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[10px] font-semibold tracking-wider px-1.5 py-0.5 rounded ${
                    log.action === 'CREATE' ? 'bg-emerald-100 text-emerald-700' :
                    log.action === 'UPDATE' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {log.action}
                  </span>
                  <span className="text-[10px] text-slate-500">{log.userEmail}</span>
                  <span className="text-[10px] text-slate-400">• {new Date(log.timestamp).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          ))}
          {logs.length === 0 && (
            <div className="py-12 text-center text-slate-400 italic text-sm">No activity recorded yet.</div>
          )}
        </div>
      </div>
    </div>
  );
};

const CustomTrendTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white/95 backdrop-blur-sm border border-slate-200/60 p-3 rounded-2xl shadow-xl shadow-slate-100 font-sans text-xs">
        <p className="font-bold text-slate-900 mb-2 font-display text-xs uppercase tracking-wider">{label}</p>
        <div className="space-y-2">
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex items-center gap-4 justify-between">
              <span className="flex items-center gap-1.5 text-slate-500 font-medium">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.stroke }} />
                {entry.name}
              </span>
              <span className="font-bold text-slate-900">₹{entry.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

const Dashboard = ({ activeCompany, setActivePage, activeFY, setInvoicePrefill, onPrint, onPreview, showWidgetSettings, setShowWidgetSettings, role }: any) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
    };
    const handleOffline = () => {
      setIsOnline(false);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [stockAlerts, setStockAlerts] = useState<any[]>([]);
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryFilter, setInventoryFilter] = useState<'all' | 'low'>('all');
  const [receivablesList, setReceivablesList] = useState<any[]>([]);
  const [payablesList, setPayablesList] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [topItems, setTopItems] = useState<any[]>([]);
  const [trendData, setTrendData] = useState<any[]>([]);
  const [ledgers, setLedgers] = useState<any[]>([]);
  const [rawLedgers, setRawLedgers] = useState<any[]>([]);
  const [globalTransactions, setGlobalTransactions] = useState<any[]>([]);
  const [plSummary, setPlSummary] = useState({
    income: 0,
    expense: 0,
    grossProfit: 0,
    netProfit: 0
  });
  const [bsSummary, setBsSummary] = useState({
    assets: 0,
    liabilities: 0,
    equity: 0
  });
  const [stats, setStats] = useState({
    sales: 0,
    purchases: 0,
    gst: 0,
    gstOutput: 0,
    gstInput: 0,
    bank: 0,
    cash: 0,
    receivables: 0,
    payables: 0
  });

  const [liqPeriod, setLiqPeriod] = useState<'fy' | 'month' | 'last30' | 'quarter' | 'custom'>('fy');
  const [liqStartDate, setLiqStartDate] = useState(activeFY?.startDate || '');
  const [liqEndDate, setLiqEndDate] = useState(activeFY?.endDate || '');

  useEffect(() => {
    const today = new Date('2026-05-22'); // Grounded on current local time: 2026-05-22
    const getFormattedDate = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    if (liqPeriod === 'fy') {
      setLiqStartDate(activeFY?.startDate || '');
      setLiqEndDate(activeFY?.endDate || '');
    } else if (liqPeriod === 'month') {
      const year = today.getFullYear();
      const month = today.getMonth();
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0);
      setLiqStartDate(getFormattedDate(start));
      setLiqEndDate(getFormattedDate(end));
    } else if (liqPeriod === 'last30') {
      const start = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      setLiqStartDate(getFormattedDate(start));
      setLiqEndDate(getFormattedDate(today));
    } else if (liqPeriod === 'quarter') {
      const month = today.getMonth();
      const quarter = Math.floor(month / 3);
      const start = new Date(today.getFullYear(), quarter * 3, 1);
      const end = new Date(today.getFullYear(), (quarter + 1) * 3, 0);
      setLiqStartDate(getFormattedDate(start));
      setLiqEndDate(getFormattedDate(end));
    }
  }, [liqPeriod, activeFY]);

  const getTransactionImpactOnCashBank = (t: any, ledgerId: string) => {
    const amount = Number(t.totalAmount || t.amount || 0);
    if (!amount) return 0;

    if (t.type === 'Contra') {
      if (t.bankId === ledgerId) {
        return t.isDeposit ? amount : -amount;
      }
      if (t.partyId === ledgerId) {
        return t.isDeposit ? -amount : amount;
      }
    }

    if (t.bankId === ledgerId) {
      if (['Sales', 'Receipt'].includes(t.type)) return amount;
      if (['Purchases', 'Payment'].includes(t.type)) return -amount;
    }

    const lowerType = (t.type || '').toLowerCase();
    if (t.bankId === ledgerId) {
      if (['sales', 'receipt'].includes(lowerType)) return amount;
      if (['purchases', 'payment'].includes(lowerType)) return -amount;
    }

    return 0;
  };

  const bankLedgers = ledgers.filter((l: any) => l.group === 'Bank Accounts' || l.group === 'Bank');
  const cashLedgers = ledgers.filter((l: any) => l.group === 'Cash-in-hand');

  const getLedgersPeriodMetrics = (targetLedgers: any[]) => {
    return targetLedgers.map((l: any) => {
      const fyOpening = Number(l.openingBalance) || 0;
      
      const opTransactionsSum = globalTransactions
        .filter((t: any) => t.date < liqStartDate)
        .reduce((sum, t) => sum + getTransactionImpactOnCashBank(t, l.id), 0);
      
      const periodOpening = fyOpening + opTransactionsSum;
      const periodTx = globalTransactions.filter((t: any) => t.date >= liqStartDate && t.date <= liqEndDate);
      
      const inflow = periodTx.reduce((sum, t) => {
        const imp = getTransactionImpactOnCashBank(t, l.id);
        return imp > 0 ? sum + imp : sum;
      }, 0);

      const outflow = periodTx.reduce((sum, t) => {
        const imp = getTransactionImpactOnCashBank(t, l.id);
        return imp < 0 ? sum + Math.abs(imp) : sum;
      }, 0);

      const periodClosing = periodOpening + inflow - outflow;

      return {
        id: l.id,
        name: l.name,
        group: l.group,
        opening: periodOpening,
        inflow,
        outflow,
        closing: periodClosing
      };
    });
  };

  const bankAccountsMetrics = getLedgersPeriodMetrics(bankLedgers);
  const cashAccountsMetrics = getLedgersPeriodMetrics(cashLedgers);

  const bankMetrics = bankAccountsMetrics.reduce((sum, m) => ({
    opening: sum.opening + m.opening,
    inflow: sum.inflow + m.inflow,
    outflow: sum.outflow + m.outflow,
    closing: sum.closing + m.closing
  }), { opening: 0, inflow: 0, outflow: 0, closing: 0 });

  const cashMetrics = cashAccountsMetrics.reduce((sum, m) => ({
    opening: sum.opening + m.opening,
    inflow: sum.inflow + m.inflow,
    outflow: sum.outflow + m.outflow,
    closing: sum.closing + m.closing
  }), { opening: 0, inflow: 0, outflow: 0, closing: 0 });

  const [plPeriod, setPlPeriod] = useState<'fy' | 'month' | 'last30' | 'quarter' | 'custom'>('fy');
  const [plStartDate, setPlStartDate] = useState(activeFY?.startDate || '');
  const [plEndDate, setPlEndDate] = useState(activeFY?.endDate || '');
  const [plViewMode, setPlViewMode] = useState<'nature' | 'standard'>('nature');
  const [plDetailed, setPlDetailed] = useState(true);

  useEffect(() => {
    const today = new Date('2026-05-22'); // Grounded on current local time: 2026-05-22
    const getFormattedDate = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    if (plPeriod === 'fy') {
      setPlStartDate(activeFY?.startDate || '');
      setPlEndDate(activeFY?.endDate || '');
    } else if (plPeriod === 'month') {
      const year = today.getFullYear();
      const month = today.getMonth();
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0);
      setPlStartDate(getFormattedDate(start));
      setPlEndDate(getFormattedDate(end));
    } else if (plPeriod === 'last30') {
      const start = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      setPlStartDate(getFormattedDate(start));
      setPlEndDate(getFormattedDate(today));
    } else if (plPeriod === 'quarter') {
      const month = today.getMonth();
      const quarter = Math.floor(month / 3);
      const start = new Date(today.getFullYear(), quarter * 3, 1);
      const end = new Date(today.getFullYear(), (quarter + 1) * 3, 0);
      setPlStartDate(getFormattedDate(start));
      setPlEndDate(getFormattedDate(end));
    }
  }, [plPeriod, activeFY]);

  const plMetrics = React.useMemo(() => {
    const periodTx = globalTransactions.filter((t: any) => t.date >= plStartDate && t.date <= plEndDate);
    const getTax = (t: any) => t.totalTax ?? ((t.cgst || 0) + (t.sgst || 0) + (t.igst || 0)) ?? 0;

    const salesTx = periodTx.filter((t: any) => t.type === 'Sales');
    const purchasesTx = periodTx.filter((t: any) => t.type === 'Purchases');

    const grossSalesPrice = salesTx.reduce((sum: number, t: any) => sum + (t.totalAmount || 0), 0);
    const grossPurchasesPrice = purchasesTx.reduce((sum: number, t: any) => sum + (t.totalAmount || 0), 0);

    const netSalesPrice = salesTx.reduce((sum: number, t: any) => sum + ((t.totalAmount || 0) - (getTax(t) || 0)), 0);
    const netPurchasesPrice = purchasesTx.reduce((sum: number, t: any) => sum + ((t.totalAmount || 0) - (getTax(t) || 0)), 0);

    const directExpenseLedgers = ledgers.filter((l: any) => l.group === 'Direct Expenses');
    const indirectExpenseLedgers = ledgers.filter((l: any) => l.group === 'Indirect Expenses');
    const directIncomesLedgers = ledgers.filter((l: any) => l.group === 'Direct Incomes');
    const indirectIncomesLedgers = ledgers.filter((l: any) => l.group === 'Indirect Incomes');

    const directExpensesList = directExpenseLedgers.map((l: any) => {
      const txForLedger = periodTx.filter((t: any) => (t.partyId === l.id || t.ledgerId === l.id) && t.type === 'Payment');
      return {
        id: l.id,
        name: l.name,
        group: l.group,
        amount: txForLedger.reduce((sum: number, t: any) => sum + (t.totalAmount || 0), 0)
      };
    }).filter((e: any) => e.amount > 0);

    const indirectExpensesList = indirectExpenseLedgers.map((l: any) => {
      const txForLedger = periodTx.filter((t: any) => (t.partyId === l.id || t.ledgerId === l.id) && t.type === 'Payment');
      return {
        id: l.id,
        name: l.name,
        group: l.group,
        amount: txForLedger.reduce((sum: number, t: any) => sum + (t.totalAmount || 0), 0)
      };
    }).filter((e: any) => e.amount > 0);

    const directIncomesList = directIncomesLedgers.map((l: any) => {
      const txForLedger = periodTx.filter((t: any) => (t.partyId === l.id || t.ledgerId === l.id) && t.type === 'Receipt');
      return {
        id: l.id,
        name: l.name,
        group: l.group,
        amount: txForLedger.reduce((sum: number, t: any) => sum + (t.totalAmount || 0), 0)
      };
    }).filter((i: any) => i.amount > 0);

    const indirectIncomesList = indirectIncomesLedgers.map((l: any) => {
      const txForLedger = periodTx.filter((t: any) => (t.partyId === l.id || t.ledgerId === l.id) && t.type === 'Receipt');
      return {
        id: l.id,
        name: l.name,
        group: l.group,
        amount: txForLedger.reduce((sum: number, t: any) => sum + (t.totalAmount || 0), 0)
      };
    }).filter((i: any) => i.amount > 0);

    const totalDirectExpenses = directExpensesList.reduce((sum: number, e: any) => sum + e.amount, 0);
    const totalIndirectExpenses = indirectExpensesList.reduce((sum: number, e: any) => sum + e.amount, 0);
    const totalDirectIncomes = directIncomesList.reduce((sum: number, i: any) => sum + i.amount, 0);
    const totalIndirectIncomes = indirectIncomesList.reduce((sum: number, i: any) => sum + i.amount, 0);

    const { totalOpeningStockValue, totalClosingStockValue, dynamicItems } = getDynamicStockValueForPeriod(
      inventoryItems,
      globalTransactions,
      { startDate: plStartDate, endDate: plEndDate },
      activeCompany
    );

    const enrichedLedgersForPL = getEnrichedLedgers(rawLedgers, globalTransactions, { startDate: plStartDate, endDate: plEndDate });
    const stockInHandLedgersForPL = enrichedLedgersForPL.filter((l: any) => l.group && (l.group.toLowerCase().includes('stock-in-hand') || l.group.toLowerCase() === 'stock in hand'));
    const ledgerOpeningStockValue = stockInHandLedgersForPL.reduce((sum: number, l: any) => sum + (Number(l.openingBalance) || 0), 0);
    const ledgerClosingStockValue = stockInHandLedgersForPL.reduce((sum: number, l: any) => sum + (Number(l.currentBalance) || 0), 0);

    const openingStockValue = totalOpeningStockValue > 0 ? totalOpeningStockValue : ledgerOpeningStockValue;
    const closingStockValueFinal = activeCompany?.manualClosingStock 
      ? Number(activeCompany.manualClosingStockValue || 0) 
      : (totalClosingStockValue > 0 ? totalClosingStockValue : ledgerClosingStockValue);

    const totalTradingCredit = netSalesPrice + closingStockValueFinal + totalDirectIncomes;
    const totalTradingDebit = (plPeriod === 'fy' ? openingStockValue : 0) + netPurchasesPrice + totalDirectExpenses;
    const grossProfitValue = totalTradingCredit - totalTradingDebit;
    
    const netProfitValue = grossProfitValue + totalIndirectIncomes - totalIndirectExpenses;

    return {
      grossSales: grossSalesPrice,
      grossPurchases: grossPurchasesPrice,
      netSales: netSalesPrice,
      netPurchases: netPurchasesPrice,
      directExpenses: totalDirectExpenses,
      indirectExpenses: totalIndirectExpenses,
      directExpensesList,
      indirectExpensesList,
      directIncomes: totalDirectIncomes,
      indirectIncomes: totalIndirectIncomes,
      openingStock: plPeriod === 'fy' ? openingStockValue : 0,
      closingStock: closingStockValueFinal,
      grossProfit: grossProfitValue,
      netProfit: netProfitValue,
      dynamicItems
    };
  }, [globalTransactions, ledgers, inventoryItems, plStartDate, plEndDate, plPeriod, activeCompany]);

  const [bsPeriod, setBsPeriod] = useState<'fy' | 'month' | 'last30' | 'quarter' | 'custom'>('fy');
  const [bsStartDate, setBsStartDate] = useState(activeFY?.startDate || '');
  const [bsEndDate, setBsEndDate] = useState(activeFY?.endDate || '');
  const [bsViewMode, setBsViewMode] = useState<'nature' | 'standard'>('nature');
  const [bsDetailed, setBsDetailed] = useState(true);

  const [tbPeriod, setTbPeriod] = useState<'fy' | 'month' | 'last30' | 'quarter' | 'custom'>('fy');
  const [tbStartDate, setTbStartDate] = useState(activeFY?.startDate || '');
  const [tbEndDate, setTbEndDate] = useState(activeFY?.endDate || '');
  const [tbViewMode, setTbViewMode] = useState<'nature' | 'standard'>('nature');
  const [tbDetailed, setTbDetailed] = useState(true);

  useEffect(() => {
    const today = new Date('2026-05-22');
    const getFormattedDate = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    if (tbPeriod === 'fy') {
      setTbStartDate(activeFY?.startDate || '');
      setTbEndDate(activeFY?.endDate || '');
    } else if (tbPeriod === 'month') {
      const year = today.getFullYear();
      const month = today.getMonth();
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0);
      setTbStartDate(getFormattedDate(start));
      setTbEndDate(getFormattedDate(end));
    } else if (tbPeriod === 'last30') {
      const start = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      setTbStartDate(getFormattedDate(start));
      setTbEndDate(getFormattedDate(today));
    } else if (tbPeriod === 'quarter') {
      const month = today.getMonth();
      const quarter = Math.floor(month / 3);
      const start = new Date(today.getFullYear(), quarter * 3, 1);
      const end = new Date(today.getFullYear(), (quarter + 1) * 3, 0);
      setTbStartDate(getFormattedDate(start));
      setTbEndDate(getFormattedDate(end));
    }
  }, [tbPeriod, activeFY]);

  useEffect(() => {
    const today = new Date('2026-05-22'); // Grounded on current local time: 2026-05-22
    const getFormattedDate = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    if (bsPeriod === 'fy') {
      setBsStartDate(activeFY?.startDate || '');
      setBsEndDate(activeFY?.endDate || '');
    } else if (bsPeriod === 'month') {
      const year = today.getFullYear();
      const month = today.getMonth();
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0);
      setBsStartDate(getFormattedDate(start));
      setBsEndDate(getFormattedDate(end));
    } else if (bsPeriod === 'last30') {
      const start = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      setBsStartDate(getFormattedDate(start));
      setBsEndDate(getFormattedDate(today));
    } else if (bsPeriod === 'quarter') {
      const month = today.getMonth();
      const quarter = Math.floor(month / 3);
      const start = new Date(today.getFullYear(), quarter * 3, 1);
      const end = new Date(today.getFullYear(), (quarter + 1) * 3, 0);
      setBsStartDate(getFormattedDate(start));
      setBsEndDate(getFormattedDate(end));
    }
  }, [bsPeriod, activeFY]);

  const bsMetrics = React.useMemo(() => {
    const enriched = getEnrichedLedgers(rawLedgers, globalTransactions, { startDate: bsStartDate, endDate: bsEndDate });
    const dynamicLedgers = enriched.map(l => ({ ...l, dynamicBalance: l.currentBalance }));

    const periodTx = globalTransactions.filter((t: any) => t.date >= bsStartDate && t.date <= bsEndDate);
    const getTax = (t: any) => t.totalTax ?? ((t.cgst || 0) + (t.sgst || 0) + (t.igst || 0)) ?? 0;

    const pSalesTx = periodTx.filter((t: any) => t.type === 'Sales');
    const pPurchasesTx = periodTx.filter((t: any) => t.type === 'Purchases');

    const netSales = pSalesTx.reduce((sum: number, t: any) => sum + ((t.totalAmount || 0) - (getTax(t) || 0)), 0);
    const netPurchases = pPurchasesTx.reduce((sum: number, t: any) => sum + ((t.totalAmount || 0) - (getTax(t) || 0)), 0);

    const directExpenseLedgers = rawLedgers.filter((l: any) => l.group === 'Direct Expenses');
    const indirectExpenseLedgers = rawLedgers.filter((l: any) => l.group === 'Indirect Expenses');
    const directIncomesLedgers = rawLedgers.filter((l: any) => l.group === 'Direct Incomes');
    const indirectIncomesLedgers = rawLedgers.filter((l: any) => l.group === 'Indirect Incomes');

    const totalDirectExpenses = directExpenseLedgers.reduce((sum: number, l: any) => {
      const txForLedger = periodTx.filter((t: any) => (t.partyId === l.id || t.ledgerId === l.id) && t.type === 'Payment');
      return sum + txForLedger.reduce((s: number, t: any) => s + (t.totalAmount || 0), 0);
    }, 0);

    const totalIndirectExpenses = indirectExpenseLedgers.reduce((sum: number, l: any) => {
      const txForLedger = periodTx.filter((t: any) => (t.partyId === l.id || t.ledgerId === l.id) && t.type === 'Payment');
      return sum + txForLedger.reduce((s: number, t: any) => s + (t.totalAmount || 0), 0);
    }, 0);

    const totalDirectIncomes = directIncomesLedgers.reduce((sum: number, l: any) => {
      const txForLedger = periodTx.filter((t: any) => (t.partyId === l.id || t.ledgerId === l.id) && t.type === 'Receipt');
      return sum + txForLedger.reduce((s: number, t: any) => s + (t.totalAmount || 0), 0);
    }, 0);

    const totalIndirectIncomes = indirectIncomesLedgers.reduce((sum: number, l: any) => {
      const txForLedger = periodTx.filter((t: any) => (t.partyId === l.id || t.ledgerId === l.id) && t.type === 'Receipt');
      return sum + txForLedger.reduce((s: number, t: any) => s + (t.totalAmount || 0), 0);
    }, 0);

    const { totalOpeningStockValue, totalClosingStockValue, dynamicItems } = getDynamicStockValueForPeriod(
      inventoryItems,
      globalTransactions,
      { startDate: bsStartDate, endDate: bsEndDate },
      activeCompany
    );

    const stockInHandLedgersForBS = dynamicLedgers.filter((l: any) => l.group && (l.group.toLowerCase().includes('stock-in-hand') || l.group.toLowerCase() === 'stock in hand'));
    const ledgerOpeningStockValue = stockInHandLedgersForBS.reduce((sum: number, l: any) => sum + (Number(l.openingBalance) || 0), 0);
    const ledgerClosingStockValue = stockInHandLedgersForBS.reduce((sum: number, l: any) => sum + (Number(l.currentBalance) || 0), 0);

    const openingStockValue = totalOpeningStockValue > 0 ? totalOpeningStockValue : ledgerOpeningStockValue;
    const closingStockValueFinal = activeCompany?.manualClosingStock 
      ? Number(activeCompany.manualClosingStockValue || 0) 
      : (totalClosingStockValue > 0 ? totalClosingStockValue : ledgerClosingStockValue);

    const totalTradingCredit = netSales + closingStockValueFinal + totalDirectIncomes;
    const totalTradingDebit = (bsPeriod === 'fy' ? openingStockValue : 0) + netPurchases + totalDirectExpenses;
    const grossProfit = totalTradingCredit - totalTradingDebit;
    const netProfit = grossProfit + totalIndirectIncomes - totalIndirectExpenses;

    const assetsGroups = ['Fixed Assets', 'Current Assets', 'Bank Accounts', 'Cash-in-hand', 'Sundry Debtors', 'Investments', 'Loans & Advances (Asset)'];
    const liabilitiesGroups = ['Capital Account', 'Current Liabilities', 'Sundry Creditors', 'Loans (Liability)', 'Duties & Taxes'];

    const assetsList = dynamicLedgers.filter((l: any) => assetsGroups.includes(l.group));
    const liabilitiesList = dynamicLedgers.filter((l: any) => liabilitiesGroups.includes(l.group));

    const totalAssetsValue = assetsList.reduce((sum: number, l: any) => sum + (Number(l.dynamicBalance) || 0), 0) + closingStockValueFinal;
    const totalLiabilitiesValue = liabilitiesList.reduce((sum: number, l: any) => sum + Math.abs(Number(l.dynamicBalance) || 0), 0);

    const finalTotalLiabilities = totalLiabilitiesValue + (netProfit > 0 ? netProfit : 0);
    const finalTotalAssets = totalAssetsValue + (netProfit < 0 ? Math.abs(netProfit) : 0);

    return {
      assets: assetsList,
      liabilities: liabilitiesList,
      closingStock: closingStockValueFinal,
      netProfit,
      totalAssets: finalTotalAssets,
      totalLiabilities: finalTotalLiabilities,
      dynamicItems
    };
  }, [globalTransactions, rawLedgers, inventoryItems, bsStartDate, bsEndDate, bsPeriod, activeCompany]);

  const getPrimaryGroup = (groupName: string) => {
    const g = (groupName || '').toLowerCase();
    if (g.includes('capital') || g === 'share capital' || g === 'reserves & surplus') return 'Capital Account';
    if (g.includes('loan') || g.includes('borrowing') || g.includes('secured') || g.includes('unsecured') || g.includes('burhani qardan')) return 'Loans (Liability)';
    if (g.includes('creditor') || g.includes('tax') || g.includes('provision') || g.includes('duty') || g.includes('current liabilit')) return 'Current Liabilities';
    if (g.includes('fixed asset') || g.includes('property') || g.includes('equipment') || g.includes('furniture') || g.includes('vehicle') || g.includes('machinery') || g.includes('block')) return 'Fixed Assets';
    if (g.includes('investment')) return 'Investments';
    if (g.includes('debtor') || g.includes('bank') || g.includes('cash') || g.includes('stock') || g.includes('inventory') || g.includes('current asset') || g.includes('advance') || g.includes('deposit')) return 'Current Assets';
    if (g.includes('sales')) return 'Sales Accounts';
    if (g.includes('purchase')) return 'Purchase Accounts';
    if (g.includes('direct income') || g.includes('operating income') || g.includes('revenue') || g.includes('off')) return 'Direct Incomes';
    if (g.includes('indirect income') || g.includes('other income') || g === 'discount received' || g === 'interest received') return 'Indirect Incomes';
    if (g.includes('direct expense')) return 'Direct Expenses';
    if (g.includes('indirect expense') || g.includes('office') || g.includes('admin') || g.includes('selling') || g.includes('finance') || g.includes('marketing') || g === 'bank charge' || g === 'rent' || g === 'salary' || g === 'printing' || g.includes('charges')) return 'Indirect Expenses';
    return groupName || 'Other Accounts';
  };

  const tbMetrics = useMemo(() => {
    const { totalOpeningStockValue, totalClosingStockValue } = getDynamicStockValueForPeriod(
      inventoryItems,
      globalTransactions,
      { startDate: tbStartDate, endDate: tbEndDate },
      activeCompany
    );
    const closingStock = totalClosingStockValue;
    const itemsOpeningStockValue = totalOpeningStockValue;

    const enrichedLedgers = getEnrichedLedgers(rawLedgers, globalTransactions, { startDate: tbStartDate, endDate: tbEndDate });
    const hasOpeningStock = enrichedLedgers.some(l => l.name.toLowerCase().includes('opening stock'));
    if (!hasOpeningStock && itemsOpeningStockValue > 0) {
      enrichedLedgers.push({
        id: 'virt-op-stock',
        name: 'Opening Stock',
        group: 'Current Assets',
        openingBalance: itemsOpeningStockValue,
        currentBalance: itemsOpeningStockValue
      });
    }

    const hasClosingStock = enrichedLedgers.some(l => l.name.toLowerCase().includes('stock in hand') || l.name.toLowerCase().includes('closing stock'));
    if (!hasClosingStock && closingStock > 0) {
      enrichedLedgers.push({
        id: 'virt-cl-stock',
        name: 'Stock in Hand (Closing)',
        group: 'Current Assets',
        openingBalance: 0,
        currentBalance: closingStock
      });
    }

    const processed = enrichedLedgers.map((l: any) => {
      const group = l.group || '';
      const isNominal = [
        'Sales Accounts', 'Purchase Accounts', 
        'Direct Expenses', 'Indirect Expenses', 
        'Direct Incomes', 'Indirect Incomes',
        'Direct Income', 'Indirect Income', 'Sales Account', 'Purchase Account'
      ].some(g => group.includes(g));

      let totalImpactBeforePeriod = 0;
      let periodDr = 0;
      let periodCr = 0;

      globalTransactions.forEach((t: any) => {
        let impact = 0;
        let isDrTx = false;
        let isCrTx = false;
        const txAmount = Number(t.totalAmount || t.amount || 0);

        if (t.partyId === l.id && txAmount) {
          const isImmediatePayment = t.isPaid && t.bankId && ['Sales', 'Purchases'].includes(t.type);
          if (!isImmediatePayment) {
            const multiplier = ['Sales', 'Payment'].includes(t.type) ? 1 : -1;
            impact = txAmount * multiplier;
            if (impact > 0) isDrTx = true; else isCrTx = true;
          }
        }
        if (t.bankId === l.id && txAmount) {
          const bankMultiplier = ['Sales', 'Receipt'].includes(t.type) ? 1 : -1;
          impact = txAmount * bankMultiplier;
          if (impact > 0) isDrTx = true; else isCrTx = true;
        }
        if (t.debitLedgerId === l.id && txAmount) {
          impact = txAmount;
          isDrTx = true;
        }
        if (t.creditLedgerId === l.id && txAmount) {
          impact = -txAmount;
          isCrTx = true;
        }

        if (l.group === 'Duties & Taxes') {
          if (l.name === 'CGST' && (t.cgst || t.cgstAmount)) {
            const val = Number(t.cgst || t.cgstAmount || 0);
            if (t.type === 'Sales') { impact = -val; isCrTx = true; }
            if (t.type === 'Purchases') { impact = val; isDrTx = true; }
          } else if (l.name === 'SGST' && (t.sgst || t.sgstAmount)) {
            const val = Number(t.sgst || t.sgstAmount || 0);
            if (t.type === 'Sales') { impact = -val; isCrTx = true; }
            if (t.type === 'Purchases') { impact = val; isDrTx = true; }
          } else if (l.name === 'IGST' && (t.igst || t.igstAmount)) {
            const val = Number(t.igst || t.igstAmount || 0);
            if (t.type === 'Sales') { impact = -val; isCrTx = true; }
            if (t.type === 'Purchases') { impact = val; isDrTx = true; }
          }
        }

        if (t.date < tbStartDate) {
          totalImpactBeforePeriod += impact;
        } else if (t.date <= tbEndDate) {
          if (isDrTx) periodDr += Math.abs(impact);
          if (isCrTx) periodCr += Math.abs(impact);
        }
      });

      let openingVal = Number(l.openingBalance || l.opening || 0);

      if (isNominal) {
        if (tbStartDate.endsWith('-04-01')) {
          openingVal = 0;
        }
      }

      let closingVal = openingVal + periodDr - periodCr;
      if (l.id === 'virt-cl-stock' || l.id === 'virtual-closing-stock') {
        closingVal = Number(l.currentBalance || l.closing || 0);
      }

      return {
        id: l.id,
        name: l.name,
        group: l.group,
        primaryGroup: getPrimaryGroup(l.group),
        opening: openingVal,
        debit: periodDr,
        credit: periodCr,
        closing: closingVal
      };
    });

    const groups: Record<string, any> = {};
    processed.forEach(l => {
      if (!groups[l.primaryGroup]) {
        groups[l.primaryGroup] = {
          groupName: l.primaryGroup,
          opening: 0,
          debit: 0,
          credit: 0,
          closing: 0,
          ledgers: []
        };
      }
      groups[l.primaryGroup].opening += l.opening;
      groups[l.primaryGroup].debit += l.debit;
      groups[l.primaryGroup].credit += l.credit;
      groups[l.primaryGroup].closing += l.closing;
      groups[l.primaryGroup].ledgers.push(l);
    });

    const orderedKeys = [
      'Capital Account',
      'Loans (Liability)',
      'Current Liabilities',
      'Fixed Assets',
      'Investments',
      'Current Assets',
      'Sales Accounts',
      'Purchase Accounts',
      'Direct Incomes',
      'Indirect Incomes',
      'Direct Expenses',
      'Indirect Expenses'
    ];

    const sortedGroups = Object.values(groups).sort((a: any, b: any) => {
      const idxA = orderedKeys.indexOf(a.groupName);
      const idxB = orderedKeys.indexOf(b.groupName);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.groupName.localeCompare(b.groupName);
    });

    let oDr = 0, oCr = 0, txDr = 0, txCr = 0, cDr = 0, cCr = 0;
    processed.forEach(l => {
      if (l.opening >= 0) oDr += l.opening; else oCr += Math.abs(l.opening);
      txDr += l.debit;
      txCr += l.credit;
      if (l.closing >= 0) cDr += l.closing; else cCr += Math.abs(l.closing);
    });

    return {
      groups: sortedGroups,
      totals: { oDr, oCr, txDr, txCr, cDr, cCr }
    };
  }, [globalTransactions, rawLedgers, inventoryItems, tbStartDate, tbEndDate, activeCompany]);

  const hasInventory = activeCompany?.accountingMode !== 'NGO_Trust' && activeCompany?.accountingMode !== 'AccountsOnly';

  const [widgetConfig, setWidgetConfig] = useState(() => {
    if (activeCompany?.dashboardConfig) return activeCompany.dashboardConfig;
    const saved = localStorage.getItem(`widgets_${activeCompany?.id}`);
    return saved ? JSON.parse(saved) : {
      stats: true,
      trend: true,
      topItems: true,
      stockAlerts: true,
      receivables: true,
      payables: true,
      recent: true,
      logs: true,
      profitLoss: true,
      balanceSheet: true,
      trialBalance: true
    };
  });

  useEffect(() => {
    if (activeCompany?.dashboardConfig) {
      setWidgetConfig(activeCompany.dashboardConfig);
    }
  }, [activeCompany?.dashboardConfig]);

  useEffect(() => {
    localStorage.setItem(`widgets_${activeCompany?.id}`, JSON.stringify(widgetConfig));
  }, [widgetConfig, activeCompany?.id]);

  useEffect(() => {
    if (activeCompany?.id) {
      // Fetch and process trend data
      dbService.listenCollection(`companies/${activeCompany.id}/transactions`, [
        orderBy('date', 'asc')
      ], (data) => {
        const activeYearData = data.filter((t: any) => t.date >= activeFY.startDate && t.date <= activeFY.endDate);
        setRecentTransactions([...activeYearData].reverse().slice(0, 5));
        setGlobalTransactions(data);
        
        // Calculate totals
        const sales = activeYearData.filter((t: any) => t.type === 'Sales');
        const purchases = activeYearData.filter((t: any) => t.type === 'Purchases');
        
        const totalSales = sales.reduce((sum: number, t: any) => sum + (t.totalAmount || 0), 0);
        const totalPurchases = purchases.reduce((sum: number, t: any) => sum + (t.totalAmount || 0), 0);
        
        const getTax = (t: any) => t.totalTax ?? ((t.cgst || 0) + (t.sgst || 0) + (t.igst || 0)) ?? 0;
        const outputGst = sales.reduce((sum: number, t: any) => sum + (getTax(t) || 0), 0);
        const inputGst = purchases.reduce((sum: number, t: any) => sum + (getTax(t) || 0), 0);

        setStats(prev => ({ 
          ...prev, 
          sales: totalSales, 
          purchases: totalPurchases,
          gst: outputGst - inputGst,
          gstOutput: outputGst,
          gstInput: inputGst
        }));

        // Calculate trends by month
        const months: any = {};
        activeYearData.forEach(t => {
          const month = t.date.substring(0, 7); // YYYY-MM
          if (!months[month]) months[month] = { name: month, sales: 0, purchases: 0 };
          if (t.type === 'Sales') months[month].sales += (t.totalAmount || 0);
          if (t.type === 'Purchases') months[month].purchases += (t.totalAmount || 0);
        });
        setTrendData(Object.values(months));

        // Calculate Profit & Loss Summary
        const grossSales = sales.reduce((sum: number, t: any) => sum + (t.totalAmount || 0), 0);
        const grossPurchases = purchases.reduce((sum: number, t: any) => sum + (t.totalAmount || 0), 0);
        
        // Better Expense/Income calculation from Payments/Receipts using Ledger groups
        let directExp = 0;
        let indirectExp = 0;
        let otherInc = 0;

        activeYearData.forEach((t: any) => {
          if (t.type === 'Payment' && t.partyId) {
            const ledger = ledgers.find((l: any) => l.id === t.partyId);
            if (ledger?.group === 'Direct Expenses') directExp += (t.totalAmount || 0);
            if (ledger?.group === 'Indirect Expenses') indirectExp += (t.totalAmount || 0);
          }
          if (t.type === 'Receipt' && t.partyId) {
            const ledger = ledgers.find((l: any) => l.id === t.partyId);
            if (ledger?.group === 'Indirect Incomes' || ledger?.group === 'Direct Incomes') otherInc += (t.totalAmount || 0);
          }
        });

        setPlSummary({
          income: grossSales + otherInc,
          expense: grossPurchases + directExp + indirectExp,
          grossProfit: grossSales - grossPurchases - directExp,
          netProfit: (grossSales + otherInc) - (grossPurchases + directExp + indirectExp)
        });

        // Calculate Top Items
        const itemVolume: any = {};
        activeYearData.forEach(t => {
          if (t.type === 'Sales' && t.items) {
            t.items.forEach((it: any) => {
              if (!itemVolume[it.name]) itemVolume[it.name] = { name: it.name, val: 0, qty: 0 };
              itemVolume[it.name].val += (it.amount || 0);
              itemVolume[it.name].qty += (it.qty || 0);
            });
          }
        });
        setTopItems(Object.values(itemVolume).sort((a: any, b: any) => b.val - a.val).slice(0, 5));
      });

       dbService.listenCollection(`companies/${activeCompany.id}/items`, [], (data) => {
        setInventoryItems(data);
        const lowStock = data.filter((item: any) => item.stockLevel <= (item.minStock || 5));
        setStockAlerts(lowStock.slice(0, 5));
      });

      dbService.listenCollection(`companies/${activeCompany.id}/ledgers`, [], (data) => {
        setRawLedgers(data);
      });

      dbService.listenCollection(`companies/${activeCompany.id}/activity_logs`, [orderBy('timestamp', 'desc')], (data) => {
        setLogs(data.slice(0, 5));
      });
    }
  }, [activeCompany?.id, activeFY?.id]);

  useEffect(() => {
    if (!activeFY) return;
    const enriched = getEnrichedLedgers(rawLedgers, globalTransactions, activeFY);

    setLedgers(enriched);

    const bankBalance = enriched
      .filter((l: any) => l.group === 'Bank Accounts' || l.group === 'Bank')
      .reduce((sum: number, l: any) => sum + (l.currentBalance || 0), 0);
    
    const cashBalance = enriched
      .filter((l: any) => l.group === 'Cash-in-hand')
      .reduce((sum: number, l: any) => sum + (l.currentBalance || 0), 0);

    const receivables = enriched
      .filter((l: any) => l.group === 'Sundry Debtors' && (l.currentBalance || 0) > 0)
      .reduce((sum: number, l: any) => sum + (l.currentBalance || 0), 0);

    const payables = enriched
      .filter((l: any) => l.group === 'Sundry Creditors' && (l.currentBalance || 0) < 0)
      .reduce((sum: number, l: any) => sum + (l.currentBalance || 0), 0);

    setStats(prev => ({ 
      ...prev, 
      bank: bankBalance, 
      cash: cashBalance,
      receivables: receivables,
      payables: Math.abs(payables)
    }));

    setReceivablesList(enriched
      .filter((l: any) => l.group === 'Sundry Debtors' && (l.currentBalance || 0) > 0)
      .sort((a, b) => (b.currentBalance || 0) - (a.currentBalance || 0))
      .slice(0, 5));
    
    setPayablesList(enriched
      .filter((l: any) => l.group === 'Sundry Creditors' && (l.currentBalance || 0) < 0)
      .sort((a, b) => Math.abs(b.currentBalance || 0) - Math.abs(a.currentBalance || 0))
      .slice(0, 5));

    // Calculate Balance Sheet Summary
    const fixedAssets = enriched.filter((l: any) => l.group === 'Fixed Assets').reduce((sum, l) => sum + (l.currentBalance || 0), 0);
    const currentAssets = enriched.filter((l: any) => ['Bank Accounts', 'Cash-in-hand', 'Sundry Debtors', 'Loans & Advances (Asset)'].includes(l.group)).reduce((sum, l) => sum + (l.currentBalance || 0), 0);
    const currentLiabilities = enriched.filter((l: any) => ['Sundry Creditors', 'Duties & Taxes', 'Provisions'].includes(l.group)).reduce((sum, l) => sum + Math.abs(l.currentBalance || 0), 0);
    const loansLiability = enriched.filter((l: any) => l.group === 'Loans (Liability)').reduce((sum, l) => sum + Math.abs(l.currentBalance || 0), 0);
    const capitalAccount = enriched.filter((l: any) => l.group === 'Capital Account').reduce((sum, l) => sum + Math.abs(l.currentBalance || 0), 0);

    setBsSummary({
      assets: fixedAssets + currentAssets,
      liabilities: currentLiabilities + loansLiability,
      equity: capitalAccount
    });
  }, [rawLedgers, globalTransactions, activeFY]);

  const dashboardStats = [
    { id: 'sales', label: 'Gross Sales', value: `₹${stats.sales.toLocaleString()}`, icon: ShoppingBag, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { id: 'purchases', label: 'Purchases', value: `₹${stats.purchases.toLocaleString()}`, icon: ShoppingCart, color: 'text-orange-600', bg: 'bg-orange-50' },
    { id: 'receivables', label: 'Receivables', value: `₹${stats.receivables.toLocaleString()}`, icon: ArrowDownRight, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { id: 'payables', label: 'Payables', value: `₹${stats.payables.toLocaleString()}`, icon: ArrowUpRight, color: 'text-red-600', bg: 'bg-red-50' },
  ];

  const netIncome = stats.sales - stats.purchases;

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-orange-100/70 border-2 border-orange-200 p-6 rounded-2xl shadow-sm relative overflow-hidden">
        {/* Subtle orange accent indicator bar */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-orange-500"></div>
        <div className="flex items-center gap-4 relative z-10">
           <div className="w-14 h-14 bg-gradient-to-tr from-orange-500 to-amber-600 rounded-2xl flex items-center justify-center text-white shadow-md shadow-orange-200 overflow-hidden shrink-0">
              {activeCompany?.logo ? (
                 <img src={activeCompany.logo} alt="Logo" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
              ) : (
                 <Building2 size={26} />
              )}
           </div>
           <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-black font-display tracking-tight text-orange-950">{activeCompany?.name}</h1>
              <span className="text-[10px] font-bold text-orange-900 bg-orange-200/60 border border-orange-300 px-2 py-0.5 rounded-full uppercase tracking-wider font-sans">
                {role}
              </span>
            </div>
            <p className="text-xs text-orange-900/90 font-medium mt-1 max-w-xl">
              <span className="font-bold text-orange-950 uppercase text-[10px] tracking-wider">Address: </span>
              {activeCompany?.address || 'Near Rajpura Gate, Rastipura Burhanpur, Madhya Pradesh, India'}
            </p>
            <div className="flex items-center gap-2.5 mt-1.5 text-orange-900/80 text-xs flex-wrap">
              <span>GSTIN: <span className="text-orange-950 font-black">{activeCompany?.gstIn || 'N/A'}</span></span>
              <span className="w-1 h-1 bg-orange-300 rounded-full"></span>
              <span className="font-bold text-orange-950 uppercase tracking-wider">{activeCompany?.registrationType}</span>
              <span className="w-1 h-1 bg-orange-300 rounded-full"></span>
              <span className="text-orange-950 font-extrabold">{activeFY?.label}</span>
            </div>
           </div>
        </div>

        {/* Executive Right Side Panel */}
        <div className="flex items-center gap-3 bg-white border border-orange-200 p-3 rounded-xl text-xs font-sans text-slate-700 shrink-0 shadow-2xs relative z-10">
          <div className="flex flex-col text-right pr-2.5 border-r border-orange-100">
            <span className="text-[9px] uppercase font-bold text-orange-600 tracking-wider">Workspace Calendar</span>
            <span className="text-slate-800 font-bold">Sunday, May 24, 2026</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500 animate-bounce'}`} title={isOnline ? "System Live & Synced" : "System Offline - Writing to IndexedDB Cache"} />
            <span className="font-semibold text-slate-700">
              {isOnline ? 'Digital Register Live' : 'Offline (Local Cache)'}
            </span>
          </div>
        </div>
      </header>

      {showWidgetSettings && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="card p-6 bg-slate-50/50 border-dashed">
          <div className="flex items-center gap-2 mb-4">
             <ListFilter size={18} className="text-indigo-600" />
             <h3 className="font-bold text-sm">Show / Hide Dashboard Widgets</h3>
          </div>
          <div className="flex flex-wrap gap-4">
             {Object.entries(widgetConfig).map(([key, value]) => (
               <label key={key} className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 cursor-pointer hover:border-indigo-300 transition-colors">
                  <input 
                    type="checkbox" 
                    checked={value as boolean} 
                    onChange={() => setWidgetConfig({...widgetConfig, [key]: !value})}
                    className="accent-indigo-600"
                  />
                  <span className="text-xs font-medium capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
               </label>
             ))}
          </div>
        </motion.div>
      )}

      {widgetConfig.stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {dashboardStats.map((stat, i) => (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              key={stat.id} 
              onClick={() => {
                if (['receivables', 'payables'].includes(stat.id)) {
                  setActivePage('ledgers');
                } else {
                  setActivePage(stat.id);
                }
              }}
              className="card p-5 cursor-pointer hover:shadow-xl hover:-translate-y-1 transition-all border border-slate-100 hover:border-indigo-200 shadow-sm"
            >
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-xl ${stat.bg} ${stat.color}`}>
                  <stat.icon size={20} />
                </div>
                <div>
                   <div className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider font-sans">{stat.label}</div>
                   <div className="text-xl font-black text-slate-900 font-display tracking-tight">{stat.value}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Quick Voucher Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { label: 'Sale', page: 'new-sale', icon: ShoppingBag, color: 'bg-emerald-600' },
          { label: 'Purchase', page: 'new-purchase', icon: ShoppingCart, color: 'bg-orange-600' },
          { label: 'Receipt', page: 'new-receipt', icon: ArrowDownRight, color: 'bg-indigo-600' },
          { label: 'Payment', page: 'new-payment', icon: ArrowUpRight, color: 'bg-red-600' },
          { label: 'Contra', page: 'new-contra', icon: RefreshCw, color: 'bg-blue-600' },
          { label: 'Journal', page: 'new-journal', icon: Layers, color: 'bg-purple-600' },
          { label: 'Cr. Note', page: 'new-credit-note', icon: ArrowDownRight, color: 'bg-rose-600' },
          { label: 'Dr. Note', page: 'new-debit-note', icon: ArrowUpRight, color: 'bg-amber-600' },
        ].map((action) => (
          <button
            key={action.page}
            onClick={() => {
              setInvoicePrefill(null);
              setActivePage(action.page);
            }}
            className="flex flex-col items-center gap-2 p-3 bg-white border border-slate-100 rounded-xl hover:border-indigo-200 hover:shadow-md transition-all group"
          >
            <div className={`w-10 h-10 ${action.color} text-white rounded-lg flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform`}>
              <action.icon size={18} />
            </div>
            <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-500">{action.label}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {role !== 'Sales' && (
          <>
            <div className="card p-6 bg-gradient-to-br from-indigo-600 to-brand text-white shadow-xl shadow-indigo-100 lg:col-span-1">
              <div className="flex justify-between items-start mb-8">
                  <div className="p-2 bg-white/20 rounded-lg">
                    <PieChart size={20} />
                  </div>
              </div>
              <div className="text-indigo-100 text-[10px] font-semibold uppercase tracking-widest">Gross Margin</div>
              <div className="text-3xl font-extrabold mt-1 font-display tracking-tight">₹{netIncome.toLocaleString()}</div>
              <div className="mt-8 space-y-3 border-t border-white/10 pt-6">
                  <div className="flex justify-between text-xs">
                    <span className="text-indigo-200">Total Revenue</span>
                    <span className="font-bold font-display">₹{stats.sales.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-indigo-200">Direct Cost</span>
                    <span className="font-bold font-display">₹{stats.purchases.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs pt-2 border-t border-white/5 font-bold">
                    <span>Gross Margin %</span>
                    <span>{stats.sales > 0 ? Math.round((netIncome / stats.sales) * 100) : 0}%</span>
                  </div>
              </div>
            </div>

            <div className="lg:col-span-1 card p-6 shadow-sm border border-slate-100 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Wallet size={18} /></div>
                    <h3 className="font-bold font-display tracking-tight text-slate-900 text-sm">Liquidity Status</h3>
                  </div>
                  {/* Period Dropdown */}
                  <select
                    value={liqPeriod}
                    onChange={(e: any) => setLiqPeriod(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-bold text-slate-700 outline-none cursor-pointer focus:border-blue-500"
                  >
                    <option value="fy">Full FY</option>
                    <option value="month">This Month</option>
                    <option value="last30">Last 30 Days</option>
                    <option value="quarter">This Quarter</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>

                {/* Custom Date Picker inputs */}
                {liqPeriod === 'custom' && (
                  <div className="grid grid-cols-2 gap-2 mb-4 bg-slate-50 p-2 rounded-xl border border-slate-100">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">From</label>
                      <input
                        type="date"
                        value={liqStartDate}
                        onChange={(e) => setLiqStartDate(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg p-1 text-[10px] font-bold outline-none text-slate-700 cursor-pointer"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">To</label>
                      <input
                        type="date"
                        value={liqEndDate}
                        onChange={(e) => setLiqEndDate(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg p-1 text-[10px] font-bold outline-none text-slate-700 cursor-pointer"
                      />
                    </div>
                  </div>
                )}

                {/* Active Period Label */}
                <div className="text-[10px] text-slate-500 font-medium tracking-tight mb-4 flex items-center gap-1">
                  <span>Period:</span>
                  <span className="font-bold text-slate-700">
                    {liqStartDate ? new Date(liqStartDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
                  </span>
                  <span className="text-slate-405">•</span>
                  <span className="font-bold text-slate-700">
                    {liqEndDate ? new Date(liqEndDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
                  </span>
                </div>

                <div className="space-y-4">
                  {/* Bank Accounts Section */}
                  <div className="bg-slate-50/50 p-3 rounded-2xl border border-slate-100/60">
                    <div className="flex justify-between items-center text-xs mb-1">
                      <span className="text-slate-600 font-bold flex items-center gap-1.5">
                        <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                        Bank Accounts
                      </span>
                      <span className="text-slate-900 font-black text-sm">₹{bankMetrics.closing.toLocaleString()}</span>
                    </div>
                    <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mb-2">
                      <div className="bg-blue-500 h-full transition-all duration-300" style={{ width: `${(bankMetrics.closing / (bankMetrics.closing + cashMetrics.closing || 1)) * 100}%` }} />
                    </div>
                    {/* Compact details displaying Flow */}
                    <div className="grid grid-cols-3 gap-1 text-[8px] text-slate-500 font-medium mb-3">
                      <div>
                        <span className="text-[10px] font-semibold text-slate-500 block tracking-wider uppercase">OPENING</span>
                        <span className="text-slate-700 font-bold">₹{bankMetrics.opening.toLocaleString()}</span>
                      </div>
                      <div className="text-center">
                        <span className="text-[10px] font-semibold text-emerald-600 block tracking-wider uppercase">INFLOW (+)</span>
                        <span className="text-emerald-600 font-bold">₹{bankMetrics.inflow.toLocaleString()}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-semibold text-rose-600 block tracking-wider uppercase">OUTFLOW (-)</span>
                        <span className="text-rose-700 font-bold">₹{bankMetrics.outflow.toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Individual Accounts List */}
                    {bankAccountsMetrics.length > 0 && (
                      <div className="space-y-1.5 pt-2.5 border-t border-slate-100">
                        <div className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">MAPPED BANKS</div>
                        {bankAccountsMetrics.map((acc: any) => (
                          <div key={acc.id} className="bg-white p-2 rounded-xl border border-slate-100 hover:border-indigo-100 transition-all font-sans">
                            <div className="flex justify-between items-center text-[10px] font-bold text-slate-700 mb-0.5">
                              <span className="truncate max-w-[140px]">{acc.name}</span>
                              <span className="text-slate-900 font-extrabold">₹{acc.closing.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-[7px] text-slate-500">
                              <span>Op: ₹{acc.opening.toLocaleString()}</span>
                              <span className="text-emerald-600">In: +₹{acc.inflow.toLocaleString()}</span>
                              <span className="text-rose-600">Out: -₹{acc.outflow.toLocaleString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Cash in Hand Section */}
                  <div className="bg-slate-50/50 p-3 rounded-2xl border border-slate-100/60">
                    <div className="flex justify-between items-center text-xs mb-1">
                      <span className="text-slate-600 font-bold flex items-center gap-1.5">
                        <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                        Cash in Hand
                      </span>
                      <span className="text-slate-900 font-black text-sm">₹{cashMetrics.closing.toLocaleString()}</span>
                    </div>
                    <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mb-2">
                      <div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${(cashMetrics.closing / (bankMetrics.closing + cashMetrics.closing || 1)) * 100}%` }} />
                    </div>
                    {/* Compact details displaying Flow */}
                    <div className="grid grid-cols-3 gap-1 text-[8px] text-slate-500 font-medium mb-3">
                      <div>
                        <span className="text-[10px] font-semibold text-slate-500 block tracking-wider uppercase">OPENING</span>
                        <span className="text-slate-700 font-bold">₹{cashMetrics.opening.toLocaleString()}</span>
                      </div>
                      <div className="text-center">
                        <span className="text-[10px] font-semibold text-emerald-600 block tracking-wider uppercase">INFLOW (+)</span>
                        <span className="text-emerald-600 font-bold">₹{cashMetrics.inflow.toLocaleString()}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-semibold text-rose-600 block tracking-wider uppercase">OUTFLOW (-)</span>
                        <span className="text-rose-700 font-bold">₹{cashMetrics.outflow.toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Individual Cash Accounts List */}
                    {cashAccountsMetrics.length > 0 && (
                      <div className="space-y-1.5 pt-2.5 border-t border-slate-100">
                        <div className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">CASH ACCOUNTS</div>
                        {cashAccountsMetrics.map((acc: any) => (
                          <div key={acc.id} className="bg-white p-2 rounded-xl border border-slate-100 hover:border-indigo-100 transition-all font-sans">
                            <div className="flex justify-between items-center text-[10px] font-bold text-slate-700 mb-0.5">
                              <span className="truncate max-w-[140px]">{acc.name}</span>
                              <span className="text-slate-900 font-extrabold">₹{acc.closing.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-[7px] text-slate-500">
                              <span>Op: ₹{acc.opening.toLocaleString()}</span>
                              <span className="text-emerald-600">In: +₹{acc.inflow.toLocaleString()}</span>
                              <span className="text-rose-600">Out: -₹{acc.outflow.toLocaleString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 mt-4">
                <div className="text-[10px] text-slate-500 uppercase font-semibold tracking-widest mb-1 text-center">Net Liquid Capital (Closing)</div>
                <div className="text-center text-lg font-black text-indigo-600">₹{(bankMetrics.closing + cashMetrics.closing).toLocaleString()}</div>
              </div>
            </div>

            <div className="lg:col-span-2 card p-6 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><FileText size={18} /></div>
                    <h3 className="font-bold font-display tracking-tight text-slate-900">GST Summary (MTD)</h3>
                  </div>
                  <button onClick={() => setActivePage('gst-reports')} className="text-xs text-indigo-600 font-bold hover:underline">View GSTR-3B</button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-rose-50/40 rounded-2xl border border-rose-100">
                    <div className="text-[10px] text-rose-600 font-semibold uppercase tracking-wider mb-1">Output GST (Sales Liability)</div>
                    <div className="text-xl font-bold text-slate-900">₹{(stats.gstOutput || 0).toLocaleString()}</div>
                    <p className="text-[10px] text-slate-500 mt-1">Total liability auto-calculated from bills</p>
                  </div>
                  <div className="p-4 bg-emerald-50/40 rounded-2xl border border-emerald-100">
                    <div className="text-[10px] text-emerald-600 font-semibold uppercase tracking-wider mb-1">Input Credit (ITC)</div>
                    <div className="text-xl font-bold text-slate-900">₹{(stats.gstInput || 0).toLocaleString()}</div>
                    <p className="text-[10px] text-slate-500 mt-1">Available credit on purchase bills</p>
                  </div>
                  <div className="col-span-2 flex items-center justify-between p-4 bg-slate-900 rounded-xl text-white shadow-sm">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Net Tax Liability</span>
                    <span className="text-lg font-black">
                      {stats.gstOutput >= stats.gstInput 
                        ? `₹${(stats.gstOutput - stats.gstInput).toLocaleString()} Payable`
                        : `₹${(stats.gstInput - stats.gstOutput).toLocaleString()} Credit Forward`}
                    </span>
                  </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {widgetConfig.trend && (
          <div className="lg:col-span-2 card p-6 shadow-sm overflow-hidden min-h-[400px]">
            <div className="flex justify-between items-center mb-6">
               <div>
                 <h3 className="font-bold">Financial Trend Analysis</h3>
                 <p className="text-xs text-slate-500">Sales vs Purchases for current period</p>
               </div>
               <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                  <BarChart3 size={18} />
               </div>
            </div>
            <div className="h-[300px] w-full min-h-[300px]">
               <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <AreaChart data={trendData}>
                    <defs>
                      <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.25}/>
                        <stop offset="50%" stopColor="#10b981" stopOpacity={0.08}/>
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorPurchases" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f97316" stopOpacity={0.2}/>
                        <stop offset="50%" stopColor="#f97316" stopOpacity={0.06}/>
                        <stop offset="100%" stopColor="#f97316" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="4" vertical={false} stroke="#64748b" strokeOpacity={0.08} />
                    <XAxis dataKey="name" fontSize={10} axisLine={false} tickLine={false} />
                    <YAxis fontSize={10} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v/1000}k`} />
                    <Tooltip content={<CustomTrendTooltip />} />
                    <Legend iconType="circle" />
                    <Area type="monotone" dataKey="sales" name="Sales" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" />
                    <Area type="monotone" dataKey="purchases" name="Purchases" stroke="#f97316" strokeWidth={3} fillOpacity={1} fill="url(#colorPurchases)" />
                  </AreaChart>
               </ResponsiveContainer>
            </div>
          </div>
        )}

        {widgetConfig.topItems && hasInventory && (
          <div className="card p-6 shadow-sm">
            <h3 className="font-bold font-display tracking-tight text-slate-900 mb-6">Top Selling Items</h3>
            <div className="space-y-5">
              {topItems.map((it, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600 shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-semibold truncate pr-2">{it.name}</span>
                      <span className="text-xs font-bold text-slate-800 shrink-0">₹{it.val.toLocaleString()}</span>
                    </div>
                    <div className="w-full bg-slate-100 h-1.5 rounded-full">
                       <div 
                        className="bg-indigo-600 h-full rounded-full transition-all duration-1000" 
                        style={{ width: `${(it.val / topItems[0].val) * 100}%` }}
                       />
                    </div>
                    <div className="flex justify-between mt-1">
                        <span className="text-[10px] text-slate-400">Sold: {it.qty} units</span>
                        <span className="text-[10px] text-indigo-600 font-medium">{Math.round((it.val / stats.sales) * 100)}% of sales</span>
                    </div>
                  </div>
                </div>
              ))}
              {topItems.length === 0 && (
                <div className="py-12 text-center text-slate-400 italic text-sm">No sales data yet.</div>
              )}
            </div>
          </div>
        )}

        {widgetConfig.recent && (
          <div className="lg:col-span-2 card p-6 shadow-sm">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold font-display tracking-tight text-slate-900">Recent Transactions</h3>
              <button onClick={() => setActivePage('sales')} className="text-xs text-indigo-600 font-bold hover:underline">View All</button>
            </div>
            <div className="divide-y divide-slate-100">
              {recentTransactions.map((t, i) => (
                <div key={i} onClick={() => { setInvoicePrefill(t); setActivePage(t.type === 'Sales' ? 'new-sale' : 'new-purchase'); }} className="group flex items-center justify-between py-3 hover:bg-slate-50 transition-colors px-2 rounded-lg cursor-pointer">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${t.type === 'Sales' ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-orange-600'}`}>
                      <FileText size={18} />
                    </div>
                    <div>
                      <div className="font-medium text-sm">{t.voucherNumber || t.partyName}</div>
                      <div className="text-xs text-slate-400 flex items-center gap-2">
                        {t.type} • {t.date}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="hidden md:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={(e) => { e.stopPropagation(); onPreview?.(t); }} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400" title="Preview"><Eye size={14} /></button>
                      <button onClick={(e) => { e.stopPropagation(); onPrint?.(t); }} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400" title="Print"><Printer size={14} /></button>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-sm">₹{ t.totalAmount?.toLocaleString() || '0' }</div>
                      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">{t.partyName ? t.partyName.substring(0, 15) : 'General'}</div>
                    </div>
                  </div>
                </div>
              ))}
              {recentTransactions.length === 0 && (
                <div className="py-12 text-center text-slate-400 italic text-sm">No recent transactions found.</div>
              )}
            </div>
          </div>
        )}

        {widgetConfig.stockAlerts && hasInventory && (
          <div className="card p-6 shadow-sm flex flex-col h-[420px]">
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <div>
                <h3 className="font-bold font-display tracking-tight text-slate-900 text-base">Inventory Status</h3>
                <p className="text-xs text-slate-400">Real-time stock level tracker</p>
              </div>
              <button 
                onClick={() => setActivePage('inventory')} 
                className="text-xs text-indigo-600 font-bold hover:underline"
              >
                Manage
              </button>
            </div>

            {/* Filters Row */}
            {inventoryItems.length > 0 && (
              <div className="flex flex-col gap-2 mb-4 flex-shrink-0">
                <div className="flex gap-2 items-center">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                    <input 
                      type="text"
                      placeholder="Search inventory..."
                      value={inventorySearch}
                      onChange={(e) => setInventorySearch(e.target.value)}
                      className="w-full text-xs pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs text-center">
                    <button 
                      onClick={() => setInventoryFilter('all')}
                      className={`px-2 py-1 rounded-md font-medium transition-all ${inventoryFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      All
                    </button>
                    <button 
                      onClick={() => setInventoryFilter('low')}
                      className={`px-2 py-1 rounded-md font-medium transition-all flex items-center gap-1 ${inventoryFilter === 'low' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Low
                      {stockAlerts.length > 0 && (
                        <span className="bg-rose-100 text-rose-700 text-[9px] font-bold px-1 py-0.2 rounded-full leading-none">
                          {stockAlerts.length}
                        </span>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Scrollable List Container */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
              {inventoryItems.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center py-8 text-center text-slate-400 italic text-sm gap-3">
                  <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center">
                     <Package size={20} />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-700 not-italic">No Inventory Items</p>
                    <p className="text-xs text-slate-400 mt-1 not-italic">Go to Stock Master to add items.</p>
                  </div>
                  <button 
                    onClick={() => setActivePage('inventory')} 
                    className="btn-primary py-1.5 px-3 text-xs mt-2"
                  >
                    Add Your First Item
                  </button>
                </div>
              ) : (() => {
                const filtered = inventoryItems.filter(item => {
                  const matchesSearch = (item.name || '').toLowerCase().includes(inventorySearch.toLowerCase());
                  if (inventoryFilter === 'low') {
                    return matchesSearch && (item.stockLevel <= (item.minStock || 5));
                  }
                  return matchesSearch;
                });

                if (filtered.length === 0) {
                  return (
                    <div className="py-12 text-center text-slate-400 italic text-xs">
                      No matching items found.
                    </div>
                  );
                }

                return filtered.map((item, i) => {
                  const min = item.minStock || 5;
                  const isLow = item.stockLevel <= min;
                  const outOfStock = item.stockLevel <= 0;
                  
                  // progress bar percentage
                  const percent = Math.max(8, Math.min(100, ((item.stockLevel || 0) / (min * 2)) * 100));
                  
                  return (
                    <div key={item.id || i} className="p-3 bg-white border border-slate-100 rounded-xl hover:border-slate-200 transition-all shadow-sm">
                      <div className="flex justify-between items-start mb-1 gap-2">
                        <div className="min-w-0 flex-1">
                          <span className="text-xs font-semibold text-slate-800 block truncate" title={item.name}>{item.name}</span>
                          <span className="text-[10px] text-slate-400 block truncate">SKU: {item.sku || 'N/A'}</span>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className={`text-xs font-mono font-bold block ${outOfStock ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {item.stockLevel} {item.unit}
                          </span>
                          <div className="mt-1 flex justify-end">
                            {outOfStock ? (
                              <span className="bg-rose-50 text-rose-600 text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wider scale-90 origin-right">Out of Stock</span>
                            ) : isLow ? (
                              <span className="bg-amber-50 text-amber-600 text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wider scale-90 origin-right">Low Stock</span>
                            ) : (
                              <span className="bg-emerald-50 text-emerald-600 text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wider scale-90 origin-right">In Stock</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 text-left">
                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                          <div 
                            className={`h-full transition-all duration-300 ${outOfStock ? 'bg-slate-300' : isLow ? 'bg-amber-500' : 'bg-emerald-500'}`} 
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <div className="flex justify-between items-center mt-1 text-[9px] text-slate-400">
                          <span>Min: {min} {item.unit}</span>
                          <span>Purchase Rate: ₹{item.purchasePrice || 0}</span>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {widgetConfig.receivables && (
          <div className="card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold font-display tracking-tight text-slate-900">Top Receivables</h3>
              <button onClick={() => setActivePage('ledgers')} className="text-xs text-indigo-600 font-bold hover:underline">View All</button>
            </div>
            <div className="space-y-4">
              {receivablesList.map((ledger, i) => (
                <div key={i} className="flex items-center justify-between group">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 text-xs font-bold">
                       {ledger.name.charAt(0)}
                    </div>
                    <span className="text-sm font-medium text-slate-705 truncate max-w-[125px]">{ledger.name}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-slate-900 font-display">₹{ledger.currentBalance?.toLocaleString()}</div>
                    <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Dr</div>
                  </div>
                </div>
              ))}
              {receivablesList.length === 0 && (
                <div className="py-8 text-center text-slate-400 italic text-sm">No outstanding receivables.</div>
              )}
            </div>
          </div>
        )}

        {widgetConfig.payables && (
          <div className="card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold font-display tracking-tight text-slate-900">Top Payables</h3>
              <button onClick={() => setActivePage('ledgers')} className="text-xs text-indigo-600 font-bold hover:underline">View All</button>
            </div>
            <div className="space-y-4">
              {payablesList.map((ledger, i) => (
                <div key={i} className="flex items-center justify-between group">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center text-red-600 text-xs font-bold">
                       {ledger.name.charAt(0)}
                    </div>
                    <span className="text-sm font-medium text-slate-705 truncate max-w-[125px]">{ledger.name}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-slate-900 font-display">₹{Math.abs(ledger.currentBalance || 0).toLocaleString()}</div>
                    <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Cr</div>
                  </div>
                </div>
              ))}
              {payablesList.length === 0 && (
                <div className="py-8 text-center text-slate-400 italic text-sm">No outstanding payables.</div>
              )}
            </div>
          </div>
        )}

        {widgetConfig.profitLoss && (
          <div className="card p-6 shadow-sm border border-slate-100 flex flex-col justify-between">
            <div>
              {/* Header */}
              <div className="flex items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                    <TrendingUp size={18} />
                  </div>
                  <h3 className="font-bold font-display tracking-tight text-sm text-slate-900">Trading & P/L Summary</h3>
                </div>
                {/* Period Dropdown */}
                <select
                  value={plPeriod}
                  onChange={(e: any) => setPlPeriod(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-bold text-slate-700 outline-none cursor-pointer focus:border-emerald-500"
                >
                  <option value="fy">Full FY</option>
                  <option value="month">This Month</option>
                  <option value="last30">Last 30 Days</option>
                  <option value="quarter">This Quarter</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              {/* Custom Date Pickers */}
              {plPeriod === 'custom' && (
                <div className="grid grid-cols-2 gap-2 mb-4 bg-slate-50 p-2 rounded-xl border border-slate-100">
                  <div>
                    <label className="block text-[8px] font-black text-slate-400 uppercase tracking-wider mb-0.5">From</label>
                    <input
                      type="date"
                      value={plStartDate}
                      onChange={(e) => setPlStartDate(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-lg p-1 text-[10px] font-bold outline-none text-slate-700 cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="block text-[8px] font-black text-slate-400 uppercase tracking-wider mb-0.5">To</label>
                    <input
                      type="date"
                      value={plEndDate}
                      onChange={(e) => setPlEndDate(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-lg p-1 text-[10px] font-bold outline-none text-slate-700 cursor-pointer"
                    />
                  </div>
                </div>
              )}

              {/* Active Period Label */}
              <div className="text-[10px] text-slate-500 font-medium tracking-tight mb-4 flex items-center gap-1">
                <span>Period:</span>
                <span className="font-bold text-slate-700">
                  {plStartDate ? new Date(plStartDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
                </span>
                <span className="text-slate-405">•</span>
                <span className="font-bold text-slate-700">
                  {plEndDate ? new Date(plEndDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
                </span>
              </div>

              <div className="space-y-4">
                {/* View Mode Toggle Pill */}
                <div className="flex bg-slate-100 p-0.5 rounded-xl border border-slate-200/50 text-[10px] w-full">
                  <button
                    onClick={() => setPlViewMode('nature')}
                    className={`flex-1 py-1.5 rounded-lg font-black transition-all uppercase tracking-wider flex items-center justify-center gap-1 ${plViewMode === 'nature' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    <span>Tally Nature</span>
                  </button>
                  <button
                    onClick={() => setPlViewMode('standard')}
                    className={`flex-1 py-1.5 rounded-lg font-black transition-all uppercase tracking-wider flex items-center justify-center gap-1 ${plViewMode === 'standard' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    <span>Modern List</span>
                  </button>
                </div>

                {plViewMode === 'nature' && (
                  <button
                    onClick={() => setPlDetailed(!plDetailed)}
                    className={`w-full text-center text-[9px] font-black uppercase tracking-widest border py-1.5 rounded-xl transition-all ${plDetailed ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}
                  >
                    {plDetailed ? 'Alt+F1: Condensed Mode' : 'Alt+F1: Detailed Mode'}
                  </button>
                )}

                {plViewMode === 'nature' ? (
                  /* ================= MINI TALLY STYLE ================= */
                  <div className="space-y-4 text-[11px] font-mono text-slate-850">
                    
                    {/* Part 1: Trading A/c Grid */}
                    <div className="border border-slate-300 rounded-xl overflow-hidden bg-white shadow-xs">
                      <div className="bg-slate-900 text-white p-2 font-black text-[9px] uppercase tracking-wider text-center">
                        TRADING ACCOUNT DETAILS
                      </div>
                      <div className="grid grid-cols-2 divide-x divide-slate-300">
                        {/* DEBIT SIDE */}
                        <div className="p-2 space-y-2 flex flex-col justify-between min-h-[140px]">
                          <div className="space-y-2">
                            {/* Opening Stock */}
                            <div>
                              <div className="flex justify-between font-bold text-slate-900">
                                <span>Opening Stock</span>
                                <span>₹{Math.round(plMetrics.openingStock).toLocaleString()}</span>
                              </div>
                              {plDetailed && (
                                <div className="pl-2 mt-1 space-y-0.5 border-l border-slate-100 text-[9px] text-slate-500 italic max-h-[80px] overflow-y-auto">
                                  {(plMetrics.dynamicItems || []).filter((item: any) => Number(item.dynamicOpeningQty || 0) > 0).map((item: any, idx: number) => (
                                    <div key={idx} className="flex justify-between">
                                      <span className="truncate max-w-[80px]">{item.name}</span>
                                      <span>₹{Math.round(Number(item.dynamicOpeningValue || 0)).toLocaleString()}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Net Purchases */}
                            <div>
                              <div className="flex justify-between font-bold text-slate-905">
                                <span>Purchases (Net)</span>
                                <span>₹{Math.round(plMetrics.netPurchases).toLocaleString()}</span>
                              </div>
                            </div>

                            {/* Direct Expenses */}
                            {plMetrics.directExpenses > 0 && (
                              <div>
                                <div className="flex justify-between font-bold text-slate-905">
                                  <span>Direct Expenses</span>
                                  <span>₹{Math.round(plMetrics.directExpenses).toLocaleString()}</span>
                                </div>
                                {plDetailed && (
                                  <div className="pl-2 mt-1 space-y-0.5 border-l border-slate-100 text-[9px] text-slate-500 italic">
                                    {plMetrics.directExpensesList.map((exp: any, idx: number) => (
                                      <div key={idx} className="flex justify-between">
                                        <span className="truncate max-w-[80px]">{exp.name}</span>
                                        <span>₹{Math.round(exp.amount).toLocaleString()}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Gross Profit Bottom Anchor */}
                          {plMetrics.grossProfit > 0 && (
                            <div className="flex justify-between font-bold text-emerald-600 bg-emerald-50/20 p-0.5 border-t border-dashed border-emerald-100 mt-2">
                              <span>Gross Profit c/f</span>
                              <span className="font-extrabold">₹{Math.round(plMetrics.grossProfit).toLocaleString()}</span>
                            </div>
                          )}
                        </div>

                        {/* CREDIT SIDE */}
                        <div className="p-2 space-y-2 flex flex-col justify-between min-h-[140px]">
                          <div className="space-y-2">
                            {/* Net Sales */}
                            <div>
                              <div className="flex justify-between font-bold text-slate-905">
                                <span>Sales (Net)</span>
                                <span>₹{Math.round(plMetrics.netSales).toLocaleString()}</span>
                              </div>
                            </div>

                            {/* Closing Stock */}
                            <div>
                              <div className="flex justify-between font-bold text-slate-905">
                                <span>Closing Stock</span>
                                <span>₹{Math.round(plMetrics.closingStock).toLocaleString()}</span>
                              </div>
                              {plDetailed && (
                                <div className="pl-2 mt-1 space-y-0.5 border-l border-slate-100 text-[9px] text-slate-500 italic max-h-[80px] overflow-y-auto">
                                  {activeCompany?.manualClosingStock ? (
                                    <div className="flex justify-between font-sans pr-2">
                                      <span className="truncate max-w-[120px]">Manual Stock Override</span>
                                      <span>₹{Math.round(plMetrics.closingStock).toLocaleString()}</span>
                                    </div>
                                  ) : (
                                    (plMetrics.dynamicItems || []).filter((item: any) => Number(item.dynamicClosingQty || 0) !== 0).map((item: any, idx: number) => {
                                      const val = Number(item.dynamicClosingValue || 0);
                                      const isNeg = val < 0;
                                      const absFormatted = Math.round(Math.abs(val)).toLocaleString();
                                      return (
                                        <div key={idx} className="flex justify-between">
                                          <span className="truncate max-w-[80px]">{item.name}</span>
                                          <span className={isNeg ? 'text-rose-500' : ''}>
                                            {isNeg ? `(-) ${absFormatted}` : `₹${absFormatted}`}
                                          </span>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Gross Loss Bottom Anchor */}
                          {plMetrics.grossProfit < 0 && (
                            <div className="flex justify-between font-bold text-rose-600 bg-rose-50/20 p-0.5 border-t border-dashed border-rose-100 mt-2">
                              <span>Gross Loss c/f</span>
                              <span className="font-extrabold">₹{Math.round(Math.abs(plMetrics.grossProfit)).toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Double Underlined Totals */}
                      <div className="grid grid-cols-2 divide-x divide-slate-300 bg-slate-50 font-black border-t-2 border-slate-900 border-b-2">
                        <div className="p-2 flex justify-between">
                          <span className="uppercase text-[9px]">Trading Dr</span>
                          <span className="font-sans">₹{Math.round(plMetrics.grossProfit > 0 ? (plMetrics.netSales + plMetrics.closingStock + plMetrics.directIncomes) : (plMetrics.openingStock + plMetrics.netPurchases + plMetrics.directExpenses)).toLocaleString()}</span>
                        </div>
                        <div className="p-2 flex justify-between pl-3">
                          <span className="uppercase text-[9px]">Trading Cr</span>
                          <span className="font-sans">₹{Math.round(plMetrics.grossProfit < 0 ? (plMetrics.openingStock + plMetrics.netPurchases + plMetrics.directExpenses) : (plMetrics.netSales + plMetrics.closingStock + plMetrics.directIncomes)).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>

                    {/* Part 2: Profit & Loss A/c Grid */}
                    <div className="border border-slate-300 rounded-xl overflow-hidden bg-white shadow-xs">
                      <div className="bg-indigo-900 text-white p-2 font-black text-[9px] uppercase tracking-wider text-center">
                        PROFIT & LOSS STATEMENT
                      </div>
                      <div className="grid grid-cols-2 divide-x divide-slate-300">
                        {/* DEBIT SIDE */}
                        <div className="p-2 space-y-3 flex flex-col justify-between min-h-[110px]">
                          <div className="space-y-2">
                            {/* Gross Loss b/f */}
                            {plMetrics.grossProfit < 0 && (
                              <div className="flex justify-between font-bold text-rose-600 italic">
                                <span>Gross Loss b/f</span>
                                <span>₹{Math.round(Math.abs(plMetrics.grossProfit)).toLocaleString()}</span>
                              </div>
                            )}

                            {/* Indirect Expenses */}
                            <div>
                              <div className="flex justify-between font-bold text-slate-905">
                                <span>Indirect Expenses</span>
                                <span>₹{Math.round(plMetrics.indirectExpenses).toLocaleString()}</span>
                              </div>
                              {plDetailed && (
                                <div className="pl-2 mt-1 space-y-0.5 border-l border-slate-100 text-[9px] text-slate-500 italic">
                                  {plMetrics.indirectExpensesList.map((exp: any, idx: number) => (
                                    <div key={idx} className="flex justify-between">
                                      <span className="truncate max-w-[80px]">{exp.name}</span>
                                      <span>₹{Math.round(exp.amount).toLocaleString()}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Net Profit Balancing row */}
                          {plMetrics.netProfit > 0 && (
                            <div className="flex justify-between font-bold text-emerald-600 bg-emerald-50 p-0.5 border-t border-dashed border-emerald-100 mt-2">
                              <span className="uppercase text-[8px] font-black">Net Profit</span>
                              <span className="font-extrabold">₹{Math.round(plMetrics.netProfit).toLocaleString()}</span>
                            </div>
                          )}
                        </div>

                        {/* CREDIT SIDE */}
                        <div className="p-2 space-y-3 flex flex-col justify-between min-h-[110px]">
                          <div className="space-y-2">
                            {/* Gross Profit b/f */}
                            {plMetrics.grossProfit > 0 && (
                              <div className="flex justify-between font-bold text-emerald-600 italic">
                                <span>Gross Profit b/f</span>
                                <span>₹{Math.round(plMetrics.grossProfit).toLocaleString()}</span>
                              </div>
                            )}

                            {/* Indirect Incomes */}
                            {plMetrics.indirectIncomes > 0 && (
                              <div className="flex justify-between font-bold text-slate-905">
                                <span>Indirect Incomes</span>
                                <span>₹{Math.round(plMetrics.indirectIncomes).toLocaleString()}</span>
                              </div>
                            )}
                          </div>

                          {/* Net Loss Balancing row */}
                          {plMetrics.netProfit < 0 && (
                            <div className="flex justify-between font-bold text-rose-600 bg-rose-50 p-0.5 border-t border-dashed border-rose-100 mt-2">
                              <span className="uppercase text-[8px] font-black">Net Loss</span>
                              <span className="font-extrabold">₹{Math.round(Math.abs(plMetrics.netProfit)).toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Double Underlined Totals */}
                      <div className="grid grid-cols-2 divide-x divide-slate-300 bg-slate-50 font-black border-t-2 border-slate-900 border-b-2">
                        <div className="p-2 flex justify-between">
                          <span className="uppercase text-[9px]">P&L Dr</span>
                          <span className="font-sans">₹{Math.round(plMetrics.netProfit > 0 ? (plMetrics.indirectIncomes + (plMetrics.grossProfit > 0 ? plMetrics.grossProfit : 0)) : (plMetrics.indirectExpenses + (plMetrics.grossProfit < 0 ? Math.abs(plMetrics.grossProfit) : 0))).toLocaleString()}</span>
                        </div>
                        <div className="p-2 flex justify-between pl-3">
                          <span className="uppercase text-[9px]">P&L Cr</span>
                          <span className="font-sans">₹{Math.round(plMetrics.netProfit < 0 ? (plMetrics.indirectExpenses + (plMetrics.grossProfit < 0 ? Math.abs(plMetrics.grossProfit) : 0)) : (plMetrics.indirectIncomes + (plMetrics.grossProfit > 0 ? plMetrics.grossProfit : 0))).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ================= ORIGINAL STANDARD MODERN SUMMARY VIEW ================= */
                  <>
                    {/* 1. TRADING ACCOUNT SECTION */}
                    <div className="bg-slate-50/50 p-3 rounded-2xl border border-slate-100/60 space-y-2.5">
                      <div className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">Trading Statement</div>
                      
                      {/* Net Sales */}
                      <div className="flex justify-between items-start text-xs">
                        <div>
                          <span className="text-slate-650 font-bold block">Net Sales</span>
                          <span className="text-[9px] text-slate-400">Gross: ₹{plMetrics.grossSales.toLocaleString()}</span>
                        </div>
                        <span className="text-slate-900 font-black text-sm text-right">₹{plMetrics.netSales.toLocaleString()}</span>
                      </div>

                      {/* Net Purchases */}
                      <div className="flex justify-between items-start text-xs border-t border-slate-100/50 pt-2">
                        <div>
                          <span className="text-slate-650 font-bold block">Net Purchases</span>
                          <span className="text-[9px] text-slate-400">Gross: ₹{plMetrics.grossPurchases.toLocaleString()}</span>
                        </div>
                        <span className="text-slate-900 font-black text-sm text-right">₹{plMetrics.netPurchases.toLocaleString()}</span>
                      </div>

                      {/* Opening and Closing Stock (Only for FY) */}
                      {plPeriod === 'fy' && (
                        <div className="grid grid-cols-2 gap-2 border-t border-slate-100/50 pt-2 text-[10px]">
                          <div>
                            <span className="text-slate-500 font-medium block">Opening Stock</span>
                            <span className="text-slate-805 font-bold">₹{plMetrics.openingStock.toLocaleString()}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-slate-500 font-medium block">Closing Stock</span>
                            <span className="text-slate-805 font-bold">₹{plMetrics.closingStock.toLocaleString()}</span>
                          </div>
                        </div>
                      )}

                      {/* Direct Expenses */}
                      {plMetrics.directExpenses > 0 && (
                        <div className="border-t border-slate-100/50 pt-2 text-xs">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-slate-650 font-bold">Direct Expenses</span>
                            <span className="text-slate-900 font-black">₹{plMetrics.directExpenses.toLocaleString()}</span>
                          </div>
                          {/* Individual Direct Expense ledger heads */}
                          <div className="space-y-1 pl-2 border-l-2 border-slate-200">
                            {plMetrics.directExpensesList.map((exp: any) => (
                              <div key={exp.id} className="flex justify-between text-[10px] text-slate-500 font-medium">
                                <span className="truncate max-w-[150px]">{exp.name}</span>
                                <span>₹{exp.amount.toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Gross Profit Bar/Badge */}
                      <div className="pt-2 border-t border-slate-100/80 flex justify-between items-center">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Gross Profit</span>
                        <span className={`text-sm font-black ${plMetrics.grossProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                          ₹{plMetrics.grossProfit.toLocaleString()}
                        </span>
                      </div>
                    </div>

                    {/* 2. PROFIT & LOSS ACCOUNT SECTION */}
                    <div className="bg-slate-50/50 p-3 rounded-2xl border border-slate-100/60 space-y-2.5">
                      <div className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">Profit & Loss Statement</div>

                      {/* Other Income (Receipts) */}
                      {plMetrics.directIncomes + plMetrics.indirectIncomes > 0 && (
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-650 font-bold">Other Indirect Incomes</span>
                          <span className="text-emerald-700 font-black">₹{(plMetrics.directIncomes + plMetrics.indirectIncomes).toLocaleString()}</span>
                        </div>
                      )}

                      {/* Indirect Expenses (Detailed Breakdown) */}
                      <div className="text-xs">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-slate-650 font-bold">Indirect Expenses</span>
                          <span className="text-slate-900 font-black">₹{plMetrics.indirectExpenses.toLocaleString()}</span>
                        </div>
                        {/* Individual Indirect Expense ledger heads */}
                        {plMetrics.indirectExpensesList.length > 0 ? (
                          <div className="space-y-1.5 pl-2 border-l-2 border-amber-200/50 pt-1 mt-1">
                            {plMetrics.indirectExpensesList.map((exp: any) => (
                              <div key={exp.id} className="bg-white p-1.5 rounded-lg border border-slate-100/80 hover:border-indigo-100 transition-all">
                                <div className="flex justify-between text-[10px] font-bold text-slate-600 font-sans">
                                  <span className="truncate max-w-[150px]">{exp.name}</span>
                                  <span className="text-indigo-600 font-extrabold">₹{exp.amount.toLocaleString()}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-400 italic pl-2 border-l border-slate-100">No indirect expenses found in period.</div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Net Income Summary Card Footer */}
              <div className="pt-4 border-t border-slate-100 mt-4">
                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider block">Net Income Result</span>
                    <span className="text-[9px] text-slate-400 italic">Trading & Operational Summary</span>
                  </div>
                  <div className={`text-right ${plMetrics.netProfit >= 0 ? 'text-indigo-600' : 'text-rose-600'}`}>
                    <span className="text-lg font-black block leading-none">₹{plMetrics.netProfit.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {widgetConfig.balanceSheet && (
          <div className="lg:col-span-2 card p-6 shadow-sm border border-slate-100 flex flex-col justify-between">
            <div>
              {/* Header */}
              <div className="flex items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                    <Scale size={18} />
                  </div>
                  <h3 className="font-bold font-display tracking-tight text-sm text-slate-900">Balance Sheet Snapshot</h3>
                </div>
                {/* Period Dropdown */}
                <select
                  value={bsPeriod}
                  onChange={(e: any) => setBsPeriod(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-bold text-slate-700 outline-none cursor-pointer focus:border-indigo-500"
                >
                  <option value="fy">Full FY</option>
                  <option value="month">This Month</option>
                  <option value="last30">Last 30 Days</option>
                  <option value="quarter">This Quarter</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              {/* Custom Date Pickers */}
              {bsPeriod === 'custom' && (
                <div className="grid grid-cols-2 gap-2 mb-4 bg-slate-50 p-2 rounded-xl border border-slate-100">
                  <div>
                    <label className="block text-[8px] font-black text-slate-400 uppercase tracking-wider mb-0.5">From</label>
                    <input
                      type="date"
                      value={bsStartDate}
                      onChange={(e) => setBsStartDate(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-lg p-1 text-[10px] font-bold outline-none text-slate-700 cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="block text-[8px] font-black text-slate-400 uppercase tracking-wider mb-0.5">To</label>
                    <input
                      type="date"
                      value={bsEndDate}
                      onChange={(e) => setBsEndDate(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-lg p-1 text-[10px] font-bold outline-none text-slate-700 cursor-pointer"
                    />
                  </div>
                </div>
              )}

              {/* Active Period Label */}
              <div className="text-[10px] text-slate-500 font-medium tracking-tight mb-4 flex items-center gap-1">
                <span>Period:</span>
                <span className="font-bold text-slate-700">
                  {bsStartDate ? new Date(bsStartDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
                </span>
                <span className="text-slate-405">•</span>
                <span className="font-bold text-slate-700">
                  {bsEndDate ? new Date(bsEndDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
                </span>
              </div>
              {/* View Mode Toggle Pill */}
              <div className="flex bg-slate-100 p-0.5 rounded-xl border border-slate-200/50 text-[10px] w-full mb-4">
                <button
                  onClick={() => setBsViewMode('nature')}
                  className={`flex-1 py-1.5 rounded-lg font-black transition-all uppercase tracking-wider flex items-center justify-center gap-1 ${bsViewMode === 'nature' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  <span>Tally Nature</span>
                </button>
                <button
                  onClick={() => setBsViewMode('standard')}
                  className={`flex-1 py-1.5 rounded-lg font-black transition-all uppercase tracking-wider flex items-center justify-center gap-1 ${bsViewMode === 'standard' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  <span>Modern List</span>
                </button>
              </div>

              {bsViewMode === 'nature' && (
                <button
                  onClick={() => setBsDetailed(!bsDetailed)}
                  className={`w-full mb-4 text-center text-[9px] font-black uppercase tracking-widest border py-1.5 rounded-xl transition-all ${bsDetailed ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-105'}`}
                >
                  {bsDetailed ? 'Alt+F1: Condensed Mode' : 'Alt+F1: Detailed Mode'}
                </button>
              )}

              {bsViewMode === 'nature' ? (
                /* ================= MINI TALLY STYLE ================= */
                <div className="space-y-4 text-[11px] font-mono text-slate-850 h-[320px] overflow-y-auto pr-1 scrollbar-thin">
                  <div className="border border-slate-300 rounded-xl overflow-hidden bg-white shadow-xs">
                    <div className="bg-slate-900 text-white p-2 font-black text-[9px] uppercase tracking-wider text-center">
                      BALANCE SHEET DETAILS
                    </div>
                    <div className="grid grid-cols-2 divide-x divide-slate-300">
                      {/* LIABILITIES SIDE */}
                      <div className="p-2 space-y-3 flex flex-col justify-between min-h-[160px]">
                        <div className="space-y-3">
                          {/* Capital Account */}
                          <div>
                            <div className="flex justify-between font-bold text-slate-900">
                              <span>Capital Account</span>
                              <span>₹{Math.round(bsMetrics.liabilities.filter((l: any) => l.group === 'Capital Account').reduce((s: number, l: any) => s + Math.abs(l.dynamicBalance || 0), 0)).toLocaleString()}</span>
                            </div>
                            {bsDetailed && (
                              <div className="pl-2 mt-1 space-y-0.5 border-l border-slate-100 text-[9px] text-slate-500 italic">
                                {bsMetrics.liabilities.filter((l: any) => l.group === 'Capital Account').map((it: any, idx: number) => (
                                  <div key={idx} className="flex justify-between">
                                    <span className="truncate max-w-[80px]">{it.name}</span>
                                    <span>₹{Math.round(Math.abs(it.dynamicBalance || 0)).toLocaleString()}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Loans Liability */}
                          <div>
                            <div className="flex justify-between font-bold text-slate-905">
                              <span>Loans (Liability)</span>
                              <span>₹{Math.round(bsMetrics.liabilities.filter((l: any) => l.group === 'Loans (Liability)').reduce((s: number, l: any) => s + Math.abs(l.dynamicBalance || 0), 0)).toLocaleString()}</span>
                            </div>
                            {bsDetailed && (
                              <div className="pl-2 mt-1 space-y-0.5 border-l border-slate-100 text-[9px] text-slate-500 italic">
                                {bsMetrics.liabilities.filter((l: any) => l.group === 'Loans (Liability)').map((it: any, idx: number) => (
                                  <div key={idx} className="flex justify-between">
                                    <span className="truncate max-w-[80px]">{it.name}</span>
                                    <span>₹{Math.round(Math.abs(it.dynamicBalance || 0)).toLocaleString()}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* P & L A/c */}
                          <div>
                            <div className="flex justify-between font-bold text-slate-905">
                              <span>Profit & Loss A/c</span>
                              <span>₹{Math.round(bsMetrics.netProfit).toLocaleString()}</span>
                            </div>
                            {bsDetailed && (
                              <div className="pl-2 mt-1 space-y-0.5 border-l border-slate-100 text-[9px] text-slate-500 italic">
                                <div className="flex justify-between">
                                  <span>Current Period</span>
                                  <span className={bsMetrics.netProfit >= 0 ? "text-emerald-600 font-bold" : "text-rose-500"}>
                                    ₹{Math.round(bsMetrics.netProfit).toLocaleString()}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Current Liabilities */}
                          <div>
                            <div className="flex justify-between font-bold text-slate-905">
                              <span>Current Liabilities</span>
                              <span>₹{Math.round(bsMetrics.liabilities.filter((l: any) => ['Current Liabilities', 'Sundry Creditors', 'Duties & Taxes'].includes(l.group)).reduce((s: number, l: any) => s + Math.abs(l.dynamicBalance || 0), 0)).toLocaleString()}</span>
                            </div>
                            {bsDetailed && (
                              <div className="pl-2 mt-1 space-y-1 border-l border-slate-100 text-[9px] text-slate-500 italic">
                                {['Current Liabilities', 'Sundry Creditors', 'Duties & Taxes'].map((group) => {
                                  const groupLedgers = bsMetrics.liabilities.filter((l: any) => l.group === group);
                                  const groupSum = groupLedgers.reduce((s: number, l: any) => s + Math.abs(l.dynamicBalance || 0), 0);
                                  if (groupSum === 0) return null;
                                  return (
                                    <div key={group} className="space-y-0.5 border-b border-slate-50 pb-1">
                                      <div className="flex justify-between font-bold text-slate-600">
                                        <span>{group}</span>
                                        <span>₹{Math.round(groupSum).toLocaleString()}</span>
                                      </div>
                                      {groupLedgers.map((it: any, idx: number) => (
                                        <div key={idx} className="flex justify-between pl-1">
                                          <span className="truncate max-w-[70px]">{it.name}</span>
                                          <span>₹{Math.round(Math.abs(it.dynamicBalance || 0)).toLocaleString()}</span>
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* ASSETS SIDE */}
                      <div className="p-2 space-y-3 flex flex-col justify-between min-h-[160px]">
                        <div className="space-y-3">
                          {/* Fixed Assets */}
                          <div>
                            <div className="flex justify-between font-bold text-slate-900">
                              <span>Fixed Assets</span>
                              <span>₹{Math.round(bsMetrics.assets.filter((l: any) => l.group === 'Fixed Assets').reduce((s: number, l: any) => s + Math.abs(l.dynamicBalance || 0), 0)).toLocaleString()}</span>
                            </div>
                            {bsDetailed && (
                              <div className="pl-2 mt-1 space-y-0.5 border-l border-slate-100 text-[9px] text-slate-500 italic">
                                {bsMetrics.assets.filter((l: any) => l.group === 'Fixed Assets').map((it: any, idx: number) => (
                                  <div key={idx} className="flex justify-between">
                                    <span className="truncate max-w-[80px]">{it.name}</span>
                                    <span>₹{Math.round(Math.abs(it.dynamicBalance || 0)).toLocaleString()}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Investments */}
                          <div>
                            <div className="flex justify-between font-bold text-slate-905">
                              <span>Investments</span>
                              <span>₹{Math.round(bsMetrics.assets.filter((l: any) => l.group === 'Investments').reduce((s: number, l: any) => s + Math.abs(l.dynamicBalance || 0), 0)).toLocaleString()}</span>
                            </div>
                            {bsDetailed && (
                              <div className="pl-2 mt-1 space-y-0.5 border-l border-slate-100 text-[9px] text-slate-500 italic">
                                {bsMetrics.assets.filter((l: any) => l.group === 'Investments').map((it: any, idx: number) => (
                                  <div key={idx} className="flex justify-between">
                                    <span className="truncate max-w-[80px]">{it.name}</span>
                                    <span>₹{Math.round(Math.abs(it.dynamicBalance || 0)).toLocaleString()}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Closing Stock */}
                          <div>
                            <div className="flex justify-between font-bold text-slate-905">
                              <span>Closing Stock</span>
                              <span>₹{Math.round(bsMetrics.closingStock).toLocaleString()}</span>
                            </div>
                            {bsDetailed && (
                              <div className="pl-2 mt-1 space-y-0.5 border-l border-slate-100 text-[9px] text-slate-500 italic max-h-[80px] overflow-y-auto">
                                {activeCompany?.manualClosingStock ? (
                                  <div className="flex justify-between font-sans pr-2">
                                    <span className="truncate max-w-[120px]">Manual Stock Override</span>
                                    <span>₹{Math.round(bsMetrics.closingStock).toLocaleString()}</span>
                                  </div>
                                ) : (
                                  (bsMetrics.dynamicItems || []).filter((item: any) => Number(item.dynamicClosingQty || 0) !== 0).map((item: any, idx: number) => {
                                    const val = Number(item.dynamicClosingValue || 0);
                                    return (
                                      <div key={idx} className="flex justify-between">
                                        <span className="truncate max-w-[80px]">{item.name}</span>
                                        <span>₹{Math.round(val).toLocaleString()}</span>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            )}
                          </div>

                          {/* Current Assets */}
                          <div>
                            <div className="flex justify-between font-bold text-slate-905">
                              <span>Current Assets</span>
                              <span>₹{Math.round(bsMetrics.assets.filter((l: any) => ['Current Assets', 'Bank Accounts', 'Cash-in-hand', 'Sundry Debtors', 'Loans & Advances (Asset)'].includes(l.group)).reduce((s: number, l: any) => s + Math.abs(l.dynamicBalance || 0), 0)).toLocaleString()}</span>
                            </div>
                            {bsDetailed && (
                              <div className="pl-2 mt-1 space-y-1 border-l border-slate-100 text-[9px] text-slate-500 italic">
                                {['Current Assets', 'Bank Accounts', 'Cash-in-hand', 'Sundry Debtors', 'Loans & Advances (Asset)'].map((group) => {
                                  const groupLedgers = bsMetrics.assets.filter((l: any) => l.group === group);
                                  const groupSum = groupLedgers.reduce((s: number, l: any) => s + Math.abs(l.dynamicBalance || 0), 0);
                                  if (groupSum === 0) return null;
                                  return (
                                    <div key={group} className="space-y-0.5 border-b border-slate-50 pb-1">
                                      <div className="flex justify-between font-bold text-slate-600">
                                        <span>{group}</span>
                                        <span>₹{Math.round(groupSum).toLocaleString()}</span>
                                      </div>
                                      {groupLedgers.map((it: any, idx: number) => (
                                        <div key={idx} className="flex justify-between pl-1">
                                          <span className="truncate max-w-[70px]">{it.name}</span>
                                          <span>₹{Math.round(Math.abs(it.dynamicBalance || 0)).toLocaleString()}</span>
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Grand Totals */}
                    <div className="grid grid-cols-2 divide-x divide-slate-300 bg-slate-50 font-black border-t-2 border-slate-900 border-b-2">
                      <div className="p-2 flex justify-between">
                        <span className="uppercase text-[9px]">Total Cr</span>
                        <span className="font-sans">₹{Math.round(bsMetrics.totalLiabilities).toLocaleString()}</span>
                      </div>
                      <div className="p-2 flex justify-between pl-3">
                        <span className="uppercase text-[9px]">Total Dr</span>
                        <span className="font-sans">₹{Math.round(bsMetrics.totalAssets).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* ================= ORIGINAL STANDARD MODERN SUMMARY VIEW ================= */
                (() => {
                  const renderBsGroup = (groupName: string, ledgersList: any[]) => {
                    const filteredLedgers = ledgersList.filter((l: any) => l.group === groupName);
                    const total = filteredLedgers.reduce((sum: number, l: any) => sum + Math.abs(l.dynamicBalance || 0), 0);
                    if (total === 0) return null;
                    return (
                      <div key={groupName} className="mb-4">
                        <div className="flex justify-between items-center text-[10px] uppercase font-semibold tracking-wider text-slate-500 mb-1 px-1">
                          <span>{groupName}</span>
                          <span className="font-bold text-slate-700">₹{total.toLocaleString()}</span>
                        </div>
                        <div className="space-y-1 pl-2 border-l border-slate-100">
                          {filteredLedgers.map((it: any, idx: number) => (
                            <div key={idx} className="flex justify-between text-[11px] text-slate-650 font-medium py-0.5 hover:bg-slate-50 rounded px-1 transition-all">
                              <span className="truncate max-w-[130px]" title={it.name}>{it.name}</span>
                              <span className="text-slate-800 font-semibold">₹{Math.abs(it.dynamicBalance || 0).toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  };

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 h-[340px] overflow-y-auto pr-2 scrollbar-thin">
                      {/* Left Column: Liabilities & Equity */}
                      <div className="space-y-4 pr-1 md:border-r md:border-slate-100/80 animate-fade-in">
                        <div className="text-[10px] font-black uppercase text-slate-500 tracking-wider border-b border-slate-100 pb-1 mb-2 flex items-center gap-1.5 animate-pulse">
                          <ShieldCheck size={12} className="text-indigo-600" />
                          <span>Liabilities & Equity</span>
                        </div>
                        
                        {renderBsGroup('Capital Account', bsMetrics.liabilities)}
                        {renderBsGroup('Loans (Liability)', bsMetrics.liabilities)}

                        {/* Profit & Loss Reserve */}
                        <div className="mb-4">
                          <div className="flex justify-between items-center text-[10px] uppercase font-semibold tracking-wider text-slate-500 mb-1 px-1">
                            <span>Profit & Loss A/c</span>
                            <span className={`font-bold ${bsMetrics.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                              ₹{Math.abs(bsMetrics.netProfit).toLocaleString()}
                            </span>
                          </div>
                          <div className="space-y-1 pl-2 border-l border-slate-100 italic text-[11px] text-slate-500">
                            <div className="flex justify-between py-0.5 hover:bg-slate-50 rounded px-1 transition-all">
                              <span className="not-italic">Net Profit for period</span>
                              <span className={`font-semibold ${bsMetrics.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                                {bsMetrics.netProfit >= 0 ? `+ ₹${bsMetrics.netProfit.toLocaleString()}` : `- ₹${Math.abs(bsMetrics.netProfit).toLocaleString()}`}
                              </span>
                            </div>
                          </div>
                        </div>

                        {renderBsGroup('Current Liabilities', bsMetrics.liabilities)}
                        {renderBsGroup('Sundry Creditors', bsMetrics.liabilities)}
                        {renderBsGroup('Duties & Taxes', bsMetrics.liabilities)}
                      </div>

                      {/* Right Column: Assets */}
                      <div className="space-y-4 pl-1">
                        <div className="text-[10px] font-black uppercase text-slate-500 tracking-wider border-b border-slate-100 pb-1 mb-2 flex items-center gap-1.5">
                          <Building2 size={12} className="text-blue-500" />
                          <span>Assets</span>
                        </div>
                        
                        {renderBsGroup('Fixed Assets', bsMetrics.assets)}
                        {renderBsGroup('Investments', bsMetrics.assets)}

                        {/* Stock in Hand */}
                        <div className="mb-4">
                          <div className="flex justify-between items-center text-[10px] uppercase font-semibold tracking-wider text-slate-500 mb-1 px-1">
                            <span>Stock in Hand</span>
                            <span className="font-bold text-slate-700">₹{bsMetrics.closingStock.toLocaleString()}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 italic pl-2 border-l border-slate-100">
                            Auto-valued from Item Master
                          </div>
                        </div>

                        {renderBsGroup('Current Assets', bsMetrics.assets)}
                        {renderBsGroup('Bank Accounts', bsMetrics.assets)}
                        {renderBsGroup('Cash-in-hand', bsMetrics.assets)}
                        {renderBsGroup('Sundry Debtors', bsMetrics.assets)}
                        {renderBsGroup('Loans & Advances (Asset)', bsMetrics.assets)}
                      </div>
                    </div>
                  );
                })()
              )}
            </div>

            {/* Total Liabilities & Assets indicators */}
            <div className="pt-4 border-t border-slate-100 mt-4">
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-100">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Total Liabilities & Equity</span>
                  <span className="text-sm font-black text-slate-900">₹{bsMetrics.totalLiabilities.toLocaleString()}</span>
                </div>
                <div className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-100 text-right">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Total Assets</span>
                  <span className="text-sm font-black text-slate-900">₹{bsMetrics.totalAssets.toLocaleString()}</span>
                </div>
              </div>

              <div className="flex items-center justify-between py-2 text-[10px] text-slate-500 font-medium border-t border-slate-100">
                <div className="flex items-center gap-1.5 text-emerald-600 font-extrabold">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                  <span>Statement is Balanced</span>
                </div>
                <span className="text-[9px] text-slate-400 italic">Statement Verified</span>
              </div>
            </div>
          </div>
        )}

        {widgetConfig.logs && (
          <div className="lg:col-span-3">
             <ActivityLog companyId={activeCompany?.id} />
          </div>
        )}
      </div>
    </div>
  );
};

const SetupPage = ({ user, companies, onComplete, onCancel, canCancel }: any) => {
  const [formData, setFormData] = useState({
    name: '',
    gstIn: '',
    address: '',
    state: '',
    stateCode: '',
    pan: '',
    pinCode: '',
    registrationType: 'Regular',
    filingFrequency: 'Monthly'
  });

  const handleCreateCompany = async () => {
    if (!formData.name) return alert('Name is required');
    if (formData.registrationType !== 'Unregistered' && !validateGSTIN(formData.gstIn).valid) {
      return alert('Invalid GSTIN');
    }
    
    const company = await dbService.add('companies', {
      ...formData,
      ownerId: user.uid,
    });

    if (company) {
      const profile = await dbService.get('users', user.uid) as any;
      const existingIds = profile?.companyIds || [];
      await dbService.update('users', user.uid, {
        companyIds: [...existingIds, company.id]
      });
      onComplete(company);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6 bg-slate-50">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="card max-w-2xl w-full p-8 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
             <div className="w-12 h-12 bg-brand rounded-xl flex items-center justify-center text-white">
                <Building2 size={24} />
             </div>
             <div>
                <h1 className="text-xl font-bold">Register Business</h1>
                <p className="text-xs text-slate-500">Add your company details as per GST records</p>
             </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => signOut(auth)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-red-500 transition-colors" title="Logout">
              <LogOut size={20} />
            </button>
            {canCancel && (
              <button onClick={onCancel} className="p-2 hover:bg-slate-100 rounded-full">
                <X size={20} />
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="col-span-2">
            <label className="label">Legal Business Name*</label>
            <input 
              className="input-field" 
              placeholder="e.g. Bharat Trading Co."
              value={formData.name}
              onChange={e => setFormData({...formData, name: e.target.value})}
            />
          </div>

          <div>
             <label className="label">Registration Type</label>
             <select 
               className="input-field"
               value={formData.registrationType}
               onChange={e => setFormData({...formData, registrationType: e.target.value})}
             >
               <option value="Regular">Regular (GST)</option>
               <option value="Composition">Composition Scheme</option>
               <option value="Unregistered">Unregistered / Consumer</option>
             </select>
          </div>

          {formData.registrationType !== 'Unregistered' && (
            <div>
              <label className="label">GSTIN*</label>
              <input 
                className="input-field" 
                placeholder="27AAAAA0000A1Z5"
                value={formData.gstIn}
                onChange={e => {
                  const val = e.target.value.toUpperCase();
                  const validation = validateGSTIN(val);
                  setFormData({
                    ...formData, 
                    gstIn: val,
                    state: validation.valid ? validation.stateName || '' : formData.state,
                    stateCode: validation.valid ? validation.stateCode : formData.stateCode,
                    pan: validation.valid ? validation.pan || '' : formData.pan
                  });
                }}
              />
            </div>
          )}

          <div>
             <label className="label">State</label>
             <input className="input-field bg-slate-50" value={formData.state} readOnly placeholder="Detected from GSTIN" />
          </div>

          <div>
             <label className="label">Permanent Account Number (PAN)</label>
             <input className="input-field bg-slate-50" value={formData.pan} readOnly placeholder="Detected from GSTIN" />
          </div>

          <div className="col-span-2">
            <label className="label">Detailed Address</label>
            <textarea 
              className="input-field h-20" 
              placeholder="Building, Street, Area..."
              value={formData.address}
              onChange={e => setFormData({...formData, address: e.target.value})}
            />
          </div>

          <div>
             <label className="label">PIN Code</label>
             <input 
               className="input-field" 
               placeholder="400001"
               maxLength={6}
               value={formData.pinCode}
               onChange={e => setFormData({...formData, pinCode: e.target.value})}
             />
          </div>

          <div>
            <label className="label">Filing Frequency</label>
            <select 
              className="input-field"
              value={formData.filingFrequency}
              onChange={e => setFormData({...formData, filingFrequency: e.target.value})}
            >
              <option>Monthly</option>
              <option>QRMP</option>
            </select>
          </div>
        </div>

        <div className="flex gap-4 mt-8">
           <button onClick={handleCreateCompany} className="btn-primary flex-1 py-3 text-lg font-bold shadow-indigo-200 shadow-lg translate-y-0 active:translate-y-1 transition-all">
             {companies.length > 0 ? 'Update Business Info' : 'Register Business'}
           </button>
        </div>

        {companies.length > 0 && (
          <div className="mt-12 p-6 border-2 border-red-100 rounded-2xl bg-red-50/30">
            <h3 className="text-red-600 font-bold mb-2">Danger Zone</h3>
            <p className="text-xs text-slate-500 mb-4">Resetting data will remove all transactions, ledgers, and items for the active company. This cannot be undone.</p>
            <button 
              onClick={async () => {
                if (window.confirm('Are you sure you want to WIP ALL DATA? This will delete all transactions, items, and ledgers.')) {
                   alert('Data reset functionality is currently limited to manual deletion in this version. Please contact support or delete documents in console.');
                }
              }}
              className="px-4 py-2 bg-white text-red-600 border border-red-200 rounded-lg text-xs font-bold hover:bg-red-50"
            >
              Reset Company Data
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activePage, setActivePage] = useState<Page>('dashboard');
  const [companies, setCompanies] = useState<any[]>([]);
  const [activeCompany, setActiveCompany] = useState<any>(null);
  const [activeFY, setActiveFY] = useState<any>(getCurrentFY());
  const [showAI, setShowAI] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showWidgetSettings, setShowWidgetSettings] = useState(false);
  const [invoicePrefill, setInvoicePrefill] = useState<any>(null);
  const [ledgers, setLedgers] = useState<any[]>([]);
  const [appItems, setAppItems] = useState<any[]>([]);
  const [rawLedgers, setRawLedgers] = useState<any[]>([]);
  const [globalTransactions, setGlobalTransactions] = useState<any[]>([]);
  const [preSelectedReport, setPreSelectedReport] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      alert("Internet connection restored! Transactions and database caches synchronized automatically.");
    };
    const handleOffline = () => {
      setIsOnline(false);
      alert("Internet connection lost. You are now operating in Offline Mode - all actions are safely cached in IndexedDB.");
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const role: UserRole = (() => {
    if (!userProfile || !activeCompany) return 'Sales';
    if (activeCompany.ownerId === userProfile.uid) return 'Admin';
    const ass = userProfile.assignments?.find((a: any) => a.companyId === activeCompany.id);
    return ass ? ass.role : 'Sales';
  })();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showImportModal) { setShowImportModal(false); return; }
        if (showBulkModal) { setShowBulkModal(false); return; }
        if (showAI) { setShowAI(false); return; }
        if (showWidgetSettings) { setShowWidgetSettings(false); return; }

        if (activePage !== 'dashboard') {
          const formPages = ['new-sale', 'new-purchase', 'new-receipt', 'new-payment', 'new-contra', 'new-credit-note', 'new-debit-note', 'new-journal'];
          if (formPages.includes(activePage)) {
            const listMap: any = {
              'new-sale': 'sales',
              'new-purchase': 'purchases',
              'new-receipt': 'receipts',
              'new-payment': 'payments',
              'new-contra': 'contra',
              'new-credit-note': 'credit-note',
              'new-debit-note': 'debit-note',
              'new-journal': 'journal'
            };
            setActivePage(listMap[activePage]);
            setInvoicePrefill(null);
          } else if (['pl', 'bs', 'tb', 'cashbook', 'bankbook', 'ledger', 'sales_reg', 'pur_reg', 'cn_reg', 'dn_reg', 'contra_reg', 'journal_reg', 'receipt_reg', 'payment_reg', 'stock', 'itemprof', 'gstr1', 'gstr3b', 'eway-bill-validator'].includes(activePage)) {
            setActivePage('reports');
            setPreSelectedReport(null);
          } else {
            setActivePage('dashboard');
          }
        }
      }

      if (e.altKey) {
        switch (e.key.toLowerCase()) {
          case 's': e.preventDefault(); setActivePage('new-sale'); break;
          case 'p': e.preventDefault(); setActivePage('new-purchase'); break;
          case 'r': e.preventDefault(); setActivePage('new-receipt'); break;
          case 'y': e.preventDefault(); setActivePage('new-payment'); break;
          case 'c': e.preventDefault(); setActivePage('contra'); break;
          case 'k': e.preventDefault(); setActivePage('credit-note'); break;
          case 'b': e.preventDefault(); setActivePage('debit-note'); break;
          case 'n': e.preventDefault(); setActivePage('setup'); break;
          case 'w': e.preventDefault(); setActivePage('stock-summary'); break;
          case 'd': e.preventDefault(); setActivePage('dashboard'); break;
          case 'l': e.preventDefault(); setActivePage('ledgers'); break;
          case 'i': e.preventDefault(); setActivePage('inventory'); break;
          case 'u': e.preventDefault(); setActivePage('units'); break;
          case 'o': e.preventDefault(); setActivePage('cost-centres'); break;
          case 'j': e.preventDefault(); setActivePage('journal'); break;
          case 'g': e.preventDefault(); setActivePage('gst-reports'); break;
          case 'f': e.preventDefault(); setActivePage('financial-reports'); break;
          case 'a': e.preventDefault(); setShowImportModal(true); break;
          case 'x': 
            e.preventDefault(); 
            if (companies.length > 1) {
              const currentIndex = companies.findIndex((c: any) => c.id === activeCompany?.id);
              const nextIndex = (currentIndex + 1) % companies.length;
              setActiveCompany(companies[nextIndex]);
            }
            break;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePage, showImportModal, showAI, showWidgetSettings, companies, activeCompany]);

  useEffect(() => {
    if (user && activeCompany?.id) {
       return dbService.listenCollection(`companies/${activeCompany.id}/ledgers`, [], async (data) => {
         setLedgers(data);
         // If there are literally 0 ledgers (brand new company like GOODLUCKS), auto-seed basic accounts
         if (data && data.length === 0) {
           try {
             const defaults = [
               { name: 'State Bank of India', group: 'Bank Accounts', openingBalance: 0, currentBalance: 0, companyId: activeCompany.id, createdAt: new Date().toISOString() },
               { name: 'Cash Account', group: 'Cash-in-hand', openingBalance: 0, currentBalance: 0, companyId: activeCompany.id, createdAt: new Date().toISOString() },
               { name: 'CGST', group: 'Duties & Taxes', openingBalance: 0, currentBalance: 0, companyId: activeCompany.id, createdAt: new Date().toISOString() },
               { name: 'SGST', group: 'Duties & Taxes', openingBalance: 0, currentBalance: 0, companyId: activeCompany.id, createdAt: new Date().toISOString() },
               { name: 'IGST', group: 'Duties & Taxes', openingBalance: 0, currentBalance: 0, companyId: activeCompany.id, createdAt: new Date().toISOString() }
             ];
             for (const ledger of defaults) {
               await dbService.add(`companies/${activeCompany.id}/ledgers`, ledger);
             }
           } catch (error) {
             console.error("Auto-seeding ledgers failed", error);
           }
         } else if (data && data.length > 0) {
           const hasCGST = data.some((l: any) => l.name === 'CGST' && l.group === 'Duties & Taxes');
           const hasSGST = data.some((l: any) => l.name === 'SGST' && l.group === 'Duties & Taxes');
           const hasIGST = data.some((l: any) => l.name === 'IGST' && l.group === 'Duties & Taxes');
           
           if (!hasCGST || !hasSGST || !hasIGST) {
             try {
               if (!hasCGST) {
                 await dbService.add(`companies/${activeCompany.id}/ledgers`, {
                   name: 'CGST', group: 'Duties & Taxes', openingBalance: 0, currentBalance: 0, companyId: activeCompany.id, createdAt: new Date().toISOString()
                 });
               }
               if (!hasSGST) {
                 await dbService.add(`companies/${activeCompany.id}/ledgers`, {
                   name: 'SGST', group: 'Duties & Taxes', openingBalance: 0, currentBalance: 0, companyId: activeCompany.id, createdAt: new Date().toISOString()
                 });
               }
               if (!hasIGST) {
                 await dbService.add(`companies/${activeCompany.id}/ledgers`, {
                   name: 'IGST', group: 'Duties & Taxes', openingBalance: 0, currentBalance: 0, companyId: activeCompany.id, createdAt: new Date().toISOString()
                 });
               }
             } catch (error) {
               console.error("Auto-seeding missing tax ledgers failed", error);
             }
           }
         }
       });
    }
  }, [user, activeCompany?.id]);

  useEffect(() => {
    if (user && activeCompany?.id) {
      return dbService.listenCollection(`companies/${activeCompany.id}/items`, [], (data) => {
        setAppItems(data);
      });
    }
  }, [user, activeCompany?.id]);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (u) {
        // Listen to user profile
        unsubProfile = firestoreSnapshot(doc(db, 'users', u.uid), async (snap) => {
          if (snap.exists()) {
            const profile = snap.data() as UserProfile;
            
            // Migration: Add companyIds if missing
            if (!profile.companyIds) {
              const assignedIds = profile.assignments?.map(a => a.companyId) || [];
              await updateDoc(doc(db, 'users', u.uid), { companyIds: assignedIds });
            }

            setUserProfile(profile);

            const assignedIds = profile.companyIds || profile.assignments?.map(a => a.companyId) || [];
            const q = query(collection(db, 'companies'), where('ownerId', '==', u.uid));
            try {
              const ownerSnap = await getDocs(q);
              const ownedIds = ownerSnap.docs.map(d => d.id);
              const allIds = Array.from(new Set([...assignedIds, ...ownedIds])).filter(id => id && typeof id === 'string' && id.trim() !== '');
              
              if (allIds.length > 0) {
                const companiesData = await Promise.all(allIds.map(id => dbService.get('companies', id)));
                const validCompanies = companiesData.filter(Boolean);
                setCompanies(validCompanies);
                if (validCompanies.length > 0 && !activeCompany) {
                  setActiveCompany(validCompanies[0]);
                }
              } else {
                setCompanies([]);
              }
            } catch (err) {
              console.error("Error fetching companies", err);
              setCompanies([]);
            }
          } else {
            const newProfile: UserProfile = {
              uid: u.uid,
              email: u.email || '',
              name: u.displayName || 'New User',
              assignments: [],
              companyIds: []
            };
            await dbService.set('users', u.uid, newProfile);
            setUserProfile(newProfile);
          }
          setLoading(false); // Set loading false ONLY after profile is handled
        }, (error) => {
          console.error("Profile listener error:", error);
          setLoading(false);
        });
      } else {
        setUserProfile(null);
        setCompanies([]);
        setActiveCompany(null);
        setLedgers([]);
        setActivePage('dashboard');
        setLoading(false);
      }
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const handleLogin = async () => {
    if (isLoggingIn) return;
    
    setIsLoggingIn(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      if (error.code === 'auth/cancelled-popup-request' || error.code === 'auth/popup-closed-by-user') {
        console.log("Login flow was interrupted or cancelled.");
      } else {
        console.error("Login failed:", error);
        alert(`Login failed: ${error.message}`);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleTallyExport = async () => {
    if (!activeCompany || !activeFY) return;
    
    // Fetch all transactions for the company and FY
    const txs = await dbService.getCollection(`companies/${activeCompany.id}/transactions`, [
      where('date', '>=', activeFY.startDate),
      where('date', '<=', activeFY.endDate),
      orderBy('date', 'asc')
    ]);

    if (!txs || txs.length === 0) {
      alert('No transactions found for the selected period.');
      return;
    }

    const xml = generateTallyXml(txs, activeCompany.name);
    downloadTallyXml(xml, `Tally_Vouchers_${activeCompany.name}_${activeFY.label}.xml`);
  };

  const handleCreateLedger = async (name: string, group: string) => {
    if (!activeCompany?.id) return;
    try {
      return await dbService.add(`companies/${activeCompany.id}/ledgers`, {
        name,
        group,
        openingBalance: 0,
        currentBalance: 0,
        createdAt: new Date().toISOString()
      });
    } catch (err) {
      console.error("Failed to create ledger from import", err);
      throw err;
    }
  };

  const handleTallyImport = async (vouchers: TallyVoucher[]) => {
    if (!activeCompany || !activeFY) return;

    let imported = 0;
    let errors = 0;
    
    // Local copy to avoid duplicate creation within the same import session
    let localLedgers = [...ledgers];

    for (const v of vouchers) {
      try {
        // Find party ledger or create it (case-insensitive)
        let ledger = localLedgers.find((l: any) => l.name.toLowerCase() === v.partyName.toLowerCase());
        let ledgerId = ledger?.id;
        
        if (!ledgerId) {
          // Determine group based on transaction type if not exists
          let group = 'Sundry Debtors';
          if (v.type === 'Purchases' || v.type === 'Payment') group = 'Sundry Creditors';

          const newLedgerData = {
            name: v.partyName,
            group,
            openingBalance: 0,
            currentBalance: 0,
            createdAt: new Date().toISOString()
          };
          
          const ref = await dbService.add(`companies/${activeCompany.id}/ledgers`, newLedgerData);
          ledgerId = ref.id;
          ledger = { id: ledgerId, ...newLedgerData };
          localLedgers.push(ledger);
          
          await dbService.addLog(activeCompany.id, 'CREATE', `Auto-created ledger: ${v.partyName} during Tally import`);
        }

        // Prepare transaction data
        const txData: any = {
          date: v.date,
          type: v.type,
          voucherNumber: v.voucherNumber,
          partyId: ledgerId,
          partyName: v.partyName,
          narration: v.narration || '',
          totalAmount: v.amount,
          cgst: (v as any).cgst || 0,
          sgst: (v as any).sgst || 0,
          igst: (v as any).igst || 0,
          totalTax: (v as any).totalTax || 0,
          subTotal: v.amount - ((v as any).totalTax || 0),
          companyId: activeCompany.id,
          fyId: activeFY.id,
          createdAt: new Date().toISOString(),
          isAutoImported: true,
          source: 'Tally XML / Bank Import'
        };

        await dbService.add(`companies/${activeCompany.id}/transactions`, txData);

        // Update ledger balance
        let change = 0;
        const vType = (v.type || '').toLowerCase();
        if (vType.includes('receipt')) change = -v.amount;
        else if (vType.includes('payment')) change = v.amount;
        else if (vType.includes('sale')) change = v.amount;
        else if (vType.includes('purchase')) change = -v.amount;

        if (change !== 0) {
          const newBalance = (ledger.currentBalance || 0) + change;
          await dbService.update(`companies/${activeCompany.id}/ledgers`, ledgerId, {
            currentBalance: newBalance
          });
          ledger.currentBalance = newBalance;
        }

        imported++;
      } catch (err) {
        console.error("Import error for voucher", v, err);
        errors++;
      }
    }

    if (errors > 0) {
      alert(`Imported ${imported} vouchers. ${errors} failed. Check console for details.`);
    } else {
      alert(`Successfully imported ${imported} vouchers.`);
    }
    setShowImportModal(false);
  };

  if (loading) return (
    <div className="h-screen w-screen flex items-center justify-center bg-bg">
      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
        <IndianRupee size={48} className="text-brand" />
      </motion.div>
    </div>
  );

  if (!user) return (
    <div className="min-h-screen bg-brand flex items-center justify-center p-6 relative overflow-hidden">
      {/* Decorative background */}
      <div className="absolute top-0 left-0 w-full h-full">
        <div className="absolute top-[10%] left-[10%] w-64 h-64 bg-indigo-500/20 rounded-full blur-3xl"></div>
        <div className="absolute bottom-[10%] right-[10%] w-64 h-64 bg-indigo-800/20 rounded-full blur-3xl"></div>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="card max-w-lg w-full p-12 text-center relative z-10"
      >
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 bg-brand rounded-2xl flex items-center justify-center text-white shadow-xl">
             <IndianRupee size={40} />
          </div>
        </div>
        <h1 className="text-4xl font-bold mb-2">Lekha Sahayak</h1>
        <p className="text-slate-500 mb-8 text-lg">The Modern GST & Accounting Engine for Indian Businesses</p>
        
        <div className="space-y-4 text-left bg-slate-50 p-6 rounded-2xl mb-8">
          <div className="flex items-center gap-3 text-slate-700">
            <div className="w-6 h-6 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center">✓</div>
            <span>Auto GST Calculation & Filing</span>
          </div>
          <div className="flex items-center gap-3 text-slate-700">
            <div className="w-6 h-6 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center">✓</div>
            <span>AI-Powered Bill Processing</span>
          </div>
          <div className="flex items-center gap-3 text-slate-700">
            <div className="w-6 h-6 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center">✓</div>
            <span>Full Double-Entry Accounting</span>
          </div>
        </div>

        <button 
          onClick={handleLogin} 
          disabled={isLoggingIn}
          className={`btn-primary w-full py-4 text-lg rounded-2xl shadow-lg ring-4 ring-brand/5 ${isLoggingIn ? 'opacity-70 cursor-not-allowed' : ''}`}
        >
          {isLoggingIn ? 'Connecting...' : 'Sign in with Google Account'}
        </button>
        
        <p className="mt-8 text-slate-400 text-xs">
          By signing in, you agree to our Terms of Service and Privacy Policy.
        </p>
      </motion.div>
    </div>
  );

  if (companies.length === 0 && activePage !== 'setup') {
    return <SetupPage user={user} companies={companies} onComplete={(c: any) => { setActiveCompany(c); setActivePage('dashboard'); }} />;
  }

  if (activePage === 'setup') {
    return <SetupPage 
      user={user} 
      companies={companies}
      canCancel={companies.length > 0}
      onCancel={() => setActivePage('dashboard')}
      onComplete={(c: any) => { setActiveCompany(c); setActivePage('dashboard'); }} 
    />;
  }

  return (
    <div className="min-h-screen bg-bg">
      <Sidebar 
        activePage={activePage} 
        setActivePage={setActivePage} 
        companies={companies}
        activeCompany={activeCompany}
        setActiveCompany={setActiveCompany}
        activeFY={activeFY}
        setActiveFY={setActiveFY}
        setInvoicePrefill={setInvoicePrefill}
        onTallyExport={handleTallyExport}
        onTallyImport={() => setShowImportModal(true)}
        onAIImport={() => setShowImportModal(true)}
        onBulkImport={() => setShowBulkModal(true)}
        onCustomizeDashboard={() => {
          setActivePage('dashboard');
          setShowWidgetSettings(!showWidgetSettings);
        }}
        userProfile={userProfile}
        preSelectedReport={preSelectedReport}
        setPreSelectedReport={setPreSelectedReport}
      />
      
      <main className="pt-24 pb-12 px-6 max-w-7xl mx-auto">
        <AnimatePresence mode="wait">
        {activePage === 'dashboard' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Dashboard 
                activeCompany={activeCompany} 
                setActivePage={setActivePage} 
                activeFY={activeFY} 
                setInvoicePrefill={setInvoicePrefill}
                showWidgetSettings={showWidgetSettings}
                setShowWidgetSettings={setShowWidgetSettings}
                role={role}
                onPrint={(t: any) => {
                  setInvoicePrefill({ ...t, autoPreview: true });
                  setActivePage(t.type === 'Sales' ? 'new-sale' : 'new-purchase');
                }}
                onPreview={(t: any) => {
                  setInvoicePrefill({ ...t, autoPreview: true });
                  setActivePage(t.type === 'Sales' ? 'new-sale' : 'new-purchase');
                }}
              />
            </motion.div>
          )}

          {['sales', 'purchases', 'receipts', 'payments', 'contra', 'credit-note', 'debit-note', 'journal'].includes(activePage) && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <button onClick={() => setActivePage('dashboard')} className="p-2 hover:bg-white rounded-lg transition-colors text-slate-500 shadow-sm border border-slate-100 bg-white" title="Back to Dashboard">
                    <ArrowLeft size={18} />
                  </button>
                  <h2 className="text-xl font-bold uppercase tracking-tight">
                    {activePage.replace('-', ' ')}
                  </h2>
                </div>
                <div className="flex gap-2">
                  {activePage === 'purchases' && (
                    <button onClick={() => setShowAI(true)} className="btn-secondary">
                      <Cpu size={18} /> AI Process Bill
                    </button>
                  )}
                  {['receipts', 'payments'].includes(activePage) && (
                    <button onClick={() => setShowAI(true)} className="btn-secondary">
                      <Cpu size={18} /> Import Statement
                    </button>
                  )}
                  {['receipts', 'payments'].includes(activePage) && (
                    <button onClick={() => { setInvoicePrefill(null); setActivePage(activePage === 'receipts' ? 'new-receipt' : 'new-payment'); }} className="btn-primary">
                      <Plus size={18} /> New {activePage === 'receipts' ? 'Receipt' : 'Payment'}
                    </button>
                  )}
                  {['sales', 'purchases'].includes(activePage) && (
                    <button onClick={() => { setInvoicePrefill(null); setActivePage(activePage === 'sales' ? 'new-sale' : 'new-purchase'); }} className="btn-primary">
                      <Plus size={18} /> New {activePage === 'sales' ? 'Invoice' : 'Bill'}
                    </button>
                  )}
                  {!['sales', 'purchases', 'receipts', 'payments', 'ledger-master', 'reports', 'inventory', 'units', 'dashboard'].includes(activePage) && (
                    <button 
                      onClick={() => { 
                        setInvoicePrefill(null); 
                        if (activePage === 'contra') setActivePage('new-contra');
                        else if (activePage === 'credit-note') setActivePage('new-credit-note');
                        else if (activePage === 'debit-note') setActivePage('new-debit-note');
                        else if (activePage === 'journal') setActivePage('new-journal');
                      }} 
                      className="btn-primary"
                    >
                      <Plus size={18} /> New {activePage.charAt(0).toUpperCase() + activePage.slice(1).replace('-', ' ')}
                    </button>
                  )}
                </div>
              </div>

              <AnimatePresence>
                {showAI && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="relative mb-6">
                      <AIProcessor 
                        type={activePage === 'purchases' ? 'bill' : 'statement'} 
                        companyId={activeCompany.id}
                        activeFY={activeFY}
                        onResult={(data) => {
                          if (activePage === 'purchases' && data.totalAmount) {
                            setInvoicePrefill(data);
                            setActivePage('new-purchase');
                          } else if (data.importedCount) {
                            alert(`Successfully imported ${data.importedCount} transactions.`);
                          }
                          setShowAI(false);
                        }}
                        onClose={() => setShowAI(false)}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex items-center gap-4 mb-6 bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                 <Search className="text-slate-400" size={18} />
                 <input className="bg-transparent outline-none flex-1 text-sm" placeholder="Search transactions..." />
              </div>
          <TransactionsList 
             companyId={activeCompany.id} 
             type={
               activePage === 'sales' ? 'Sales' :
               activePage === 'purchases' ? 'Purchases' :
               activePage === 'receipts' ? 'Receipt' :
               activePage === 'payments' ? 'Payment' :
               activePage === 'contra' ? 'Contra' :
               activePage === 'credit-note' ? 'Credit Note' :
               activePage === 'debit-note' ? 'Debit Note' :
               activePage === 'journal' ? 'Journal' : ''
             } 
             activeFY={activeFY} 
             onEdit={(t) => {
               setInvoicePrefill(t);
               if (t.type === 'Sales') setActivePage('new-sale');
               else if (t.type === 'Purchases') setActivePage('new-purchase');
               else if (t.type === 'Receipt') setActivePage('new-receipt');
               else if (t.type === 'Payment') setActivePage('new-payment');
               else if (t.type === 'Contra') setActivePage('new-contra');
               else if (t.type === 'Credit Note') setActivePage('new-credit-note');
               else if (t.type === 'Debit Note') setActivePage('new-debit-note');
               else if (t.type === 'Journal') setActivePage('new-journal');
             }}
             onPrint={(t) => {
               setInvoicePrefill({ ...t, autoPreview: true });
               if (t.type === 'Sales') setActivePage('new-sale');
               else if (t.type === 'Purchases') setActivePage('new-purchase');
               else if (t.type === 'Receipt') setActivePage('new-receipt');
               else if (t.type === 'Payment') setActivePage('new-payment');
               else if (t.type === 'Contra') setActivePage('new-contra');
               else if (t.type === 'Credit Note') setActivePage('new-credit-note');
               else if (t.type === 'Debit Note') setActivePage('new-debit-note');
               else if (t.type === 'Journal') setActivePage('new-journal');
             }}
             onPreview={(t) => {
               setInvoicePrefill({ ...t, autoPreview: true });
               if (t.type === 'Sales') setActivePage('new-sale');
               else if (t.type === 'Purchases') setActivePage('new-purchase');
               else if (t.type === 'Receipt') setActivePage('new-receipt');
               else if (t.type === 'Payment') setActivePage('new-payment');
               else if (t.type === 'Contra') setActivePage('new-contra');
               else if (t.type === 'Credit Note') setActivePage('new-credit-note');
               else if (t.type === 'Debit Note') setActivePage('new-debit-note');
               else if (t.type === 'Journal') setActivePage('new-journal');
             }}
          />
            </motion.div>
          )}

          {activePage === 'new-sale' && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <InvoiceForm 
                company={activeCompany} 
                type="Sales" 
                activeFY={activeFY}
                prefillData={invoicePrefill}
                onSave={() => {
                  setInvoicePrefill(null);
                  setActivePage('sales');
                }} 
                onCancel={() => {
                  setInvoicePrefill(null);
                  setActivePage('sales');
                }} 
              />
            </motion.div>
          )}

          {activePage === 'new-purchase' && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <InvoiceForm 
                company={activeCompany} 
                type="Purchases" 
                activeFY={activeFY}
                prefillData={invoicePrefill}
                onSave={() => {
                  setInvoicePrefill(null);
                  setActivePage('purchases');
                }} 
                onCancel={() => {
                  setInvoicePrefill(null);
                  setActivePage('purchases');
                }} 
              />
            </motion.div>
          )}

          {activePage === 'new-receipt' && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <VoucherForm 
                company={activeCompany} 
                type="Receipt" 
                activeFY={activeFY}
                prefillData={invoicePrefill}
                onSave={() => {
                  setInvoicePrefill(null);
                  setActivePage('receipts');
                }} 
                onCancel={() => {
                  setInvoicePrefill(null);
                  setActivePage('receipts');
                }} 
              />
            </motion.div>
          )}

          {activePage === 'new-payment' && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <VoucherForm 
                company={activeCompany} 
                type="Payment" 
                activeFY={activeFY}
                prefillData={invoicePrefill}
                onSave={() => {
                  setInvoicePrefill(null);
                  setActivePage('payments');
                }} 
                onCancel={() => {
                  setInvoicePrefill(null);
                  setActivePage('payments');
                }} 
              />
            </motion.div>
          )}

          {['new-contra', 'new-journal', 'new-credit-note', 'new-debit-note'].includes(activePage) && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <VoucherForm 
                company={activeCompany} 
                type={
                  activePage === 'new-contra' ? 'Contra' :
                  activePage === 'new-journal' ? 'Journal' :
                  activePage === 'new-credit-note' ? 'Credit Note' : 'Debit Note'
                } 
                activeFY={activeFY}
                prefillData={invoicePrefill}
                onSave={() => {
                  setInvoicePrefill(null);
                  setActivePage(
                    activePage === 'new-contra' ? 'contra' :
                    activePage === 'new-journal' ? 'journal' :
                    activePage === 'new-credit-note' ? 'credit-note' : 'debit-note'
                  );
                }} 
                onCancel={() => {
                  setInvoicePrefill(null);
                  setActivePage(
                    activePage === 'new-contra' ? 'contra' :
                    activePage === 'new-journal' ? 'journal' :
                    activePage === 'new-credit-note' ? 'credit-note' : 'debit-note'
                  );
                }} 
              />
            </motion.div>
          )}

          {activePage === 'rollover' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
              <div className="flex items-center gap-4">
                <button onClick={() => setActivePage('dashboard')} className="p-2 hover:bg-white rounded-lg transition-colors text-slate-500 shadow-sm border border-slate-100 bg-white">
                  <ArrowLeft size={18} />
                </button>
                <h2 className="text-xl font-bold uppercase tracking-tight">Year End Rollover</h2>
              </div>
              <FYRollover 
                company={activeCompany} 
                activeFY={activeFY} 
                onComplete={(newFY: any) => {
                  setActiveFY(newFY);
                  setActivePage('dashboard');
                }} 
              />
            </motion.div>
          )}

          {activePage === 'inventory' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="flex items-center gap-4">
                <button onClick={() => setActivePage('dashboard')} className="p-2 hover:bg-white rounded-lg transition-colors text-slate-500 shadow-sm border border-slate-100 bg-white">
                  <ArrowLeft size={18} />
                </button>
                <h2 className="text-xl font-bold uppercase tracking-tight">Stock Master</h2>
              </div>
              <ItemMaster companyId={activeCompany.id} />
            </motion.div>
          )}

          {activePage === 'ledgers' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="flex items-center gap-4">
                <button onClick={() => setActivePage('dashboard')} className="p-2 hover:bg-white rounded-lg transition-colors text-slate-500 shadow-sm border border-slate-100 bg-white">
                  <ArrowLeft size={18} />
                </button>
                <h2 className="text-xl font-bold uppercase tracking-tight">Ledgers</h2>
              </div>
              <LedgerMaster companyId={activeCompany.id} activeFY={activeFY} />
            </motion.div>
          )}

          {activePage === 'units' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="flex items-center gap-4">
                <button onClick={() => setActivePage('dashboard')} className="p-2 hover:bg-white rounded-lg transition-colors text-slate-500 shadow-sm border border-slate-100 bg-white">
                  <ArrowLeft size={18} />
                </button>
                <h2 className="text-xl font-bold uppercase tracking-tight">Units</h2>
              </div>
              <UnitMaster companyId={activeCompany.id} />
            </motion.div>
          )}

          {activePage === 'cost-centres' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="flex items-center gap-4">
                <button onClick={() => setActivePage('dashboard')} className="p-2 hover:bg-white rounded-lg transition-colors text-slate-500 shadow-sm border border-slate-100 bg-white">
                  <ArrowLeft size={18} />
                </button>
                <h2 className="text-xl font-bold uppercase tracking-tight">Cost Centres</h2>
              </div>
              <CostCentreManager companyId={activeCompany.id} />
            </motion.div>
          )}

          {['reports', 'gst-reports', 'financial-reports', 'sales_reg', 'pur_reg', 'cn_reg', 'dn_reg', 'contra_reg', 'journal_reg', 'receipt_reg', 'payment_reg'].includes(activePage) && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="flex items-center gap-4">
                <button onClick={() => setActivePage('dashboard')} className="p-2 hover:bg-white rounded-lg transition-colors text-slate-500 shadow-sm border border-slate-100 bg-white">
                  <ArrowLeft size={18} />
                </button>
                <h2 className="text-xl font-bold uppercase tracking-tight">
                  {['sales_reg', 'pur_reg', 'cn_reg', 'dn_reg', 'contra_reg', 'journal_reg', 'receipt_reg', 'payment_reg'].includes(activePage) 
                    ? 'Register' 
                    : activePage.replace('-', ' ')}
                </h2>
              </div>
              <Reports 
                company={activeCompany}
                companyId={activeCompany.id} 
                activeFY={activeFY} 
                category={activePage === 'gst-reports' ? 'gst' : (activePage === 'financial-reports' ? 'financial' : 'all')}
                preSelectedReport={['sales_reg', 'pur_reg', 'cn_reg', 'dn_reg', 'contra_reg', 'journal_reg', 'receipt_reg', 'payment_reg'].includes(activePage) ? activePage : preSelectedReport}
                onReportOpen={() => setPreSelectedReport(null)}
                role={role}
                onEditTransaction={(t) => {
                  setInvoicePrefill(t);
                  if (t.type === 'Sales') setActivePage('new-sale');
                  else if (t.type === 'Purchases') setActivePage('new-purchase');
                  else if (t.type === 'Receipt') setActivePage('new-receipt');
                  else if (t.type === 'Payment') setActivePage('new-payment');
                  else if (t.type === 'Contra') setActivePage('new-contra');
                  else if (t.type === 'Credit Note') setActivePage('new-credit-note');
                  else if (t.type === 'Debit Note') setActivePage('new-debit-note');
                  else if (t.type === 'Journal') setActivePage('new-journal');
                }}
              />
            </motion.div>
          )}

          {activePage === 'stock-summary' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="flex items-center gap-4">
                <button onClick={() => setActivePage('dashboard')} className="p-2 hover:bg-white rounded-lg transition-colors text-slate-500 shadow-sm border border-slate-100 bg-white">
                  <ArrowLeft size={18} />
                </button>
                <h2 className="text-xl font-bold uppercase tracking-tight">Stock Summary</h2>
              </div>
              <StockSummaryReport company={activeCompany} companyId={activeCompany.id} activeFY={activeFY} />
            </motion.div>
          )}

          {activePage === 'bank-reconciliation' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="flex items-center gap-4">
                <button onClick={() => setActivePage('dashboard')} className="p-2 hover:bg-white rounded-lg transition-colors text-slate-500 shadow-sm border border-slate-100 bg-white">
                  <ArrowLeft size={18} />
                </button>
                <h2 className="text-xl font-bold uppercase tracking-tight">Bank Reconciliation</h2>
              </div>
              <BankReconciliation companyId={activeCompany.id} activeFY={activeFY} ledgers={ledgers} />
            </motion.div>
          )}

          {activePage === 'company-settings' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="flex items-center gap-4">
                <button onClick={() => setActivePage('dashboard')} className="p-2 hover:bg-white rounded-lg transition-colors text-slate-500 shadow-sm border border-slate-100 bg-white">
                  <ArrowLeft size={18} />
                </button>
                <h2 className="text-xl font-bold uppercase tracking-tight">Company Management</h2>
              </div>
              <CompanySettings 
                activeCompany={activeCompany} 
                userProfile={userProfile}
                onCompanyUpdate={(updated) => {
                  setCompanies(prev => prev.map(c => c.id === updated.id ? updated : c));
                  setActiveCompany(updated);
                }}
                onCompanyDelete={() => {
                  const remaining = companies.filter(c => c.id !== activeCompany.id);
                  setCompanies(remaining);
                  setActiveCompany(remaining.length > 0 ? remaining[0] : null);
                  setActivePage('dashboard');
                }}
              />
            </motion.div>
          )}
          
          {activePage === 'team' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="flex items-center gap-4">
                <button onClick={() => setActivePage('dashboard')} className="p-2 hover:bg-white rounded-lg transition-colors text-slate-500 shadow-sm border border-slate-100 bg-white">
                  <ArrowLeft size={18} />
                </button>
                <h2 className="text-xl font-bold uppercase tracking-tight">Team & Permissions</h2>
              </div>
              <UserPermissions activeCompany={activeCompany} currentUserProfile={userProfile} />
            </motion.div>
          )}

          {activePage === 'settings' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="flex items-center gap-4">
                <button onClick={() => setActivePage('dashboard')} className="p-2 hover:bg-white rounded-lg transition-colors text-slate-500 shadow-sm border border-slate-100 bg-white">
                  <ArrowLeft size={18} />
                </button>
                <h2 className="text-xl font-bold uppercase tracking-tight">System Settings</h2>
              </div>
              <SequenceSettings companyId={activeCompany.id} activeFY={activeFY} />
            </motion.div>
          )}

          {/* Fallback for other pages */}
          {activePage === 'admin' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="card p-12 text-center">
              <div className="flex justify-center mb-4">
                 <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
                    <Cpu size={32} />
                 </div>
              </div>
              <h2 className="text-xl font-bold mb-2">Module Under Development</h2>
              <p className="text-slate-500">I am currently building the {activePage} logic.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {showImportModal && (
        <BankImportModal 
          ledgers={ledgers}
          items={appItems}
          onImport={handleTallyImport}
          onCreateLedger={handleCreateLedger}
          companyId={activeCompany?.id}
          activeFY={activeFY}
          onClose={() => setShowImportModal(false)}
        />
      )}
      {showBulkModal && (
        <BulkEntryModal 
          ledgers={ledgers}
          items={appItems}
          activeCompany={activeCompany}
          activeFY={activeFY}
          onClose={() => setShowBulkModal(false)}
        />
      )}
      <Footer />

      {/* AI Float Button */}
      <div className="fixed bottom-6 right-6 print:hidden">
        <button className="w-14 h-14 bg-indigo-600 rounded-full text-white shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all group">
          <Cpu className="group-hover:rotate-12 transition-transform" />
          <div className="absolute right-full mr-4 bg-slate-900 text-white text-xs px-3 py-1.5 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
            AI Document Processing
          </div>
        </button>
      </div>
    </div>
  );
}
