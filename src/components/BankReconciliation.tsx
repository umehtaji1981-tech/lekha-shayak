import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  Upload, 
  CheckCircle2, 
  AlertCircle, 
  ArrowRight, 
  Search, 
  Calendar,
  FileSpreadsheet,
  RefreshCw,
  MoreVertical,
  ArrowDownLeft,
  ArrowUpRight,
  ShieldCheck,
  Check
} from 'lucide-react';
import { dbService } from '../lib/db';
import { parseBankFile } from '../services/bankImport';
import { motion, AnimatePresence } from 'motion/react';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface BankReconciliationProps {
  companyId: string;
  activeFY: any;
  ledgers: any[];
}

export const BankReconciliation = ({ companyId, activeFY, ledgers }: BankReconciliationProps) => {
  const [selectedLedgerId, setSelectedLedgerId] = useState('');
  const [bankTransactions, setBankTransactions] = useState<any[]>([]); // From imported file
  const [bookTransactions, setBookTransactions] = useState<any[]>([]); // From DB
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [matches, setMatches] = useState<Record<string, string>>({}); // bankTxId -> bookTxId
  const [selectedBankTxId, setSelectedBankTxId] = useState<string | null>(null);

  const bankLedgers = ledgers.filter(l => (l.group || '').includes('Bank'));

  // Load book transactions when ledger changes
  useEffect(() => {
    if (!selectedLedgerId) return;

    const loadBookTransactions = async () => {
      try {
        const q = query(
          collection(db, `companies/${companyId}/transactions`),
          where('bankId', '==', selectedLedgerId)
        );
        const snapshot = await getDocs(q);
        const txs: any[] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Filter unreconciled or for the current view
        setBookTransactions(txs.sort((a, b) => b.date.localeCompare(a.date)));
      } catch (err) {
        console.error("Failed to load transactions", err);
      }
    };

    loadBookTransactions();
  }, [selectedLedgerId, companyId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    setError(null);
    try {
      const parsed = await parseBankFile(file);
      // Add a temporary ID for matching
      const withIds = parsed.map((tx, idx) => ({ 
        ...tx, 
        id: `bank-tx-${idx}`,
        // Map types to consistent values
        type: tx.type === 'Receipt' ? 'Deposit' : 'Withdrawal'
      }));
      setBankTransactions(withIds);
      if (withIds.length > 0) setSelectedBankTxId(withIds[0].id);
      
      // Auto-matching logic
      autoMatch(withIds, bookTransactions);
      alert(`${parsed.length} transactions imported successfully.`);
    } catch (err) {
      setError("Failed to parse statement. Please check the format.");
    } finally {
      setIsParsing(false);
    }
  };

  const autoMatch = (bankTxs: any[], bookTxs: any[]) => {
    const newMatches = { ...matches };
    const usedBookIds = new Set(Object.values(matches));

    bankTxs.forEach(bankTx => {
      if (newMatches[bankTx.id]) return;

      // Find potential matches in books
      const match = bookTxs.find(bookTx => {
        if (usedBookIds.has(bookTx.id)) return false;
        
        const amountMatch = Math.abs(bookTx.totalAmount - bankTx.amount) < 0.01;
        const typeMatch = (bankTx.type === 'Deposit' && (bookTx.type === 'Receipt' || bookTx.type === 'Sales')) ||
                          (bankTx.type === 'Withdrawal' && (bookTx.type === 'Payment' || bookTx.type === 'Purchases'));
        
        // Date match within 7 days (clearing often takes time)
        const bankDate = new Date(bankTx.date);
        const bookDate = new Date(bookTx.date);
        const diffDays = Math.abs((bankDate.getTime() - bookDate.getTime()) / (1000 * 3600 * 24));
        const dateInRange = diffDays <= 7;

        return amountMatch && typeMatch && dateInRange;
      });

      if (match) {
        newMatches[bankTx.id] = match.id;
        usedBookIds.add(match.id);
      }
    });

    setMatches(newMatches);
  };

  const handleManualMatch = (bankTxId: string, bookTxId: string | null) => {
    if (bookTxId === null) {
      const newMatches = { ...matches };
      delete newMatches[bankTxId];
      setMatches(newMatches);
    } else {
      setMatches({ ...matches, [bankTxId]: bookTxId });
    }
  };

  const saveReconciliation = async () => {
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      
      Object.entries(matches).forEach(([bankTxId, bookTxId]) => {
        const bankTx = bankTransactions.find(t => t.id === bankTxId);
        if (!bankTx) return;
        if (!bookTxId || typeof bookTxId !== 'string' || bookTxId.trim() === '') return;
        const bookTxRef = doc(db, `companies/${companyId}/transactions`, bookTxId);
        
        batch.update(bookTxRef, {
          reconciled: true,
          bankDate: bankTx.date,
          updatedAt: new Date().toISOString()
        });
      });

      await batch.commit();
      
      // Update local state
      setBookTransactions(prev => prev.map(tx => {
        const matched = Object.values(matches).includes(tx.id);
        if (matched) {
          const bankTx = bankTransactions.find(bt => matches[bt.id] === tx.id);
          return { ...tx, reconciled: true, bankDate: bankTx.date };
        }
        return tx;
      }));
      
      // Clear matches for those processed
      setMatches({});
      setBankTransactions(prev => prev.filter(bt => !matches[bt.id]));
      
      alert("Successfully reconciled matched transactions!");
    } catch (err) {
      console.error(err);
      setError("Failed to save reconciliation.");
    } finally {
      setIsSaving(false);
    }
  };

  const matchedBookIds = Object.values(matches);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center">
            <Building2 size={24} />
          </div>
          <div>
            <h3 className="font-black text-slate-900 text-xl">Bank Reconciliation</h3>
            <p className="text-xs text-slate-500 font-medium">Verify your bank statement with book records</p>
          </div>
        </div>
        <div className="flex gap-3 w-full md:w-auto">
          <select 
            className="input-field py-2 text-sm min-w-[200px]"
            value={selectedLedgerId}
            onChange={(e) => setSelectedLedgerId(e.target.value)}
          >
            <option value="">Select Bank Account</option>
            {bankLedgers.map(l => <option key={l.id} value={l.id}>{l.name} (₹{l.currentBalance.toLocaleString()})</option>)}
          </select>
          
          <label className={`btn-secondary text-xs h-10 cursor-pointer flex items-center gap-2 ${(!selectedLedgerId || isParsing) ? 'opacity-50 cursor-not-allowed' : ''}`}>
            {isParsing ? <RefreshCw className="animate-spin" size={14} /> : <Upload size={14} />} 
            {isParsing ? 'Parsing...' : 'Import Statement'}
            <input 
              type="file" 
              className="hidden" 
              disabled={!selectedLedgerId || isParsing} 
              onChange={handleFileUpload}
              accept=".xlsx,.xls,.csv,.pdf,image/*"
            />
          </label>
        </div>
      </div>

      {!selectedLedgerId ? (
        <div className="card p-20 text-center space-y-4">
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center">
              <Search size={40} />
            </div>
          </div>
          <p className="text-slate-500 font-bold">Please select a bank account to start reconciliation</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-[calc(100vh-320px)]">
          {/* Bank Side (Statement) */}
          <div className="flex flex-col bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-50 bg-slate-50/50 flex justify-between items-center">
              <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                <Building2 size={14} /> Bank Statement
              </h4>
              <span className="text-[10px] font-bold text-slate-400">{bankTransactions.length} items unprocessed</span>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {isParsing ? (
                <div className="flex flex-col items-center justify-center h-full text-indigo-500 space-y-4">
                  <RefreshCw className="animate-spin" size={40} strokeWidth={1.5} />
                  <div className="text-center">
                    <p className="text-sm font-bold">Scanning Document...</p>
                    <p className="text-[10px] text-slate-400 font-medium">Extracting transactions with AI</p>
                  </div>
                </div>
              ) : bankTransactions.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-2 italic text-center">
                  <FileSpreadsheet size={32} strokeWidth={1} />
                  <div>
                    <p className="text-xs">No statement imported</p>
                    <p className="text-[10px] opacity-75">Upload Excel, PDF or JPEG</p>
                  </div>
                </div>
              ) : (
                bankTransactions.map(bt => (
                  <motion.div 
                    key={bt.id}
                    layoutId={bt.id}
                    className={`p-4 rounded-2xl border transition-all ${selectedBankTxId === bt.id ? 'ring-2 ring-indigo-500 border-indigo-200' : ''} ${matches[bt.id] ? 'bg-emerald-50 border-emerald-100 shadow-none ring-2 ring-emerald-500' : 'bg-white border-slate-100 shadow-sm hover:border-indigo-200 cursor-pointer'}`}
                    onClick={() => !matches[bt.id] && setSelectedBankTxId(bt.id)}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${bt.type === 'Deposit' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                          {bt.type === 'Deposit' ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                        </div>
                        <div>
                          <p className="text-sm font-black text-slate-900">{bt.partyName}</p>
                          <p className="text-[10px] text-slate-500 font-medium">{bt.narration}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-black ${bt.type === 'Deposit' ? 'text-emerald-600' : 'text-red-500'}`}>
                          {bt.type === 'Deposit' ? '+' : '-'}₹{bt.amount.toLocaleString()}
                        </p>
                        <p className="text-[10px] text-slate-400 font-bold">{bt.date}</p>
                      </div>
                    </div>

                    {matches[bt.id] ? (
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-emerald-200/50">
                        <div className="flex items-center gap-2 text-[10px] text-emerald-700 font-bold">
                          <ShieldCheck size={12} /> Matched with {bookTransactions.find(t => t.id === matches[bt.id])?.voucherNumber}
                        </div>
                        <button 
                          onClick={() => handleManualMatch(bt.id, null)}
                          className="text-[10px] font-black text-emerald-600 hover:underline"
                        >
                          Unmatch
                        </button>
                      </div>
                    ) : (
                      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                         {/* Quick suggestion match would go here */}
                      </div>
                    )}
                  </motion.div>
                ))
              )}
            </div>
          </div>

          {/* Book Side (Ledger) */}
          <div className="flex flex-col bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-50 bg-slate-50/50 flex justify-between items-center">
              <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                <Calendar size={14} /> Book Transactions
              </h4>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={12} />
                <input 
                  className="bg-white border-slate-200 text-[10px] h-7 pl-8 pr-3 rounded-lg focus:ring-2 focus:ring-indigo-500/20" 
                  placeholder="Filter by amount or ID..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {bookTransactions.length === 0 ? (
                <div className="flex h-full items-center justify-center text-slate-400 text-xs italic">
                  No ledger transactions found for this account
                </div>
              ) : (
                bookTransactions
                  .filter(t => !t.reconciled) // Only show unreconciled
                  .filter(t => (t.voucherNumber || '').includes(searchTerm) || String(t.totalAmount || '').includes(searchTerm))
                  .map(t => (
                  <motion.div 
                    key={t.id}
                    className={`p-4 rounded-2xl border transition-all ${matchedBookIds.includes(t.id) ? 'bg-indigo-50 border-indigo-100 opacity-50' : 'bg-white border-slate-100 shadow-sm hover:border-indigo-200'}`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${['Receipt', 'Sales'].includes(t.type) ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                          <Check size={16} />
                        </div>
                        <div>
                          <p className="text-sm font-black text-slate-900">{t.voucherNumber}</p>
                          <p className="text-[10px] text-slate-500 font-medium">Party ID: {t.partyId?.slice(0, 8)}...</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-black text-slate-900">₹{t.totalAmount.toLocaleString()}</p>
                        <p className="text-[10px] text-slate-400 font-bold">{t.date}</p>
                      </div>
                    </div>
                    
                    {/* If selected in bank side, show manual match option or highlight */}
                    {!matchedBookIds.includes(t.id) && selectedBankTxId && !matches[selectedBankTxId] && (
                      <div className="mt-3 flex justify-end">
                        <button 
                          onClick={() => {
                            if (selectedBankTxId) {
                              handleManualMatch(selectedBankTxId, t.id);
                              // Auto-select next unmatched bank tx
                              const next = bankTransactions.find(bt => !matches[bt.id] && bt.id !== selectedBankTxId);
                              if (next) setSelectedBankTxId(next.id);
                              else setSelectedBankTxId(null);
                            }
                          }}
                          className="text-[10px] font-black text-indigo-600 hover:text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Match with Selected Statement Entry
                        </button>
                      </div>
                    )}
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer / Actions */}
      {selectedLedgerId && matchedBookIds.length > 0 && (
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-8 py-5 rounded-3xl shadow-2xl flex items-center gap-8 z-50 min-w-[500px]"
        >
          <div className="flex items-center gap-3 border-r border-slate-800 pr-8">
            <div className="w-10 h-10 bg-emerald-500 text-white rounded-full flex items-center justify-center">
              <CheckCircle2 size={24} />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-slate-400">Ready to Reconcile</p>
              <p className="text-lg font-black">{matchedBookIds.length} Transactions matched</p>
            </div>
          </div>
          <div className="flex-1">
             <p className="text-[10px] font-bold text-slate-400">Total Cleared Value</p>
             <p className="text-xl font-black text-emerald-400">
               ₹{bankTransactions.filter(bt => matches[bt.id]).reduce((sum, bt) => sum + bt.amount, 0).toLocaleString()}
             </p>
          </div>
          <button 
            onClick={saveReconciliation}
            disabled={isSaving}
            className="btn-primary bg-indigo-600 hover:bg-indigo-500 border-none px-8 py-3 h-auto text-sm"
          >
            {isSaving ? (
              <RefreshCw className="animate-spin" size={18} />
            ) : (
              'Confirm Matches'
            )}
          </button>
        </motion.div>
      )}
    </div>
  );
};
