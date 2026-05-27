import React, { useState } from 'react';
import { Plus, Search, UserCheck, Phone, Mail, MapPin, Pencil, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/db';
import { validateGSTIN, GST_STATES } from '../lib/gst-utils';
import { where } from 'firebase/firestore';

const ACCOUNT_GROUPS = [
  "Sundry Debtors", "Sundry Creditors", "Bank Accounts", "Cash-in-hand", 
  "Sales Accounts", "Purchase Accounts", "Direct Expenses", "Indirect Expenses",
  "Direct Incomes", "Indirect Incomes", "Stock-in-hand",
  "Fixed Assets", "Current Assets", "Current Liabilities",
  "Loans & Advances (Asset)", "Loans (Liability)", "Capital Account", "Investments", "Duties & Taxes"
];

export const LedgerMaster = ({ companyId, activeFY }: { companyId: string, activeFY?: any }) => {
  const [rawLedgers, setRawLedgers] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedLedger, setSelectedLedger] = useState<any>(null);
  const [selectedGroup, setSelectedGroup] = useState('Sundry Debtors');
  const [loading, setLoading] = useState(true);
  const [editingOpeningId, setEditingOpeningId] = useState<string | null>(null);
  const [tempOpeningVal, setTempOpeningVal] = useState<string>('');
  const [ledgerToDelete, setLedgerToDelete] = useState<any | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const handleSaveOpeningBalance = async (ledger: any, newOpeningVal: number) => {
    try {
      const oldOpening = Number(ledger.openingBalance) || 0;
      const change = newOpeningVal - oldOpening;
      const newCurrentBal = (Number(ledger.currentBalance) || 0) + change;
      
      await dbService.update(`companies/${companyId}/ledgers`, ledger.id, {
        openingBalance: newOpeningVal,
        currentBalance: newCurrentBal
      });
      setEditingOpeningId(null);
    } catch (err) {
      alert("Failed to update opening balance");
    }
  };

  React.useEffect(() => {
    if (selectedLedger) {
      setSelectedGroup(selectedLedger.group);
    } else {
      setSelectedGroup('Sundry Debtors');
    }
  }, [selectedLedger]);

  React.useEffect(() => {
    return dbService.listenCollection(`companies/${companyId}/ledgers`, [], (data) => {
      setRawLedgers(data);
      setLoading(false);
    });
  }, [companyId]);

  React.useEffect(() => {
    if (!companyId) return;
    const constraints = [];
    if (activeFY) {
      constraints.push(where('date', '>=', activeFY.startDate));
      constraints.push(where('date', '<=', activeFY.endDate));
    }
    return dbService.listenCollection(`companies/${companyId}/transactions`, constraints, (data) => {
      setTransactions(data);
    });
  }, [companyId, activeFY]);

  const ledgers = React.useMemo(() => {
    const sales = transactions.filter((t: any) => t.type === 'Sales');
    const purchases = transactions.filter((t: any) => t.type === 'Purchases');
    
    const cgstSales = sales.reduce((sum, t) => sum + (Number(t.cgst) || 0), 0);
    const sgstSales = sales.reduce((sum, t) => sum + (Number(t.sgst) || 0), 0);
    const igstSales = sales.reduce((sum, t) => sum + (Number(t.igst) || 0), 0);
    
    const cgstPurchases = purchases.reduce((sum, t) => sum + (Number(t.cgst) || 0), 0);
    const sgstPurchases = purchases.reduce((sum, t) => sum + (Number(t.sgst) || 0), 0);
    const igstPurchases = purchases.reduce((sum, t) => sum + (Number(t.igst) || 0), 0);

    return rawLedgers.map(l => {
      if (l.group === 'Duties & Taxes') {
        const op = Number(l.openingBalance) || 0;
        if (l.name === 'CGST') {
          return { ...l, currentBalance: op + (cgstSales - cgstPurchases) };
        } else if (l.name === 'SGST') {
          return { ...l, currentBalance: op + (sgstSales - sgstPurchases) };
        } else if (l.name === 'IGST') {
          return { ...l, currentBalance: op + (igstSales - igstPurchases) };
        }
      }
      return l;
    });
  }, [rawLedgers, transactions]);

  const filteredLedgers = React.useMemo(() => {
    if (!searchQuery.trim()) return ledgers;
    const q = searchQuery.toLowerCase().trim();
    return ledgers.filter(ledger => {
      const name = (ledger.name || '').toLowerCase();
      const gst = (ledger.gstIn || '').toLowerCase();
      const group = (ledger.group || '').toLowerCase();
      const mobile = (ledger.mobile || '').toLowerCase();
      const state = (ledger.state || '').toLowerCase();
      return name.includes(q) || gst.includes(q) || group.includes(q) || mobile.includes(q) || state.includes(q);
    });
  }, [ledgers, searchQuery]);

  const handleSubmit = async (e: any, andNext = false) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const gstIn = (data.get('gstIn') as string) || '';
    const registrationType = (data.get('registrationType') as string) || 'Unregistered';
    const stateCode = (data.get('stateCode') as string) || '';
    const validation = validateGSTIN(gstIn);
    
    const openingBal = Number(data.get('openingBalance'));
    const subjectToRCM = data.get('subjectToRCM') === 'true' || data.get('subjectToRCM') === 'on';
    
    const ledger: any = {
      name: data.get('name'),
      group: data.get('group'),
      registrationType,
      gstIn: (registrationType === 'Unregistered' || !gstIn) ? '' : gstIn,
      state: GST_STATES[stateCode] || (validation.valid ? validation.stateName : ''),
      stateCode: stateCode || (validation.valid ? validation.stateCode : ''),
      openingBalance: openingBal,
      subjectToRCM: !!subjectToRCM,
      address: data.get('address') || '',
      mobile: data.get('mobile') || '',
      // Bank specific fields
      accountNumber: data.get('accountNumber') || '',
      ifscCode: data.get('ifscCode') || '',
      branchName: data.get('branchName') || '',
      companyId
    };

    if (selectedLedger) {
      const oldOpening = Number(selectedLedger.openingBalance) || 0;
      const change = openingBal - oldOpening;
      ledger.currentBalance = (Number(selectedLedger.currentBalance) || 0) + change;
      await dbService.update(`companies/${companyId}/ledgers`, selectedLedger.id, ledger);
    } else {
      ledger.currentBalance = openingBal;
      await dbService.add(`companies/${companyId}/ledgers`, ledger);
    }
    
    if (andNext) {
      e.target.reset();
      setSelectedLedger(null);
      setSelectedGroup('Sundry Debtors');
    } else {
      setShowAdd(false);
      setSelectedLedger(null);
    }
  };

  const handleEdit = (ledger: any) => {
    setSelectedLedger(ledger);
    setShowAdd(true);
  };

  const handleDelete = (ledger: any) => {
    setLedgerToDelete(ledger);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (!ledgerToDelete) return;
    try {
      const queryInTransactions = transactions.some((t: any) => 
        t.partyId === ledgerToDelete.id || 
        t.ledgerId === ledgerToDelete.id || 
        t.bankId === ledgerToDelete.id ||
        t.debitLedgerId === ledgerToDelete.id ||
        t.creditLedgerId === ledgerToDelete.id
      );

      if (queryInTransactions) {
        setDeleteError(`Cannot delete "${ledgerToDelete.name}" because it is already used in transactions. Please delete or reassociate those transactions first.`);
        return;
      }

      await dbService.delete(`companies/${companyId}/ledgers`, ledgerToDelete.id);
      setLedgerToDelete(null);
      setDeleteError(null);
    } catch (e) {
      console.error("Delete failed", e);
      setDeleteError("Failed to delete ledger. Please try again.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
        <div className="relative flex-1 max-w-lg">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
            <Search size={18} />
          </span>
          <input
            type="text"
            className="input-field pl-10 h-10 py-2 w-full pr-10 bg-slate-50/50 focus:bg-white text-slate-700 placeholder-slate-400"
            placeholder="Search party by name, state, group, or GSTIN..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-650 font-bold p-1 rounded-full text-[10px]"
              title="Clear Search"
            >
              ✕
            </button>
          )}
        </div>
        <button onClick={() => { setSelectedLedger(null); setShowAdd(true); }} className="btn-primary h-10 flex-shrink-0 flex items-center gap-2">
          <Plus size={18} /> Add Ledger
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Parties', value: ledgers.length, color: 'border-brand' },
          { label: 'Debtors', value: ledgers.filter(l => l.group === 'Sundry Debtors').length, color: 'border-emerald-600' },
          { label: 'Creditors', value: ledgers.filter(l => l.group === 'Sundry Creditors').length, color: 'border-orange-600' },
          { label: 'Bank/Cash', value: ledgers.filter(l => ['Bank Accounts', 'Cash-in-hand'].includes(l.group)).length, color: 'border-blue-600' },
        ].map((stat, i) => (
          <div key={i} className={`card p-4 border-l-4 ${stat.color}`}>
            <div className="text-sm text-slate-500">{stat.label}</div>
            <div className="text-xl font-bold">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
              <tr>
                <th className="px-6 py-4">Ledger Name</th>
                <th className="px-6 py-4">Group</th>
                <th className="px-6 py-4">GSTIN</th>
                <th className="px-6 py-4 text-right">Opening Balance</th>
                <th className="px-6 py-4 text-right">Current Balance</th>
                <th className="px-6 py-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLedgers.map((ledger) => (
                <tr key={ledger.id} className="hover:bg-slate-50/50 transition-colors group/row">
                  <td className="px-6 py-4 font-semibold">
                    <div className="text-slate-900">{ledger.name}</div>
                    {ledger.mobile && (
                      <div className="text-[10px] text-slate-400 font-medium">Mob: {ledger.mobile}</div>
                    )}
                    {ledger.group === 'Bank Accounts' && ledger.accountNumber && (
                      <div className="text-[10px] text-blue-500 font-semibold font-mono mt-0.5">
                        A/c: {ledger.accountNumber} {ledger.ifscCode ? `| IFSC: ${ledger.ifscCode}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-[10px] font-black uppercase tracking-wider bg-slate-100 px-2.5 py-1 rounded-md text-slate-600">
                      {ledger.group}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-500">
                    {ledger.gstIn || <span className="text-slate-300 font-sans">Unregistered</span>}
                  </td>
                  <td className="px-6 py-4 text-right whitespace-nowrap">
                    {editingOpeningId === ledger.id ? (
                      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <span className="text-xs font-bold text-indigo-600">₹</span>
                        <input
                          type="number"
                          value={tempOpeningVal}
                          onChange={(e) => setTempOpeningVal(e.target.value)}
                          className="w-24 bg-white border border-indigo-300 rounded px-2 py-1 text-xs font-bold outline-none font-mono text-right"
                          autoFocus
                          onKeyDown={async (e) => {
                            if (e.key === 'Enter') {
                              await handleSaveOpeningBalance(ledger, Number(tempOpeningVal));
                            } else if (e.key === 'Escape') {
                              setEditingOpeningId(null);
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={async () => await handleSaveOpeningBalance(ledger, Number(tempOpeningVal))}
                          className="px-2 py-1 bg-indigo-600 text-white rounded text-[10px] font-black uppercase tracking-wider hover:bg-slate-900 transition-all cursor-pointer"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingOpeningId(null)}
                          className="p-1 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5 group/opbal justify-items-end">
                        <span className="font-semibold font-mono text-slate-600">
                          ₹{(ledger.openingBalance || 0).toLocaleString()}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingOpeningId(ledger.id);
                            setTempOpeningVal(String(ledger.openingBalance || 0));
                          }}
                          className="text-slate-400 hover:text-indigo-600 p-0.5 rounded opacity-0 group-hover/row:opacity-100 transition-all cursor-pointer"
                          title="Click to change Opening Balance"
                        >
                          <Pencil size={11} className="inline" />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right font-black text-slate-900">
                    ₹{ledger.currentBalance?.toLocaleString()}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex gap-2 items-center">
                      <button onClick={() => handleEdit(ledger)} className="text-indigo-600 hover:text-indigo-800 p-1.5 hover:bg-indigo-50 rounded-lg transition-all" title="Edit Full Details">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => handleDelete(ledger)} className="text-slate-300 hover:text-red-500 p-1.5 hover:bg-red-50 rounded-lg transition-all" title="Delete">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredLedgers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    <p className="font-semibold text-slate-500">No matching ledger records found</p>
                    <p className="text-xs text-slate-400 mt-1">Try searching with a different name or GSTIN number.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 z-[100] overflow-y-auto p-4 flex justify-center items-start">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="card w-full max-w-2xl p-8 my-auto">
            <h3 className="text-xl font-bold mb-6">{selectedLedger ? 'Edit Ledger' : 'Create New Ledger'}</h3>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-6">
              <div className="col-span-2">
                <label className="label">Ledger Name*</label>
                <input name="name" defaultValue={selectedLedger?.name || ''} className="input-field" placeholder="Party Name or Account Name" required />
              </div>
              <div>
                <label className="label">Account Group*</label>
                <select 
                  name="group" 
                  value={selectedGroup}
                  onChange={(e) => setSelectedGroup(e.target.value)}
                  className="input-field" 
                  required
                >
                  {ACCOUNT_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              {selectedGroup === 'Bank Accounts' && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="col-span-2 grid grid-cols-2 gap-6 bg-blue-50 p-6 rounded-xl border border-blue-100">
                  <div className="col-span-2 text-xs font-bold text-blue-600 uppercase tracking-widest mb-2">Bank Account Details</div>
                  <div>
                    <label className="label">Account Number</label>
                    <input name="accountNumber" defaultValue={selectedLedger?.accountNumber || ''} className="input-field bg-white" placeholder="Enter bank account no." />
                  </div>
                  <div>
                    <label className="label">IFSC Code</label>
                    <input name="ifscCode" defaultValue={selectedLedger?.ifscCode || ''} className="input-field bg-white" placeholder="HDFC0001234" />
                  </div>
                  <div className="col-span-2">
                    <label className="label">Branch Name</label>
                    <input name="branchName" defaultValue={selectedLedger?.branchName || ''} className="input-field bg-white" placeholder="Main Branch, Mumbai" />
                  </div>
                </motion.div>
              )}
              {['Sundry Debtors', 'Sundry Creditors', 'Sales Accounts', 'Purchase Accounts'].includes(selectedGroup) && (
                <>
                  <div>
                    <label className="label">Registration Type</label>
                    <select name="registrationType" defaultValue={selectedLedger?.registrationType || 'Regular'} className="input-field">
                      <option value="Regular">Regular</option>
                      <option value="Composition">Composition</option>
                      <option value="Unregistered">Unregistered</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">GSTIN</label>
                    <input name="gstIn" defaultValue={selectedLedger?.gstIn || ''} className="input-field" placeholder="15-digit GSTIN" />
                  </div>
                  <div>
                    <label className="label">State*</label>
                    <select name="stateCode" defaultValue={selectedLedger?.stateCode || ''} className="input-field" required>
                      <option value="">Select State</option>
                      {Object.entries(GST_STATES).map(([code, name]) => (
                        <option key={code} value={code}>{name} ({code})</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              {['Purchase Accounts', 'Direct Expenses', 'Indirect Expenses'].includes(selectedGroup) && (
                <div className="col-span-2 bg-amber-50/60 border border-amber-200/60 p-4 rounded-xl flex items-center justify-between shadow-xs">
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">Subject to Reverse Charge (RCM)</span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">Automatically segment all purchase transactions under this layout on your GSTR-3B report.</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      name="subjectToRCM" 
                      defaultChecked={selectedLedger?.subjectToRCM || false}
                      className="sr-only peer" 
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>
              )}
              <div>
                <label className="label">Opening Balance</label>
                <input name="openingBalance" type="number" className="input-field" defaultValue={selectedLedger?.openingBalance || "0"} />
              </div>
              {['Sundry Debtors', 'Sundry Creditors'].includes(selectedGroup) && (
                <>
                  <div>
                    <label className="label">Mobile Number</label>
                    <input name="mobile" defaultValue={selectedLedger?.mobile || ''} className="input-field" />
                  </div>
                  <div className="col-span-2">
                    <label className="label">Address</label>
                    <textarea name="address" defaultValue={selectedLedger?.address || ''} className="input-field h-20" />
                  </div>
                </>
              )}
              
              <div className="col-span-2 flex justify-end gap-3 mt-4">
                <button type="button" onClick={() => { setShowAdd(false); setSelectedLedger(null); }} className="btn-secondary">Cancel</button>
                {!selectedLedger && (
                  <button type="button" onClick={(e) => {
                    const form = (e.target as any).closest('form');
                    if (form.checkValidity()) {
                      handleSubmit({ ...e, target: form, preventDefault: () => {} } as any, true);
                    } else {
                      form.reportValidity();
                    }
                  }} className="btn-secondary border-indigo-200 text-indigo-600">Save & Add Next</button>
                )}
                <button type="submit" className="btn-primary px-8">
                  {selectedLedger ? 'Update Ledger' : 'Save Ledger'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {ledgerToDelete && (
        <div className="fixed inset-0 bg-black/60 z-[110] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }} 
            animate={{ opacity: 1, scale: 1 }} 
            className="bg-white rounded-2xl border border-slate-100 shadow-2xl p-6 max-w-md w-full space-y-4 text-left"
          >
            <div className="flex items-start gap-4 text-left">
              <div className="p-3 bg-red-100 rounded-xl text-red-650 shrink-0">
                <Trash2 size={24} />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-bold text-slate-900 font-sans">Delete Ledger Account</h4>
                <p className="text-xs text-slate-550 leading-relaxed font-sans">
                  Are you sure you want to delete <span className="font-bold text-slate-800">"{ledgerToDelete.name}"</span>? This action is permanent and cannot be undone.
                </p>
              </div>
            </div>

            {deleteError && (
              <div className="bg-red-50 border border-red-100 p-3 rounded-xl text-xs font-semibold text-red-600 leading-normal font-sans text-left">
                {deleteError}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2 font-sans text-xs">
              <button 
                type="button" 
                onClick={() => {
                  setLedgerToDelete(null);
                  setDeleteError(null);
                }} 
                className="px-4 py-2 hover:bg-slate-100 border border-slate-200 font-bold text-slate-600 rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button 
                type="button" 
                onClick={confirmDelete}
                className="px-4 py-2 bg-red-650 hover:bg-red-700 font-bold text-white rounded-xl transition-all cursor-pointer"
              >
                Confirm Delete
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};
