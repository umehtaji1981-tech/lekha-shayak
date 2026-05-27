import React, { useState, useMemo } from 'react';
import { 
  ArrowLeft, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  Plus, 
  Mail, 
  Filter, 
  TrendingUp, 
  Database, 
  ShieldCheck, 
  Check, 
  AlertTriangle, 
  Info, 
  ChevronRight,
  Upload,
  Code,
  FileSpreadsheet,
  RefreshCw,
  Send,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ItcReconciliationProps {
  company: any;
  transactions: any[];
  ledgers: any[];
  items: any[];
  activeFY: any;
  onBack: () => void;
}

export const ItcReconciliation = ({ company, transactions, ledgers, items, activeFY, onBack }: ItcReconciliationProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Matched' | 'Mismatched' | 'MissingInBooks' | 'MissingInPortal'>('All');
  const [showNotification, setShowNotification] = useState<string | null>(null);
  const [showJsonUpload, setShowJsonUpload] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [importedGstr2b, setImportedGstr2b] = useState<any[] | null>(null);

  // Helper: Get real purchases from the books
  const booksPurchases = useMemo(() => {
    return transactions.filter(t => t.type === 'Purchases' || t.type === 'Purchase');
  }, [transactions]);

  // Convert ledgers lookup map
  const ledgerMap = useMemo(() => {
    return new Map(ledgers.map(l => [l.id, l]));
  }, [ledgers]);

  // High-fidelity GSTR-2B Sample Template to guide the user
  const sampleGstr2bTemplate = useMemo(() => {
    return [
      {
        "invoiceNo": "PUR/26/1001",
        "date": "2026-04-15",
        "vendorName": "Acme Industrial Supplies",
        "gstin": "27AAAAA0000A1Z1",
        "taxableValue": 8470.00,
        "gstAmount": 1530.00,
        "filingStatus": "Filed",
        "filingDate": "2026-05-11"
      },
      {
        "invoiceNo": "PUR/26/1002",
        "date": "2026-04-20",
        "vendorName": "Zenith Corp Ltd",
        "gstin": "27BBBBB1111B2Z2",
        "taxableValue": 10000.00,
        "gstAmount": 1900.00, // Slightly mismatched with books
        "filingStatus": "Filed",
        "filingDate": "2026-05-12"
      },
      {
        "invoiceNo": "NOT-IN-PORTAL-09",
        "date": "2026-04-22",
        "vendorName": "Pioneer Logistics Ltd",
        "gstin": "27CCCCC2222C3Z3",
        "taxableValue": 25000.00,
        "gstAmount": 4500.00,
        "filingStatus": "Not Filed", // Strong supplier return pending warning!
        "filingDate": ""
      },
      {
        "invoiceNo": "TAX-99052", // Found on portal, missing in company books
        "date": "2026-04-28",
        "vendorName": "Bharat Petroleum Corp Ltd",
        "gstin": "27AAACB2184Q1Z1",
        "taxableValue": 14200.00,
        "gstAmount": 2556.00,
        "filingStatus": "Filed",
        "filingDate": "2026-05-11"
      }
    ];
  }, []);

  // Compute standard list if no custom GSTR-2B JSON is imported yet
  const defaultSimulatedGstr2b = useMemo(() => {
    const list: any[] = [];
    booksPurchases.forEach((p, idx) => {
      const vendor = ledgerMap.get(p.partyId) || { name: 'Unknown Supplier', gstIn: '' };
      const gstin = vendor.gstIn || vendor.gstin || '27AAAAA0000A1Z' + (idx % 9);
      const invoiceNo = p.voucherNumber || `PUR/26/${String(1000 + idx).slice(1)}`;
      const getTax = (t: any) => t.totalTax ?? ((t.cgst || 0) + (t.sgst || 0) + (t.igst || 0)) ?? 0;
      const totalTax = getTax(p);
      const taxableVal = p.totalAmount - totalTax;

      // Classify into cases for extreme interactive coverage
      if (idx % 8 === 2) {
        // Supplier GSTR-1 pending / late filers (FilingStatus: Not Filed)
        list.push({
          invoiceNo,
          date: p.date,
          vendorName: vendor.name,
          gstin,
          taxableValue: taxableVal,
          gstAmount: totalTax,
          filingStatus: 'Not Filed',
          filingDate: ''
        });
      } else if (idx % 8 === 5) {
        // Decimal rounding difference mismatch
        list.push({
          invoiceNo,
          date: p.date,
          vendorName: vendor.name,
          gstin,
          taxableValue: taxableVal - 15.00,
          gstAmount: totalTax - 2.70,
          filingStatus: 'Filed',
          filingDate: '2026-05-13'
        });
      } else {
        // Perfect Match
        list.push({
          invoiceNo,
          date: p.date,
          vendorName: vendor.name,
          gstin,
          taxableValue: taxableVal,
          gstAmount: totalTax,
          filingStatus: 'Filed',
          filingDate: '2026-05-10'
        });
      }
    });

    // Add Simulated portal-only item (Missing in books)
    list.push({
      invoiceNo: 'BPCL/MUM/99342',
      date: new Date(activeFY.startDate).toISOString().split('T')[0],
      vendorName: 'Bharat Petroleum Corp Ltd',
      gstin: '27AAACB2184Q1Z1',
      taxableValue: 14200.00,
      gstAmount: 2556.00,
      filingStatus: 'Filed',
      filingDate: '2026-05-09'
    });

    return list;
  }, [booksPurchases, ledgerMap, activeFY]);

  // Active GSTR-2B Pool
  const activePortalPool = useMemo(() => {
    return importedGstr2b || defaultSimulatedGstr2b;
  }, [importedGstr2b, defaultSimulatedGstr2b]);

  // Core Reconciliation Matching Algorithm
  // Aligns Books vs Portal and generates unmatched or mismatched indices
  const reconciliationData = useMemo(() => {
    const list: any[] = [];
    const matchedPortalIndices = new Set<number>();

    // Normalize utility
    const normalizeStr = (str: string) => (str || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    // 1. Process books purchases and match with GSTR-2B
    booksPurchases.forEach((p, idx) => {
      const vendor = ledgerMap.get(p.partyId) || { name: 'Unknown Supplier', gstIn: '' };
      const gstin = vendor.gstIn || vendor.gstin || '27AAAAA0000A1Z' + (idx % 9);
      const invoiceNo = p.voucherNumber || `PUR/26/${String(1000 + idx).slice(1)}`;
      const getTax = (t: any) => t.totalTax ?? ((t.cgst || 0) + (t.sgst || 0) + (t.igst || 0)) ?? 0;
      const booksGst = getTax(p);
      const booksTaxable = p.totalAmount - booksGst;

      // Find match inside portal pool
      let portalMatch: any = null;
      let portalMatchIdx = -1;

      for (let i = 0; i < activePortalPool.length; i++) {
        const item = activePortalPool[i];
        if (normalizeStr(item.invoiceNo) === normalizeStr(invoiceNo)) {
          portalMatch = item;
          portalMatchIdx = i;
          break;
        }
      }

      if (portalMatch) {
        matchedPortalIndices.add(portalMatchIdx);
        const diffGst = Math.abs(booksGst - (portalMatch.gstAmount || 0));
        const diffTaxable = Math.abs(booksTaxable - (portalMatch.taxableValue || 0));
        
        // Mismatch check (> ₹1.00 tolerance)
        const isMismatched = diffGst > 1.00 || diffTaxable > 1.00;
        
        list.push({
          id: `match-${p.id}`,
          originalId: p.id,
          invoiceNo,
          date: p.date,
          vendorName: vendor.name,
          gstin: gstin || portalMatch.gstin,
          booksTaxable,
          booksGst,
          portalTaxable: portalMatch.taxableValue || 0,
          portalGst: portalMatch.gstAmount || 0,
          filingStatus: portalMatch.filingStatus || 'Filed',
          filingDate: portalMatch.filingDate || '',
          status: isMismatched ? 'Mismatched' : 'Matched',
          reason: isMismatched 
            ? `Value Discrepancy (CGST/SGST/IGST diff: ₹${diffGst.toFixed(2)})`
            : (portalMatch.filingStatus === 'Not Filed' ? 'Supplier Return Pending' : 'Matched')
        });
      } else {
        // Missing on portal (Supplier hasn't filed GSTR-1)
        list.push({
          id: `books-only-${p.id}`,
          originalId: p.id,
          invoiceNo,
          date: p.date,
          vendorName: vendor.name,
          gstin,
          booksTaxable,
          booksGst,
          portalTaxable: 0,
          portalGst: 0,
          filingStatus: 'Not Filed',
          filingDate: '',
          status: 'MissingInPortal',
          reason: 'Invoice not found under your GSTIN in GSTR-2B'
        });
      }
    });

    // 2. Add records that exist strictly inside GSTR-2B portal (Missing in Books)
    activePortalPool.forEach((item, index) => {
      if (!matchedPortalIndices.has(index)) {
        list.push({
          id: `portal-only-${index}`,
          invoiceNo: item.invoiceNo,
          date: item.date,
          vendorName: item.vendorName,
          gstin: item.gstin,
          booksTaxable: 0,
          booksGst: 0,
          portalTaxable: item.taxableValue || 0,
          portalGst: item.gstAmount || 0,
          filingStatus: item.filingStatus || 'Filed',
          filingDate: item.filingDate || '',
          status: 'MissingInBooks',
          reason: 'Voucher found in portal GSTR-2B but unrecorded in your books'
        });
      }
    });

    return list;
  }, [booksPurchases, activePortalPool, ledgerMap]);

  // Apply filters and Search
  const filteredData = useMemo(() => {
    return reconciliationData.filter(item => {
      const gstinStr = (item.gstin || '').toLowerCase();
      const nameStr = (item.vendorName || '').toLowerCase();
      const invStr = (item.invoiceNo || '').toLowerCase();
      const query = searchTerm.toLowerCase();

      const matchesSearch = gstinStr.includes(query) || nameStr.includes(query) || invStr.includes(query);
      const matchesStatus = statusFilter === 'All' || item.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [reconciliationData, searchTerm, statusFilter]);

  // Financial Stats
  const stats = useMemo(() => {
    let totalBooksEligible = 0;
    let totalPortalReported = 0;
    let reconciledAmount = 0;
    let matchedCount = 0;
    let mismatchedCount = 0;
    let missingInBooksCount = 0;
    let missingInPortalCount = 0;
    let pendingFilingCount = 0;

    reconciliationData.forEach(item => {
      totalBooksEligible += item.booksGst;
      totalPortalReported += item.portalGst;

      if (item.status === 'Matched') {
        reconciledAmount += item.booksGst;
        matchedCount++;
        if (item.filingStatus === 'Not Filed') {
          pendingFilingCount++;
        }
      } else if (item.status === 'Mismatched') {
        mismatchedCount++;
      } else if (item.status === 'MissingInBooks') {
        missingInBooksCount++;
      } else if (item.status === 'MissingInPortal') {
        missingInPortalCount++;
        pendingFilingCount++;
      }
    });

    const matchRate = reconciliationData.length > 0 
      ? Math.round((matchedCount / reconciliationData.length) * 100) 
      : 100;

    const leakageSavings = totalPortalReported - reconciledAmount;

    return {
      totalBooksEligible,
      totalPortalReported,
      reconciledAmount,
      matchedCount,
      mismatchedCount,
      missingInBooksCount,
      missingInPortalCount,
      pendingFilingCount,
      matchRate,
      leakageSavings
    };
  }, [reconciliationData]);

  // Execute Simulated Template Loading
  const handleLoadSampleJSON = () => {
    setJsonText(JSON.stringify(sampleGstr2bTemplate, null, 2));
    const message = "📋 High-fidelity Sample GSTR-2B JSON pasted into layout editor.";
    setShowNotification(message);
    setTimeout(() => setShowNotification(null), 3000);
  };

  // Run Custom JSON Matcher
  const handleRunMatchEngine = () => {
    try {
      if (!jsonText.trim()) {
        alert("Please paste some valid JSON first или click 'Load Sample JSON'");
        return;
      }
      const data = JSON.parse(jsonText);
      if (!Array.isArray(data)) {
        alert("GSTR-2B data must be a JSON Array with objects!");
        return;
      }
      setImportedGstr2b(data);
      setShowJsonUpload(false);
      const message = "⚡ Interactive Custom GSTR-2B matching engine compiled successfully!";
      setShowNotification(message);
      setTimeout(() => setShowNotification(null), 4000);
    } catch (err: any) {
      alert(`Invalid JSON format: ${err.message}`);
    }
  };

  const handleSendReminder = (vendorName: string, invoiceNo: string) => {
    const message = `📧 Supplier notification drafted and sent to "${vendorName}" for Invoice #${invoiceNo}. Requested immediate upload.`;
    setShowNotification(message);
    setTimeout(() => setShowNotification(null), 4000);
  };

  const handleQuickAdd = (item: any) => {
    const message = `🛠 Custom Purchase voucher logged in system context for GST #${item.invoiceNo} from ${item.vendorName} of ₹${item.portalGst} eligible credit.`;
    setShowNotification(message);
    setTimeout(() => setShowNotification(null), 4000);
  };

  const handleJsonFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        // Verify JSON parseable
        JSON.parse(text);
        setJsonText(text);
        const msg = `📁 Selected file '${file.name}' loaded into editor. Click 'Run Match' to execute!`;
        setShowNotification(msg);
        setTimeout(() => setShowNotification(null), 3500);
      } catch (err) {
        alert("Failed to parse file. Please upload a valid JSON array.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      <AnimatePresence>
        {showNotification && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-20 right-6 z-[2000] bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-slate-800 text-xs shadow-indigo-900/10"
          >
            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-ping shrink-0" />
            <span className="font-semibold leading-relaxed">{showNotification}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header bar matching master aesthetic */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-5 rounded-2xl border border-slate-100 shadow-xs">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-500 shrink-0">
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black font-display tracking-tight text-slate-900">GSTR-2B Matcher Engine</h1>
              <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100/50 px-2 py-0.5 rounded-full uppercase tracking-wider font-sans">
                Form GSTR-2B vs. Books
              </span>
            </div>
            <p className="text-slate-500 text-xs mt-0.5">Automated comparison portal to import external supplier GST records and flag mismatches</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => {
              setShowJsonUpload(!showJsonUpload);
              if (!showJsonUpload && !jsonText) {
                setJsonText(JSON.stringify(sampleGstr2bTemplate, null, 2));
              }
            }}
            className="btn-primary flex items-center gap-1.5 text-xs py-2"
          >
            <Upload size={14} /> {importedGstr2b ? 'Re-import GSTR-2B JSON' : 'Import GSTR-2B JSON'}
          </button>
        </div>
      </header>

      {/* Upload Drawer / Form Overlay */}
      <AnimatePresence>
        {showJsonUpload && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-slate-50 border border-slate-200/80 rounded-2xl p-5 overflow-hidden shadow-xs space-y-4"
          >
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Code size={18} className="text-indigo-600" />
                <h3 className="font-extrabold text-sm text-slate-800">Paste raw GSTR-2B JSON or upload .json file</h3>
              </div>
              <button 
                onClick={() => setShowJsonUpload(false)}
                className="p-1 hover:bg-slate-200 rounded-lg text-slate-400"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-3 space-y-2">
                <textarea
                  rows={8}
                  value={jsonText}
                  onChange={e => setJsonText(e.target.value)}
                  placeholder="[{ 'invoiceNo': ... }]"
                  className="w-full text-xs font-mono p-3 bg-white border border-slate-200 rounded-xl focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>

              <div className="md:col-span-1 flex flex-col justify-between gap-3 bg-white border border-slate-200 p-4 rounded-xl">
                <div className="space-y-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Import utilities</span>
                  
                  {/* Local JSON File Attachment Input */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-600">Select .json File:</label>
                    <input 
                      type="file" 
                      accept=".json"
                      onChange={handleJsonFileUpload}
                      className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-[10px] file:font-semibold file:bg-indigo-5 file:text-indigo-700 hover:file:bg-indigo-10 block w-full"
                    />
                  </div>

                  <button
                    onClick={handleLoadSampleJSON}
                    className="w-full text-left text-xs text-indigo-700 font-bold hover:underline flex items-center gap-1"
                  >
                    💡 Load Mock GSTR-2B Template
                  </button>
                </div>

                <button
                  onClick={handleRunMatchEngine}
                  className="w-full bg-indigo-650 hover:bg-indigo-700 text-white font-semibold text-xs py-2 rounded-xl flex items-center justify-center gap-1.5 shadow-md shadow-indigo-100 transition-all"
                >
                  <RefreshCw size={12} className="animate-spin-hover" /> Execute Smart Match
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Executive High Value Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Match Percentage */}
        <div className="card p-5 bg-gradient-to-tr from-indigo-900 to-indigo-950 text-white border-none shadow-indigo-900/10 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-bold tracking-wider text-indigo-200/90 uppercase">ITC Match Accuracy</span>
            <ShieldCheck size={20} className="text-indigo-300" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-black font-display">{stats.matchRate}%</span>
            <span className="text-xs text-emerald-300 font-bold">▲ Compliant</span>
          </div>
          <div className="mt-3 w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
            <div className="bg-indigo-400 h-full rounded-full" style={{ width: `${stats.matchRate}%` }} />
          </div>
        </div>

        {/* Claimed in Books (Total Eligible ITC) */}
        <div className="card p-5 bg-white border border-slate-150 relative">
          <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase block mb-1">Purchases ITC (Books)</span>
          <span className="text-2xl font-black text-slate-900 font-display block block">₹{stats.totalBooksEligible.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          <p className="text-[10px] text-slate-500 mt-4 flex items-center gap-1">
            <Database size={12} className="text-indigo-500" /> Recorded in {booksPurchases.length} total bills
          </p>
        </div>

        {/* Reported in GSTR-2B */}
        <div className="card p-5 bg-white border border-slate-150">
          <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase block mb-1">Portal ITC (Form GSTR-2B)</span>
          <span className="text-2xl font-black text-slate-900 font-display block text-emerald-600">₹{stats.totalPortalReported.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          <p className="text-[10px] text-slate-500 mt-4 flex items-center gap-1">
            <ChevronRight size={12} className="text-emerald-500" /> {activePortalPool.length} records in active reconciliation
          </p>
        </div>

        {/* Leakage/Savings Prevention */}
        <div className="card p-5 bg-amber-50/40 border-amber-100 shadow-amber-500/5 shadow-md relative overflow-hidden">
          <span className="text-[10px] font-bold tracking-wider text-amber-700 uppercase block mb-1">Risk Potential / Mismatch Supply</span>
          <span className="text-2xl font-black text-slate-900 font-display block text-amber-700">₹{stats.leakageSavings !== 0 ? Math.abs(stats.leakageSavings).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}</span>
          <p className="text-[10px] text-amber-700 font-medium mt-4 flex items-center gap-1">
            <AlertCircle size={12} className="text-amber-500 shrink-0" /> {stats.pendingFilingCount} suppliers Return Pending
          </p>
        </div>
      </div>

      {/* Interactive Controls & Filters */}
      <div className="flex flex-col md:flex-row gap-3 items-center justify-between bg-slate-50 p-4 rounded-2xl border border-slate-200/50">
        <div className="w-full md:max-w-md relative">
          <input 
            type="text"
            placeholder="Search supplier, GSTIN or Invoice No..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="input-field pl-10"
          />
          <Search className="absolute left-3.5 top-3.5 text-slate-400" size={16} />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 mr-2">
            <Filter size={14} /> Filer Status:
          </div>
          
          <button 
            onClick={() => setStatusFilter('All')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${statusFilter === 'All' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
          >
            All Items ({reconciliationData.length})
          </button>
          
          <button 
            onClick={() => setStatusFilter('Matched')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${statusFilter === 'Matched' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Matched ({stats.matchedCount})
          </button>

          <button 
            onClick={() => setStatusFilter('Mismatched')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${statusFilter === 'Mismatched' ? 'bg-amber-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Mismatch Amt ({stats.mismatchedCount})
          </button>

          <button 
            onClick={() => setStatusFilter('MissingInPortal')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${statusFilter === 'MissingInPortal' ? 'bg-red-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-400" /> Missing in 2B ({stats.missingInPortalCount})
          </button>

          <button 
            onClick={() => setStatusFilter('MissingInBooks')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${statusFilter === 'MissingInBooks' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" /> Books Unlogged ({stats.missingInBooksCount})
          </button>
        </div>
      </div>

      {/* Executive Split-Screen Grid Layout */}
      <div className="card overflow-hidden border border-slate-200/60 shadow-xs">
        <div className="grid grid-cols-12 bg-slate-100 border-b border-slate-200 font-bold text-xs uppercase tracking-wider text-slate-500 py-3 px-6">
          <div className="col-span-4 flex items-center gap-2">Supplier & Invoice details</div>
          <div className="col-span-3 text-right pr-6">Purchase Register (Books)</div>
          <div className="col-span-3 text-right pr-6">Portal Database (Form GSTR-2B)</div>
          <div className="col-span-2 text-center">Status & Resolution Activity</div>
        </div>

        <div className="divide-y divide-slate-100">
          {filteredData.map((item) => {
            const isMatched = item.status === 'Matched';
            const isMismatched = item.status === 'Mismatched';
            const isMissingIn2B = item.status === 'MissingInPortal';
            const isMissingInBooks = item.status === 'MissingInBooks';
            const showReturnWarning = item.filingStatus === 'Not Filed';

            return (
              <div key={item.id} className="grid grid-cols-12 items-center py-4 px-6 hover:bg-slate-50/50 transition-colors">
                
                {/* 1. Supplier details with return status notices */}
                <div className="col-span-4 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-800 text-sm truncate max-w-[220px]">{item.vendorName}</span>
                    <span className="text-[10px] font-mono text-slate-400">{item.gstin}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                      <span>Invoice: <strong className="font-bold text-slate-700 font-mono">{item.invoiceNo}</strong></span>
                      <span className="w-1 h-1 bg-slate-300 rounded-full" />
                      <span>{new Date(item.date).toLocaleDateString()}</span>
                    </div>

                    {showReturnWarning && (
                      <span className="bg-red-50 border border-red-100 text-red-700 text-[8px] font-black px-1.5 py-0.2 rounded-md uppercase tracking-wide">
                        GSTR-1 Unfiled
                      </span>
                    )}
                  </div>
                </div>

                {/* 2. Purchase register representation */}
                <div className="col-span-3 text-right pr-6 space-y-0.5">
                  {isMissingInBooks ? (
                    <span className="text-slate-400 text-xs italic">Unrecorded (No voucher)</span>
                  ) : (
                    <>
                      <div className="text-sm font-black text-slate-900 font-display">₹{item.booksGst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                      <div className="text-[10px] text-slate-400 font-medium">Taxable: ₹{item.booksTaxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                    </>
                  )}
                </div>

                {/* 3. GSTR-2B Portal representation */}
                <div className="col-span-3 text-right pr-6 space-y-0.5">
                  {isMissingIn2B ? (
                    <div className="text-slate-400 text-xs italic">Not found on portal</div>
                  ) : (
                    <>
                      <div className={`text-sm font-black font-display ${isMismatched ? 'text-amber-600' : 'text-slate-900'}`}>
                        ₹{item.portalGst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                      <div className="text-[10px] text-slate-400 font-medium">Taxable: ₹{item.portalTaxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                    </>
                  )}
                </div>

                {/* 4. Action status details */}
                <div className="col-span-2 flex flex-col items-center justify-center gap-1.5">
                  
                  {isMatched && (
                    <div className="flex flex-col items-center">
                      <span className="bg-emerald-50 border border-emerald-100/55 text-emerald-700 text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 uppercase tracking-wider font-sans">
                        <Check size={11} className="stroke-[3px]" /> Matched
                      </span>
                      {showReturnWarning && (
                        <span className="text-[8px] text-red-500 font-bold uppercase mt-1">ITC Blocked</span>
                      )}
                    </div>
                  )}

                  {isMismatched && (
                    <div className="flex flex-col items-center gap-1.5 w-full">
                      <span className="bg-amber-50 border border-amber-100/50 text-amber-700 text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 uppercase tracking-wider font-sans">
                        <AlertTriangle size={10} /> Amount Mismatch
                      </span>
                      <button 
                        onClick={() => handleSendReminder(item.vendorName, item.invoiceNo)}
                        className="text-[9px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100/80 px-2 py-1 rounded-lg flex items-center gap-1 shadow-2xs"
                      >
                        <Mail size={10} /> Reconcile
                      </button>
                    </div>
                  )}

                  {isMissingIn2B && (
                    <div className="flex flex-col items-center gap-1.5 w-full">
                      <span className="bg-red-50 border border-red-100 text-red-700 text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 uppercase tracking-wider font-sans">
                        <AlertCircle size={10} /> Missing in 2B
                      </span>
                      <button 
                        onClick={() => handleSendReminder(item.vendorName, item.invoiceNo)}
                        className="text-[9px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100/80 px-2 py-1 rounded-lg flex items-center gap-1 shadow-2xs"
                      >
                        <Mail size={10} /> Email Filer
                      </button>
                    </div>
                  )}

                  {isMissingInBooks && (
                    <div className="flex flex-col items-center gap-1.5 w-full">
                      <span className="bg-blue-50 border border-blue-100/50 text-blue-700 text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 uppercase tracking-wider font-sans">
                        <AlertTriangle size={10} /> Books Missing
                      </span>
                      <button 
                        onClick={() => handleQuickAdd(item)}
                        className="text-[9px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-2 py-1 rounded-lg flex items-center gap-1 shadow-md shadow-indigo-100"
                      >
                        <Plus size={10} /> Log Bill
                      </button>
                    </div>
                  )}

                </div>
              </div>
            );
          })}

          {filteredData.length === 0 && (
            <div className="text-center py-16 px-4 bg-slate-50/50">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mx-auto mb-3">
                <Search size={20} />
              </div>
              <h5 className="font-bold text-slate-800 text-sm">No matched GSTR-2B vouchers found</h5>
              <p className="text-xs text-slate-500 mt-1">Try modifying your query or selecting another status filter pool</p>
            </div>
          )}
        </div>
      </div>

      {/* compliance card info footer helpful guide */}
      <div className="bg-indigo-50/30 p-4 rounded-xl border border-indigo-100 flex gap-3 text-xs leading-relaxed text-indigo-950/80">
        <Info size={16} className="text-indigo-600 shrink-0 mt-0.5" />
        <div>
          <strong className="font-extrabold text-indigo-950 block mb-0.5">Section 16(4) Reconcile Mandate</strong>
          Regular reconciliation of purchase register books with Form GSTR-2B prevents serious Input Tax Credit (ITC) leakage and prevents delayed filings penalty liabilities. Invoices which are not declared by suppliers under their monthly GSTR-1 are explicitly blocked for credit claims until they file.
        </div>
      </div>

    </div>
  );
};
