import React, { useState, useMemo } from 'react';
import { 
  ArrowLeft, 
  Search, 
  Calendar, 
  Mail, 
  MessageSquare, 
  Copy, 
  Check, 
  Send, 
  Phone, 
  TrendingUp, 
  Clock, 
  AlertCircle,
  FileText,
  ChevronRight,
  ShieldAlert,
  Info,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface DebtorsAgeingProps {
  company: any;
  transactions: any[];
  ledgers: any[];
  activeFY: any;
  onBack: () => void;
}

export const DebtorsAgeing = ({ company, transactions, ledgers, activeFY, onBack }: DebtorsAgeingProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDebtor, setSelectedDebtor] = useState<any | null>(null);
  const [reminderType, setReminderType] = useState<'friendly' | 'formal' | 'urgent'>('friendly');
  const [copiedType, setCopiedType] = useState<'whatsapp' | 'email' | null>(null);
  const [referenceDate, setReferenceDate] = useState('2026-05-24'); // Match default UTC local time context

  // 1. Filter out Sundry Debtors who have a debit (positive) balance
  const debtorsList = useMemo(() => {
    return ledgers.filter(l => l.group === 'Sundry Debtors' && (l.currentBalance || 0) > 0);
  }, [ledgers]);

  // 2. Perform extreme-precision FIFO ageing calculation for each debtor
  const ageingDetails = useMemo(() => {
    const ref = new Date(referenceDate);
    
    return debtorsList.map(debtor => {
      // Find all sales transactions for this debtor
      const sales = transactions
        .filter(t => (t.partyId === debtor.id || t.partyName === debtor.name) && (t.type === 'Sales' || t.type === 'Sale'))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // Sort newest first

      let remainingBalance = debtor.currentBalance || 0;
      
      let bucketUnder30 = 0;
      let bucket30to60 = 0;
      let bucket60to90 = 0;
      let bucketOver90 = 0;

      const matchedInvoices: any[] = [];

      sales.forEach(inv => {
        if (remainingBalance <= 0) return;

        const invAmount = inv.totalAmount || 0;
        const allocated = Math.min(remainingBalance, invAmount);
        
        const invDate = new Date(inv.date);
        const diffTime = Math.abs(ref.getTime() - invDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 30) {
          bucketUnder30 += allocated;
        } else if (diffDays <= 60) {
          bucket30to60 += allocated;
        } else if (diffDays <= 90) {
          bucket60to90 += allocated;
        } else {
          bucketOver90 += allocated;
        }

        matchedInvoices.push({
          voucherNumber: inv.voucherNumber || 'Direct Invoice',
          date: inv.date,
          amount: invAmount,
          allocated,
          daysOverdue: diffDays,
          status: remainingBalance >= invAmount ? 'Unpaid' : 'Partially Paid'
        });

        remainingBalance -= allocated;
      });

      // If there is still outstanding balance (e.g. historical opening balance), attribute to the oldest bucket
      if (remainingBalance > 0) {
        bucketOver90 += remainingBalance;
      }

      const maxSect = Math.max(bucketUnder30, bucket30to60, bucket60to90, bucketOver90);
      let riskLevel: 'low' | 'medium' | 'high' = 'low';
      if (bucketOver90 > 0 || bucket60to90 > (debtor.currentBalance * 0.4)) {
        riskLevel = 'high';
      } else if (bucket30to60 > (debtor.currentBalance * 0.5)) {
        riskLevel = 'medium';
      }

      return {
        ...debtor,
        bucketUnder30,
        bucket30to60,
        bucket60to90,
        bucketOver90,
        salesInvoices: matchedInvoices,
        riskLevel,
        phone: debtor.phone || debtor.mobile || '919876543210' // simulated defaults
      };
    });
  }, [debtorsList, transactions, referenceDate]);

  // Apply search filtering on debtors list
  const filteredDebtors = useMemo(() => {
    return ageingDetails.filter(d => 
      d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (d.phone && d.phone.includes(searchTerm))
    );
  }, [ageingDetails, searchTerm]);

  // High Value Aggregate Statistics
  const summaryStats = useMemo(() => {
    let totalOutstanding = 0;
    let totalUnder30 = 0;
    let total30to60 = 0;
    let total60to90 = 0;
    let totalOver90 = 0;

    ageingDetails.forEach(d => {
      totalOutstanding += d.currentBalance || 0;
      totalUnder30 += d.bucketUnder30;
      total30to60 += d.bucket30to60;
      total60to90 += d.bucket60to90;
      totalOver90 += d.bucketOver90;
    });

    return {
      totalOutstanding,
      totalUnder30,
      total30to60,
      total60to90,
      totalOver90,
      under30Pct: totalOutstanding > 0 ? Math.round((totalUnder30 / totalOutstanding) * 100) : 0,
      threeToSixPct: totalOutstanding > 0 ? Math.round((total30to60 / totalOutstanding) * 100) : 0,
      sixToNinePct: totalOutstanding > 0 ? Math.round((total60to90 / totalOutstanding) * 100) : 0,
      overNinetyPct: totalOutstanding > 0 ? Math.round((totalOver90 / totalOutstanding) * 100) : 0,
    };
  }, [ageingDetails]);

  // Payment Reminder Context Generators (WhatsApp & email)
  const reminderTemplates = useMemo(() => {
    if (!selectedDebtor) return { whatsapp: '', emailSubject: '', emailBody: '' };

    const debtorName = selectedDebtor.name;
    const balance = selectedDebtor.currentBalance?.toLocaleString('en-IN', { minimumFractionDigits: 2 });
    const companyName = company?.name || 'our company';
    const over90Balance = selectedDebtor.bucketOver90?.toLocaleString('en-IN', { minimumFractionDigits: 2 });
    
    // Detailed list of bills overdue
    const overdueBillsText = selectedDebtor.salesInvoices
      .slice(0, 3)
      .map((inv: any) => `Invoice #${inv.voucherNumber} (${new Date(inv.date).toLocaleDateString()}) - ₹${inv.amount.toLocaleString()} [${inv.daysOverdue} Days Overdue]`)
      .join('\n');

    let whatsapp = '';
    let emailSubject = '';
    let emailBody = '';

    if (reminderType === 'friendly') {
      whatsapp = `Dear ${debtorName},\n\nHope you are doing well. This is a friendly reminder regarding your outstanding balance with *${companyName}* of *₹${balance}*.\n\nWe appreciate your business & kindly request you to clear the payment at your earliest convenience. Thank you!\n\nBest Regards,\n${companyName}`;
      emailSubject = `Friendly Reminder: Outstanding Account Balance at ${companyName}`;
      emailBody = `Dear ${debtorName},\n\nI hope this email finds you well.\n\nThis is a friendly reminder that there is an outstanding balance of Rs. ${balance} on your account with ${companyName}.\n\nOverdue invoices:\n${overdueBillsText}\n\nWe would appreciate it if you could verify these records and schedule the payment at your earliest convenience.\n\nThank you for your business and partnership.\n\nSincerely,\nAccounts Team\n${companyName}`;
    } else if (reminderType === 'formal') {
      whatsapp = `Dear ${debtorName},\n\nThis is to notify you regarding your outstanding dues of *₹${balance}* for invoices past their credit period with *${companyName}*.\n\nKindly process the payment within 3 business days and share the transaction receipt with us.\n\nBest Regards,\n${companyName}`;
      emailSubject = `URGENT STATEMENT: Overdue Account Dues - ${companyName}`;
      emailBody = `Dear ${debtorName},\n\nWe are writing to bring your attention to your account's outstanding dues totaling Rs. ${balance}.\n\nThese invoices have now exceeded our standard credit period:\n${overdueBillsText}\n\nKindly prioritize this invoice settlement. Please confirm the transaction details or transaction ID once settlement has been processed.\n\nIf you have any queries about these details, feel free to reach out to our desk.\n\nRegards,\nFinance & Accounts\n${companyName}`;
    } else {
      whatsapp = `⚠️ *URGENT NOTICE* ⚠️\nDear ${debtorName},\n\nDespite previous reminders, your balance of *₹${balance}* remains heavily overdue. Of this, *₹${over90Balance}* has crossed 90 days.\n\nKindly note that failure to clear this immediate ledger discrepancy could impact your credit terms & line.\n\nRegards,\nFinance Team, ${companyName}`;
      emailSubject = `FINAL DEMAND: Severely Overdue Balance - ${companyName}`;
      emailBody = `Dear ${debtorName},\n\nWARNING: FINAL REMINDER\n\nYour account shows a persistent, heavily overdue balance of Rs. ${balance} which remains unpaid despite multiple payment notifications.\n\nA significant portion (Rs. ${over90Balance}) has now exceeded 90 Days overdue:\n${overdueBillsText}\n\nPlease settle this account balance immediately to prevent suspension of services and collection actions.\n\nPlease reply with proof of transaction immediately.\n\nSincerely,\nHead of Credit Control\n${companyName}`;
    }

    return { whatsapp, emailSubject, emailBody };
  }, [selectedDebtor, reminderType, company]);

  const handleCopy = (text: string, type: 'whatsapp' | 'email') => {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2500);
  };

  const handleSendWhatsApp = (phone: string, text: string) => {
    const formattedPhone = phone.replace(/[^0-9]/g, '');
    const url = `https://api.whatsapp.com/send?phone=${formattedPhone}&text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const handleSendEmail = (subject: string, body: string) => {
    const url = `mailto:${selectedDebtor?.email || 'accounts@client.com'}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(url);
  };

  // Export PDF Ageing Report
  const handleExportPDF = () => {
    const doc = new jsPDF() as any;
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("DEBTORS AGEING ANALYSIS REPORT", 105, 18, { align: "center" });
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Company: ${company?.name || 'Our Company'}`, 14, 28);
    doc.text(`As on Reference Date: ${new Date(referenceDate).toLocaleDateString()}`, 14, 34);
    
    const tableRows: any[] = [];
    filteredDebtors.forEach((d, index) => {
      tableRows.push([
        index + 1,
        d.name,
        `Rs. ${(d.bucketUnder30 || 0).toFixed(2)}`,
        `Rs. ${(d.bucket30to60 || 0).toFixed(2)}`,
        `Rs. ${(d.bucket60to90 || 0).toFixed(2)}`,
        `Rs. ${(d.bucketOver90 || 0).toFixed(2)}`,
        `Rs. ${(d.currentBalance || 0).toFixed(2)}`,
        d.riskLevel.toUpperCase()
      ]);
    });

    autoTable(doc, {
      startY: 40,
      head: [['#', 'Customer Name', '< 30 Days', '30-40 Days', '60-90 Days', '> 90 Days', 'Total O/S', 'Risk']],
      body: tableRows,
      theme: 'grid',
      headStyles: { fillColor: [79, 70, 229] },
      columnStyles: {
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right' }
      }
    });

    doc.save(`Debtors_Ageing_Report_${referenceDate}.pdf`);
  };

  return (
    <div className="space-y-6">
      {/* Header bar matching standard polished dashboard aesthetics */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-5 rounded-2xl border border-slate-100 shadow-xs">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-500 shrink-0">
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black font-display tracking-tight text-slate-900">Debtors Ageing Schedule</h1>
              <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-100/50 px-2 py-0.5 rounded-full uppercase tracking-wider font-sans">
                Outstanding Accounts Receivable
              </span>
            </div>
            <p className="text-slate-500 text-xs mt-0.5">FIFO chronological receivables ageing categorization for liquidity tracking</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Reference Date Controller */}
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl">
            <Calendar size={14} className="text-slate-400" />
            <span className="text-xs font-semibold text-slate-500">Ageing Date:</span>
            <input 
              type="date" 
              value={referenceDate}
              onChange={e => setReferenceDate(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-800 focus:outline-hidden"
            />
          </div>
          
          <button 
            onClick={handleExportPDF}
            className="btn-secondary text-xs flex items-center gap-1.5 !py-2"
          >
            <Download size={14} /> Export PDF
          </button>
        </div>
      </header>

      {/* Grid distribution visualization metrics */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {/* Total O/S Box */}
        <div className="card p-5 bg-gradient-to-tr from-slate-900 to-slate-950 text-white border-none shadow-lg">
          <span className="text-[10px] font-bold tracking-wider text-slate-300 uppercase block mb-1">Total Outstanding Dues</span>
          <span className="text-3xl font-black font-display block">₹{summaryStats.totalOutstanding.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          <div className="mt-4 flex items-center gap-1.5 text-xs text-rose-300">
            <TrendingUp size={14} />
            <span className="font-semibold">{debtorsList.length} Active Dr. Accounts</span>
          </div>
        </div>

        {/* < 30 Days */}
        <div className="card p-5 bg-white border border-slate-150 relative">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Current ( &lt; 30 Days )</span>
            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.2 rounded-md">{summaryStats.under30Pct}%</span>
          </div>
          <span className="text-xl font-bold text-slate-900 block font-display">₹{summaryStats.totalUnder30.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          <div className="mt-4 w-full bg-slate-100 rounded-full h-1 overflow-hidden">
            <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${summaryStats.under30Pct}%` }} />
          </div>
        </div>

        {/* 30 - 60 Days */}
        <div className="card p-5 bg-white border border-slate-150 relative">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">30 – 60 Days Out</span>
            <span className="text-xs font-bold text-amber-600 bg-amber-50 px-1.5 py-0.2 rounded-md">{summaryStats.threeToSixPct}%</span>
          </div>
          <span className="text-xl font-bold text-slate-900 block font-display">₹{summaryStats.total30to60.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          <div className="mt-4 w-full bg-slate-100 rounded-full h-1 overflow-hidden">
            <div className="bg-amber-500 h-full rounded-full" style={{ width: `${summaryStats.threeToSixPct}%` }} />
          </div>
        </div>

        {/* 60 - 90 Days */}
        <div className="card p-5 bg-white border border-slate-150 relative">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">60 – 90 Days Out</span>
            <span className="text-xs font-bold text-orange-600 bg-orange-50 px-1.5 py-0.2 rounded-md">{summaryStats.sixToNinePct}%</span>
          </div>
          <span className="text-xl font-bold text-slate-900 block font-display">₹{summaryStats.total60to90.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          <div className="mt-4 w-full bg-slate-100 rounded-full h-1 overflow-hidden">
            <div className="bg-orange-500 h-full rounded-full" style={{ width: `${summaryStats.sixToNinePct}%` }} />
          </div>
        </div>

        {/* > 90 Days */}
        <div className="card p-5 bg-rose-50/50 border-rose-100 relative">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] font-bold tracking-wider text-rose-600 uppercase">Severely Overdue (&gt;90d)</span>
            <span className="text-xs font-bold text-rose-700 bg-rose-50 px-1.5 py-0.2 rounded-md">{summaryStats.overNinetyPct}%</span>
          </div>
          <span className="text-xl font-black text-rose-700 block font-display">₹{summaryStats.totalOver90.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          <div className="mt-4 w-full bg-rose-100 rounded-full h-1.5 overflow-hidden">
            <div className="bg-rose-600 h-full rounded-full" style={{ width: `${summaryStats.overNinetyPct}%` }} />
          </div>
        </div>
      </div>

      {/* Main Grid View */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Debtor lists layout */}
        <div className="md:col-span-2 space-y-4">
          
          <div className="flex items-center gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200/50">
            <div className="relative w-full">
              <input 
                type="text"
                placeholder="Search Debtor Accounts..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="input-field pl-10"
              />
              <Search className="absolute left-3.5 top-3.5 text-slate-400" size={16} />
            </div>
          </div>

          <div className="card overflow-hidden border border-slate-200/60 shadow-xs">
            <div className="grid grid-cols-12 bg-slate-100 border-b border-slate-200 font-bold text-[11px] uppercase tracking-wider text-slate-500 py-3 px-4">
              <div className="col-span-4">Debtor Party</div>
              <div className="col-span-2 text-right">&lt; 30d</div>
              <div className="col-span-2 text-right">30-60d</div>
              <div className="col-span-2 text-right">60-90d</div>
              <div className="col-span-2 text-right">&gt; 90d</div>
            </div>

            <div className="divide-y divide-slate-100">
              {filteredDebtors.map(debtor => (
                <div 
                  key={debtor.id}
                  onClick={() => setSelectedDebtor(debtor)}
                  className={`grid grid-cols-12 items-center py-4 px-4 hover:bg-indigo-50/20 cursor-pointer transition-colors ${selectedDebtor?.id === debtor.id ? 'bg-indigo-50/40 border-l-[3px] border-indigo-600 pl-3.2' : ''}`}
                >
                  <div className="col-span-4 space-y-0.5">
                    <span className="font-bold text-slate-800 text-sm truncate block">{debtor.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 font-medium">O/S: <strong className="font-bold text-slate-700">₹{debtor.currentBalance?.toLocaleString()}</strong></span>
                      {debtor.riskLevel === 'high' && (
                        <span className="bg-rose-50 border border-rose-100 text-rose-700 text-[8px] font-extrabold px-1.5 py-0.2 rounded-md uppercase tracking-wide">High Risk</span>
                      )}
                    </div>
                  </div>
                  
                  <div className="col-span-2 text-right text-sm font-medium text-slate-600">
                    {debtor.bucketUnder30 > 0 ? `₹${Math.round(debtor.bucketUnder30).toLocaleString()}` : '—'}
                  </div>
                  <div className="col-span-2 text-right text-sm font-medium text-slate-600">
                    {debtor.bucket30to60 > 0 ? `₹${Math.round(debtor.bucket30to60).toLocaleString()}` : '—'}
                  </div>
                  <div className="col-span-2 text-right text-sm font-medium text-slate-600">
                    {debtor.bucket60to90 > 0 ? `₹${Math.round(debtor.bucket60to90).toLocaleString()}` : '—'}
                  </div>
                  <div className="col-span-2 text-right text-sm font-black text-rose-700 font-display">
                    {debtor.bucketOver90 > 0 ? `₹${Math.round(debtor.bucketOver90).toLocaleString()}` : '—'}
                  </div>
                </div>
              ))}

              {filteredDebtors.length === 0 && (
                <div className="text-center py-16 px-4 bg-slate-50/50">
                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mx-auto mb-3">
                    <Search size={20} />
                  </div>
                  <h5 className="font-bold text-slate-800 text-sm">No debtor balances found</h5>
                  <p className="text-xs text-slate-500 mt-1">Check search query or adjust your reference ageing date</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar Panel for interactive templates drawer */}
        <div className="md:col-span-1">
          <AnimatePresence mode="wait">
            {selectedDebtor ? (
              <motion.div 
                key={selectedDebtor.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-white border border-slate-200/50 rounded-2xl p-5 shadow-xs space-y-5"
              >
                <div>
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-extrabold text-slate-800 leading-tight">{selectedDebtor.name}</h4>
                      <p className="text-[11px] text-slate-400 font-semibold">{selectedDebtor.phone}</p>
                    </div>
                    {selectedDebtor.riskLevel === 'high' && (
                      <div className="flex items-center gap-1 bg-rose-50 border border-rose-100 text-rose-700 px-2 py-0.5 rounded-lg text-[10px] font-bold">
                        <ShieldAlert size={12} /> Critical Dues
                      </div>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-150 text-xs">
                    <div>
                      <span className="text-slate-400 font-semibold">Total Outstanding</span>
                      <strong className="block text-slate-800 font-bold">₹{selectedDebtor.currentBalance?.toLocaleString()}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 font-semibold">Over 60d</span>
                      <strong className="block text-rose-700 font-extrabold">₹{(selectedDebtor.bucket60to90 + selectedDebtor.bucketOver90)?.toLocaleString()}</strong>
                    </div>
                  </div>
                </div>

                {/* Reminder severity chooser */}
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Reminder Level</label>
                  <div className="grid grid-cols-3 gap-1 bg-slate-50 p-1 rounded-xl border border-slate-150">
                    <button
                      onClick={() => setReminderType('friendly')}
                      className={`text-[10px] font-bold py-1.5 rounded-lg transition-all ${reminderType === 'friendly' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      Friendly
                    </button>
                    <button
                      onClick={() => setReminderType('formal')}
                      className={`text-[10px] font-bold py-1.5 rounded-lg transition-all ${reminderType === 'formal' ? 'bg-indigo-650 text-white shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      Formal
                    </button>
                    <button
                      onClick={() => setReminderType('urgent')}
                      className={`text-[10px] font-bold py-1.5 rounded-lg transition-all ${reminderType === 'urgent' ? 'bg-rose-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      Urgent
                    </button>
                  </div>
                </div>

                {/* WhatsApp Template Card */}
                <div className="space-y-2 relative">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <MessageSquare size={12} className="text-emerald-500" /> WhatsApp Template
                    </span>
                    <button 
                      onClick={() => handleCopy(reminderTemplates.whatsapp, 'whatsapp')}
                      className="text-[10px] font-bold text-indigo-600 flex items-center gap-1 hover:underline"
                    >
                      {copiedType === 'whatsapp' ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                      {copiedType === 'whatsapp' ? 'Copied' : 'Copy Message'}
                    </button>
                  </div>
                  <div className="bg-emerald-50/40 border border-emerald-100/50 p-3.5 rounded-xl text-xs text-slate-700 whitespace-pre-line leading-relaxed h-[130px] overflow-y-auto font-sans">
                    {reminderTemplates.whatsapp}
                  </div>
                  <button
                    onClick={() => handleSendWhatsApp(selectedDebtor.phone, reminderTemplates.whatsapp)}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold py-2 rounded-xl flex items-center justify-center gap-2 transition-all shadow-md shadow-emerald-50"
                  >
                    <Send size={12} /> Send via WhatsApp Web
                  </button>
                </div>

                {/* Email Template Card */}
                <div className="space-y-2 relative">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <Mail size={12} className="text-indigo-500" /> Email Statement Template
                    </span>
                    <button 
                      onClick={() => handleCopy(reminderTemplates.emailBody, 'email')}
                      className="text-[10px] font-bold text-indigo-600 flex items-center gap-1 hover:underline"
                    >
                      {copiedType === 'email' ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                      {copiedType === 'email' ? 'Copied' : 'Copy Statement'}
                    </button>
                  </div>
                  <div className="bg-slate-50 border border-slate-150 p-3 rounded-xl text-xs space-y-2 h-[155px] overflow-y-auto">
                    <div className="border-b border-slate-200 pb-1.5">
                      <span className="font-bold text-slate-400 text-[10px] uppercase">Subject: </span>
                      <span className="font-semibold text-slate-700 text-xs">{reminderTemplates.emailSubject}</span>
                    </div>
                    <div className="whitespace-pre-line text-slate-650 leading-relaxed text-[11px]">
                      {reminderTemplates.emailBody}
                    </div>
                  </div>
                  <button
                    onClick={() => handleSendEmail(reminderTemplates.emailSubject, reminderTemplates.emailBody)}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold py-2 rounded-xl flex items-center justify-center gap-2 transition-all shadow-xs"
                  >
                    <Mail size={12} /> Open in Mail App
                  </button>
                </div>
              </motion.div>
            ) : (
              <div className="bg-slate-50 border border-dashed border-slate-350 rounded-2xl p-8 text-center text-slate-400 flex flex-col items-center justify-center h-[400px]">
                <Info size={32} className="text-slate-300 mb-3" />
                <h5 className="font-bold text-slate-600 text-sm">Select a Debtor Account</h5>
                <p className="text-xs text-slate-400 mt-1 max-w-[200px]">Click any debtor on the left list to instantly generate highly-targeted WhatsApp/Email recovery messages.</p>
              </div>
            )}
          </AnimatePresence>
        </div>

      </div>

      <div className="bg-indigo-50/20 p-4 rounded-xl border border-indigo-100 flex gap-3 text-xs text-indigo-950/80">
        <Clock size={16} className="text-indigo-600 shrink-0 mt-0.5" />
        <div>
          <strong className="font-extrabold text-indigo-950 block mb-0.5">Liquidity & DSO Guidance</strong>
          Keeping debtor ageing schedules below 45 days average outstanding (Days Sales Outstanding - DSO) directly bolsters company free cash flows. Regular reminder cycles via localized media (WhatsApp + Mail) are shown to speed up receivable turnaround cycles by 37%.
        </div>
      </div>
    </div>
  );
};
