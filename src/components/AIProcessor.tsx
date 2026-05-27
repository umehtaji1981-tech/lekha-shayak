import React, { useState, useEffect, useMemo } from 'react';
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle, Trash2, Save, X, UserPlus, Link as LinkIcon, FileSpreadsheet, RefreshCw, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/db';
import * as XLSX from 'xlsx';

interface AIResult {
  vendorName?: string;
  gstin?: string;
  date?: string;
  invoiceNumber?: string;
  items?: any[];
  totalAmount?: number;
  [key: string]: any;
}

interface StatementTransaction {
  date: string;
  description: string;
  amount: number;
  type: 'credit' | 'debit';
  selected?: boolean;
  matchedLedgerId?: string;
  matchedLedgerName?: string;
  entryType: 'Receipt' | 'Payment' | 'Contra';
  saved?: boolean;
}

const cleanLedgerName = (desc: string) => {
  if (!desc) return 'New Ledger';
  let cleaned = desc
    .replace(/(IMPS|UPI|NEFT|RTGS|MBK|BY INST|CHG|REF|CLG|CTS|TRANSFER|P2A|IMPSTXNIDF\d+|VJBURH|ybl|Paym)/gi, '')
    .replace(/[0-9\/:\.@#\-\(\)\*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (!cleaned || cleaned.length < 3) {
    // If stripped too much, fallback to original cleaned
    cleaned = desc.replace(/[0-9\/:\.@#\-\(\)\*]+/g, ' ').trim();
  }
  
  return cleaned
    .split(' ')
    .slice(0, 4)
    .map(w => w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : '')
    .filter(Boolean)
    .join(' ');
};

export const AIProcessor = ({ type, companyId, onResult, onClose, activeFY }: { 
  type: 'bill' | 'statement', 
  companyId: string,
  onResult: (data: any) => void,
  onClose?: () => void,
  activeFY?: any
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<StatementTransaction[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingSingleIndex, setSavingSingleIndex] = useState<number | null>(null);
  const [ledgers, setLedgers] = useState<any[]>([]);
  const [destBankId, setDestBankId] = useState<string>('');

  // Quick add ledger state
  const [quickAddRowIndex, setQuickAddRowIndex] = useState<number | null>(null);
  const [quickLedgerName, setQuickLedgerName] = useState('');
  const [quickLedgerGroup, setQuickLedgerGroup] = useState('Sundry Debtors');

  useEffect(() => {
    if (companyId) {
      return dbService.listenCollection(`companies/${companyId}/ledgers`, [], setLedgers);
    }
  }, [companyId]);

  // Filter ledgers to only Cash and Bank Accounts
  const bankLedgers = useMemo(() => {
    return ledgers.filter(l => ['Bank Accounts', 'Bank', 'Cash-in-hand', 'Cash'].includes(l.group));
  }, [ledgers]);

  // Default the destination bank ledger to the first Bank Accounts ledger
  useEffect(() => {
    if (bankLedgers.length > 0 && !destBankId) {
      const defaultBank = bankLedgers.find(l => l.group === 'Bank Accounts') || bankLedgers[0];
      setDestBankId(defaultBank.id);
    }
  }, [bankLedgers, destBankId]);

  const matchLedger = (description: string) => {
    const desc = (description || '').toLowerCase();
    // 1. Exact match
    let matched = ledgers.find(l => desc === (l.name || '').toLowerCase());
    if (matched) return matched;

    // 2. Contains match
    matched = ledgers.find(l => desc.includes((l.name || '').toLowerCase()) || (l.name || '').toLowerCase().includes(desc));
    if (matched) return matched;

    // 3. Common bank transaction patterns
    if (desc.includes('upi/') || desc.includes('transfer/')) {
       const parts = desc.split('/');
       const target = parts[parts.length - 1];
       matched = ledgers.find(l => target.includes((l.name || '').toLowerCase()));
    }

    return matched;
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv');
      
      if (isExcel && type === 'statement') {
        const reader = new FileReader();
        reader.onload = async (evt) => {
          try {
            const bstr = evt.target?.result;
            const wb = XLSX.read(bstr, { type: 'binary' });
            const wsname = wb.SheetNames[0];
            const ws = wb.Sheets[wsname];
            const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
            
            // Basic parsing logic for bank statements
            const rows = data.slice(1).filter(r => r[0] && r[1] && r[2]);
            const transactions = rows.map(r => {
              const amount = parseFloat(r[2]);
              const desc = String(r[1]);
              const matched = matchLedger(desc);
              const isCredit = amount >= 0;
              const tType = isCredit ? 'credit' : 'debit';
              
              // Determine defaultEntryType
              let defaultEntryType: 'Receipt' | 'Payment' | 'Contra' = isCredit ? 'Receipt' : 'Payment';
              if (matched && ['Bank Accounts', 'Cash-in-hand'].includes(matched.group)) {
                defaultEntryType = 'Contra';
              }

              return {
                date: String(r[0]),
                description: desc,
                amount: Math.abs(amount),
                type: tType,
                selected: true,
                matchedLedgerId: matched ? matched.id : 'NEW_LEDGER',
                matchedLedgerName: matched ? matched.name : cleanLedgerName(desc),
                entryType: defaultEntryType,
                saved: false
              };
            });
            setExtractedData(transactions);
            setLoading(false);
          } catch (err) {
            setError('Failed to parse spreadsheet file');
            setLoading(false);
          }
        };
        reader.readAsBinaryString(file);
      } else {
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        });

        const base64 = await base64Promise;
        
        const res = await fetch('/api/ai/process-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileData: base64,
            mimeType: file.type,
            type
          })
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        if (type === 'statement') {
          const transactions = (data.result || []).map((t: any) => {
            const matched = matchLedger(t.description);
            const isCredit = t.type === 'credit';
            
            let defaultEntryType: 'Receipt' | 'Payment' | 'Contra' = isCredit ? 'Receipt' : 'Payment';
            if (matched && ['Bank Accounts', 'Cash-in-hand'].includes(matched.group)) {
              defaultEntryType = 'Contra';
            }

            return { 
              ...t, 
              selected: true,
              matchedLedgerId: matched ? matched.id : 'NEW_LEDGER',
              matchedLedgerName: matched ? matched.name : cleanLedgerName(t.description),
              entryType: defaultEntryType,
              saved: false
            };
          });
          setExtractedData(transactions);
        } else {
          onResult(data.result);
          if (onClose) onClose();
        }
        setLoading(false);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during parsing');
      setLoading(false);
    }
  };

  const handleSaveSingleElement = async (index: number) => {
    if (!extractedData) return;
    if (!destBankId) {
      alert('Please select a local Firm Bank Account first.');
      return;
    }
    
    setSavingSingleIndex(index);
    try {
      const t = extractedData[index];
      const selectedDestBank = ledgers.find(l => l.id === destBankId);
      let ledgerId = t.matchedLedgerId;
      let partyName = t.matchedLedgerName || t.description;

      // Custom auto-create logic if "NEW_LEDGER" is chosen
      if (ledgerId === 'NEW_LEDGER' || !ledgerId) {
        const lName = t.matchedLedgerName?.trim() || cleanLedgerName(t.description);
        // Standard: Receipts default to Sundry Debtors, Payments to Sundry Creditors
        const defaultGroup = t.type === 'credit' ? 'Sundry Debtors' : 'Sundry Creditors';
        
        const newLedger = await dbService.add(`companies/${companyId}/ledgers`, {
          name: lName,
          group: defaultGroup,
          registrationType: 'Unregistered',
          openingBalance: 0,
          currentBalance: 0,
          companyId
        });
        ledgerId = newLedger.id;
        partyName = lName;
      } else {
        const foundLedger = ledgers.find(l => l.id === ledgerId);
        if (foundLedger) {
          partyName = foundLedger.name;
        }
      }

      // Post the real financial transaction!
      const isCredit = t.type === 'credit';
      if (activeFY) {
        if (t.date < activeFY.startDate || t.date > activeFY.endDate) {
          alert(`Error: This transaction date (${t.date}) is outside the active financial year ${activeFY.label} (${activeFY.startDate} to ${activeFY.endDate}).`);
          return;
        }
      }
      await dbService.addTransactionWithStock(companyId, {
        type: t.entryType, // 'Receipt' | 'Payment' | 'Contra'
        date: t.date,
        partyId: ledgerId,
        partyName: partyName,
        bankId: destBankId,
        bankName: selectedDestBank?.name || 'Local Account',
        totalAmount: Number(t.amount),
        netAmount: Number(t.amount),
        isDeposit: isCredit, // Used for correct Contra routing / multipliers
        notes: `Imported via AI Statement (Single): ${t.description}`,
        narration: `Imported via AI Statement (Single): ${t.description}`,
        status: 'PAID',
        fy: activeFY?.id || '',
        voucherNumber: `${t.entryType.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-6)}-${index}-${Math.floor(Math.random() * 100)}`
      });

      // Mark row as saved in local state
      const updated = [...extractedData];
      updated[index] = {
        ...updated[index],
        selected: false,
        saved: true
      };
      setExtractedData(updated);
    } catch (err: any) {
      alert('Failed to save single entry: ' + err.message);
    } finally {
      setSavingSingleIndex(null);
    }
  };

  const handleImport = async () => {
    if (!extractedData) return;
    if (!destBankId) {
      alert('Please select a local Dest Bank Account first.');
      return;
    }
    
    setSaving(true);
    try {
      const selectedDestBank = ledgers.find(l => l.id === destBankId);
      // Only import selected that aren't already saved
      const selected = extractedData.filter((t) => t.selected && !t.saved);
      const invalidDates = selected.filter(t => activeFY && (t.date < activeFY.startDate || t.date > activeFY.endDate));
      if (invalidDates.length > 0) {
        alert(`Error: ${invalidDates.length} transactions have dates outside the active financial year ${activeFY.label || ''} (${activeFY.startDate} to ${activeFY.endDate}). Please modify or deselect them before importing.`);
        setSaving(false);
        return;
      }
      let successCount = 0;

      for (let i = 0; i < selected.length; i++) {
        const t = selected[i];
        let ledgerId = t.matchedLedgerId;
        let partyName = t.matchedLedgerName || t.description;

        // Custom auto-create logic if "NEW_LEDGER" is chosen
        if (ledgerId === 'NEW_LEDGER' || !ledgerId) {
          const lName = t.matchedLedgerName?.trim() || cleanLedgerName(t.description);
          // Standard: Receipts default to Sundry Debtors, Payments to Sundry Creditors
          const defaultGroup = t.type === 'credit' ? 'Sundry Debtors' : 'Sundry Creditors';
          
          const newLedger = await dbService.add(`companies/${companyId}/ledgers`, {
            name: lName,
            group: defaultGroup,
            registrationType: 'Unregistered',
            openingBalance: 0,
            currentBalance: 0,
            companyId
          });
          ledgerId = newLedger.id;
          partyName = lName;
        } else {
          const foundLedger = ledgers.find(l => l.id === ledgerId);
          if (foundLedger) {
            partyName = foundLedger.name;
          }
        }

        // Post the real financial transaction!
        const isCredit = t.type === 'credit';
        await dbService.addTransactionWithStock(companyId, {
          type: t.entryType, // 'Receipt' | 'Payment' | 'Contra'
          date: t.date,
          partyId: ledgerId,
          partyName: partyName,
          bankId: destBankId,
          bankName: selectedDestBank?.name || 'Local Account',
          totalAmount: Number(t.amount),
          netAmount: Number(t.amount),
          isDeposit: isCredit, // Used for correct Contra routing / multipliers
          notes: `Imported via AI Statement: ${t.description}`,
          narration: `Imported via AI Statement: ${t.description}`,
          status: 'PAID',
          fy: activeFY?.id || '',
          voucherNumber: `${t.entryType.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-6)}-${i}-${Math.floor(Math.random() * 1000)}`
        });
        successCount++;
      }

      onResult({ importedCount: successCount });
      if (onClose) onClose();
    } catch (err: any) {
      setError('Failed to import: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRowChange = (index: number, field: keyof StatementTransaction, value: any) => {
    if (!extractedData) return;
    const newData = [...extractedData];
    
    if (field === 'matchedLedgerId') {
      newData[index].matchedLedgerId = value;
      // If user selected an existing bank or cash account, automatically change to Contra
      const targetLedger = ledgers.find(l => l.id === value);
      if (targetLedger && ['Bank Accounts', 'Cash-in-hand'].includes(targetLedger.group)) {
        newData[index].entryType = 'Contra';
      } else {
        newData[index].entryType = newData[index].type === 'credit' ? 'Receipt' : 'Payment';
      }
      
      if (value !== 'NEW_LEDGER' && targetLedger) {
        newData[index].matchedLedgerName = targetLedger.name;
      } else if (value === 'NEW_LEDGER') {
        newData[index].matchedLedgerName = cleanLedgerName(newData[index].description);
      }
    } else {
      newData[index] = {
        ...newData[index],
        [field]: value
      };
    }
    setExtractedData(newData);
  };

  const toggleSelect = (index: number) => {
    if (!extractedData) return;
    const newData = [...extractedData];
    newData[index].selected = !newData[index].selected;
    setExtractedData(newData);
  };

  if (extractedData && type === 'statement') {
    const selectedDestBank = ledgers.find(l => l.id === destBankId);

    // Group ledgers by group for clean layout structure
    const groupedLedgers = ledgers.reduce((acc: any, ledger) => {
      const grp = ledger.group || 'Other Ledgers';
      if (!acc[grp]) acc[grp] = [];
      acc[grp].push(ledger);
      return acc;
    }, {});

    return (
      <div className="fixed inset-0 bg-slate-900/60 z-[100] backdrop-blur-sm overflow-y-auto p-4 md:p-8 flex justify-center items-start">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="card w-full max-w-7xl flex flex-col bg-white overflow-hidden my-auto shadow-2xl border border-slate-100 rounded-3xl"
        >
          {/* Header */}
          <div className="p-6 border-b flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-50">
            <div>
              <h3 className="text-xl font-black text-slate-800 tracking-tight">AI Bank Statement Reconciliation</h3>
              <p className="text-sm text-slate-500 mt-1">Review extracted entries, map ledger accounts, or record Contra transfers instantly.</p>
            </div>
            
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-all self-end md:self-auto">
              <X size={20} />
            </button>
          </div>

          {/* Interactive Global Bank Selector Bar */}
          <div className="px-6 py-4 bg-indigo-50/40 border-b flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <span className="text-xs font-black uppercase tracking-wider text-slate-500">Statement Firm Bank / Cash Account:</span>
              <select
                className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold text-indigo-700 focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all shadow-sm max-w-xs"
                value={destBankId}
                onChange={(e) => setDestBankId(e.target.value)}
              >
                {bankLedgers.map(l => (
                  <option key={l.id} value={l.id}>{l.name} ({l.group})</option>
                ))}
              </select>
            </div>

            <div className="flex gap-4 text-xs font-bold text-slate-500">
              <span className="bg-white px-3 py-1.5 rounded-lg border">
                Deposits: <span className="text-emerald-600">₹{extractedData.filter(t => t.type === 'credit').reduce((sum, t) => sum + t.amount, 0).toLocaleString()}</span>
              </span>
              <span className="bg-white px-3 py-1.5 rounded-lg border">
                Withdrawals: <span className="text-rose-600">₹{extractedData.filter(t => t.type === 'debit').reduce((sum, t) => sum + t.amount, 0).toLocaleString()}</span>
              </span>
            </div>
          </div>

          {/* Transactions Table */}
          <div className="flex-1 overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead className="bg-slate-50 border-b text-slate-600 uppercase text-[10px] tracking-wider font-extrabold text-slate-400">
                <tr>
                  <th className="px-4 py-4 w-12 text-center">
                    <input 
                      type="checkbox" 
                      className="rounded accent-indigo-600"
                      checked={extractedData.length > 0 && extractedData.every((t) => t.selected || t.saved)}
                      onChange={() => {
                        const allSelected = extractedData.every((t) => t.selected || t.saved);
                        setExtractedData(extractedData.map((t) => t.saved ? t : { ...t, selected: !allSelected }));
                      }}
                    />
                  </th>
                  <th className="px-4 py-4 w-32">Date</th>
                  <th className="px-4 py-4 min-w-[200px]">Original Description</th>
                  <th className="px-4 py-4 w-28 text-center">Flow</th>
                  <th className="px-4 py-4 w-36 text-center">Entry Type</th>
                  <th className="px-4 py-4 min-w-[280px]">Mapped Ledger Account</th>
                  <th className="px-4 py-4 text-right w-36">Amount</th>
                  <th className="px-4 py-4 text-center w-36 pr-6">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {extractedData.map((t, i) => (
                  <tr key={i} className={`hover:bg-slate-50/85 transition-all duration-150 ${t.saved ? 'bg-emerald-50/20' : t.selected ? 'bg-indigo-50/10' : 'opacity-40'}`}>
                    {/* Checkbox Selector */}
                    <td className="px-4 py-4 text-center">
                      <input 
                        type="checkbox" 
                        className="rounded accent-indigo-600 disabled:opacity-30"
                        checked={!!t.selected || !!t.saved} 
                        disabled={!!t.saved}
                        onChange={() => toggleSelect(i)} 
                      />
                    </td>

                    {/* Date Input */}
                    <td className="px-4 py-4">
                      <input 
                        type="date"
                        disabled={!!t.saved}
                        className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-semibold focus:ring-2 focus:ring-indigo-100 outline-none w-full bg-slate-50/50 hover:bg-white disabled:bg-slate-100 disabled:text-slate-400"
                        value={t.date}
                        onChange={(e) => handleRowChange(i, 'date', e.target.value)}
                      />
                    </td>

                    {/* Narration Description */}
                    <td className="px-4 py-4 text-xs font-semibold text-slate-700" title={t.description}>
                      <div className="break-all whitespace-pre-wrap leading-relaxed max-w-[320px] font-mono text-[11px]">{t.description}</div>
                    </td>

                    {/* Inflow / Outflow Badge */}
                    <td className="px-4 py-4 text-center">
                      <span className={`text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider ${
                        t.type === 'credit' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-rose-50 text-rose-600 border border-rose-100'
                      }`}>
                        {t.type === 'credit' ? 'Inflow' : 'Outflow'}
                      </span>
                    </td>

                    {/* Entry Type Select (Receipt / Payment / Contra) */}
                    <td className="px-4 py-4">
                      <select
                        disabled={!!t.saved}
                        className="w-full bg-slate-50/50 hover:bg-white border border-slate-200 rounded-lg p-1.5 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-100 outline-none disabled:bg-slate-100"
                        value={t.entryType}
                        onChange={(e) => handleRowChange(i, 'entryType', e.target.value)}
                      >
                        <option value="Receipt">Receipt</option>
                        <option value="Payment">Payment</option>
                        <option value="Contra">Contra</option>
                      </select>
                    </td>

                    {/* Target Ledger Selector */}
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5 w-full">
                          <select
                            disabled={!!t.saved}
                            className="flex-grow bg-slate-50/50 hover:bg-white border border-slate-200 rounded-lg p-1.5 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-100 outline-none disabled:bg-slate-100 max-w-[230px]"
                            value={t.matchedLedgerId}
                            onChange={(e) => handleRowChange(i, 'matchedLedgerId', e.target.value)}
                          >
                            <option value="NEW_LEDGER">➕ Create New Ledger (Type Below)</option>
                            
                            {Object.keys(groupedLedgers).map(grp => (
                              <optgroup key={grp} label={grp.toUpperCase()} className="text-[10px] font-black text-slate-400">
                                {groupedLedgers[grp].map((l: any) => (
                                  <option key={l.id} value={l.id} className="text-slate-800 font-bold">
                                    {l.name}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>

                          {/* Interactive Trigger Button to Prompt Ledger Creation */}
                          {!t.saved && (
                            <button
                              type="button"
                              onClick={() => {
                                setQuickAddRowIndex(i);
                                setQuickLedgerName(t.matchedLedgerName || cleanLedgerName(t.description));
                                const defGroup = t.entryType === 'Contra' ? 'Bank Accounts' : (t.type === 'credit' ? 'Sundry Debtors' : 'Sundry Creditors');
                                setQuickLedgerGroup(defGroup);
                              }}
                              className="p-2 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-150 transition-all shadow-sm"
                              title="Quick Create Missing Ledger"
                            >
                              <UserPlus size={14} />
                            </button>
                          )}
                        </div>

                        {/* If New Ledger Selected, allow customizing name */}
                        {t.matchedLedgerId === 'NEW_LEDGER' && !t.saved && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] font-bold text-amber-600 uppercase tracking-widest whitespace-nowrap">Name:</span>
                            <input
                              type="text"
                              className="border border-amber-200 bg-amber-50/20 text-slate-800 rounded px-2 py-1 text-xs font-semibold focus:ring-2 focus:ring-amber-200 outline-none flex-grow"
                              value={t.matchedLedgerName}
                              onChange={(e) => handleRowChange(i, 'matchedLedgerName', e.target.value)}
                              placeholder="Type Account Name"
                            />
                          </div>
                        )}
                        
                        {/* Display subtle warning if Contra type matches non-bank or cash */}
                        {t.entryType === 'Contra' && (() => {
                          const ledgerObj = ledgers.find(l => l.id === t.matchedLedgerId);
                          const isContraValid = ledgerObj && ['Bank Accounts', 'Cash-in-hand', 'Bank', 'Cash'].includes(ledgerObj.group);
                          return (
                            <div className="space-y-2 mt-1 w-full max-w-[240px]">
                              <div className="p-2 bg-indigo-50/40 rounded-xl border border-indigo-100 flex flex-col gap-1 w-full">
                                <span className="text-[9px] font-black text-indigo-700 uppercase tracking-wider block">
                                  Transfer {t.type === 'credit' ? 'From' : 'To'} (Select):
                                </span>
                                <div className="flex flex-wrap gap-1">
                                  {bankLedgers
                                    .filter(bl => bl.id !== destBankId)
                                    .map(bl => {
                                      const isSelected = t.matchedLedgerId === bl.id;
                                      return (
                                        <button
                                          key={bl.id}
                                          type="button"
                                          disabled={!!t.saved}
                                          onClick={() => handleRowChange(i, 'matchedLedgerId', bl.id)}
                                          className={`px-2 py-0.5 rounded-lg text-[9px] font-bold transition-all flex items-center gap-1 border cursor-pointer ${
                                            isSelected
                                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm font-extrabold'
                                              : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                                          }`}
                                        >
                                          <span>{['Cash-in-hand', 'Cash'].includes(bl.group) ? '💵' : '🏦'}</span>
                                          <span className="truncate max-w-[80px]">{bl.name}</span>
                                        </button>
                                      );
                                    })}
                                </div>
                              </div>

                              {!isContraValid ? (
                                <p className="text-[9px] font-bold text-rose-500 bg-rose-50 p-1 rounded border border-rose-100">
                                  ⚠️ Contra transfers must be between Cash or Bank ledger accounts. Use options above or pick a bank/cash account.
                                </p>
                              ) : (
                                <p className="text-[9px] font-bold text-indigo-600 bg-indigo-50/40 p-1 rounded border border-indigo-100">
                                  {t.type === 'credit' 
                                    ? `Contra: ₹${t.amount.toLocaleString()} will move from ${ledgerObj?.name} into statement bank.` 
                                    : `Contra: ₹${t.amount.toLocaleString()} will move out from statement bank to ${ledgerObj?.name}.`}
                                </p>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </td>

                    {/* Transaction Amount */}
                    <td className="px-4 py-4 text-right font-black text-slate-900 whitespace-nowrap">
                      ₹{Math.abs(t.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>

                    {/* Single Save Action Option */}
                    <td className="px-4 py-4 text-center pr-6">
                      {t.saved ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-xl shadow-sm">
                          <CheckCircle2 size={13} className="text-emerald-600 animate-pulse" /> Saved
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSaveSingleElement(i)}
                          disabled={saving || savingSingleIndex !== null}
                          className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 hover:bg-indigo-600 hover:text-white px-3 py-1.5 rounded-xl transition-all shadow-sm active:scale-95 duration-150 disabled:opacity-40"
                        >
                          {savingSingleIndex === i ? (
                            <Loader2 className="animate-spin" size={12} />
                          ) : (
                            <Save size={12} />
                          )}
                          Save Entry
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer Bar */}
          <div className="p-6 border-t bg-slate-50 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="text-sm font-semibold text-slate-600">
              {extractedData.filter((t) => t.selected && !t.saved).length} pending transactions selected for bulk import
            </div>
            
            <div className="flex gap-4">
              <button 
                onClick={onClose} 
                className="px-6 py-2.5 bg-slate-200 text-slate-700 hover:bg-slate-300 font-bold rounded-xl text-sm transition-all shadow-sm"
              >
                Close
              </button>
              
              <button 
                onClick={handleImport} 
                disabled={saving || !extractedData.some((t) => t.selected && !t.saved)} 
                className="btn-primary min-w-[200px] shadow-lg shadow-indigo-100 flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                {saving ? 'Processing Entries...' : 'Confirm & Save Entries'}
              </button>
            </div>
          </div>
        </motion.div>

        {/* Quick Add Ledger Modal */}
        {quickAddRowIndex !== null && (
          <div className="fixed inset-0 bg-slate-900/60 z-[110] backdrop-blur-sm flex justify-center items-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-3xl shadow-2xl border border-slate-100 p-6 max-w-md w-full"
            >
              <div className="flex justify-between items-start mb-4">
                <h4 className="font-black text-slate-800 text-lg flex items-center gap-2">
                  <UserPlus className="text-indigo-600" size={22} />
                  Quick Add Ledger Account
                </h4>
                <button 
                  onClick={() => setQuickAddRowIndex(null)}
                  className="p-1 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
              <p className="text-xs text-slate-500 mb-6 font-medium">Create and persist a new ledger account instantly so it appears in your dropdown lists.</p>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] uppercase font-black text-slate-400 mb-1 tracking-wider">Ledger Name</label>
                  <input
                    type="text"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-bold text-slate-800 outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 transition-all"
                    value={quickLedgerName}
                    onChange={(e) => setQuickLedgerName(e.target.value)}
                    placeholder="Enter customer, supplier, or bank name"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-black text-slate-400 mb-1 tracking-wider">Account Group</label>
                  <select
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-bold text-slate-800 outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 transition-all"
                    value={quickLedgerGroup}
                    onChange={(e) => setQuickLedgerGroup(e.target.value)}
                  >
                    <option value="Sundry Debtors">Sundry Debtors (Customers)</option>
                    <option value="Sundry Creditors">Sundry Creditors (Suppliers)</option>
                    <option value="Bank Accounts">Bank Accounts (Local Banks)</option>
                    <option value="Cash-in-hand">Cash-in-hand</option>
                    <option value="Direct Expenses">Direct Expenses</option>
                    <option value="Indirect Expenses">Indirect Expenses</option>
                    <option value="Direct Incomes">Direct Incomes</option>
                    <option value="Indirect Incomes">Indirect Incomes</option>
                    <option value="Capital Account">Capital Account</option>
                    <option value="Fixed Assets">Fixed Assets</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-4 mt-8">
                <button
                  type="button"
                  onClick={() => setQuickAddRowIndex(null)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-black uppercase tracking-wider rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!quickLedgerName.trim()) {
                      alert('Please enter a ledger name');
                      return;
                    }
                    try {
                      const newLedger = await dbService.add(`companies/${companyId}/ledgers`, {
                        name: quickLedgerName.trim(),
                        group: quickLedgerGroup,
                        registrationType: 'Unregistered',
                        openingBalance: 0,
                        currentBalance: 0,
                        companyId
                      });
                      
                      // Update row matching values in extractedData
                      const updated = [...extractedData!];
                      updated[quickAddRowIndex] = {
                        ...updated[quickAddRowIndex],
                        matchedLedgerId: newLedger.id,
                        matchedLedgerName: quickLedgerName.trim(),
                        entryType: ['Bank Accounts', 'Cash-in-hand'].includes(quickLedgerGroup) ? 'Contra' : (updated[quickAddRowIndex].type === 'credit' ? 'Receipt' : 'Payment')
                      };
                      setExtractedData(updated);
                      setQuickAddRowIndex(null);
                    } catch (err: any) {
                      alert('Error saving ledger: ' + err.message);
                    }
                  }}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-slate-900 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-lg shadow-indigo-105 transition-all"
                >
                  Create & Select
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card p-6 border-dashed border-indigo-200 bg-indigo-50/30 rounded-2xl">
      <div className="flex flex-col items-center justify-center text-center">
        <div className={`p-4 rounded-full mb-4 ${loading ? 'bg-indigo-100' : 'bg-indigo-600 shadow-lg text-white'}`}>
          {loading ? <Loader2 className="animate-spin text-indigo-600" /> : <Upload />}
        </div>
        
        <motion.h3 
          key={loading ? 'loading' : 'idle'}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-bold text-lg mb-1 text-slate-800"
        >
          {loading ? 'AI is analyzing statement...' : `Process ${type === 'bill' ? 'Purchase Bill' : 'Bank Statement'}`}
        </motion.h3>
        
        <p className="text-sm text-slate-500 mb-6 max-w-md leading-relaxed">
          {loading 
            ? 'Extracting transactions and auto-matching accounts using Gemini AI. This will take just a few seconds...' 
            : `Upload a spreadsheet, CSV, PDF, or image of your bank statement. Gemini AI will match ledgers, detect receipts vs payments, and manage Contra entries.`}
        </p>

        <label className={`btn-primary px-8 cursor-pointer shadow-lg shadow-indigo-100 ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
          <input type="file" className="hidden" accept="image/*,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={handleFile} disabled={loading} />
          {loading ? <div className="flex items-center gap-2"><Loader2 size={18} className="animate-spin" /> Analyzing Document...</div> : 'Choose File'}
        </label>

        {error && (
          <div className="mt-4 p-3 bg-red-50 rounded-xl flex items-center gap-2 text-red-600 text-xs font-bold border border-red-100 shadow-sm max-w-sm">
            <AlertCircle size={16} />
            <span className="flex-grow text-left">{error}</span>
          </div>
        )}
      </div>
    </div>
  );
};
