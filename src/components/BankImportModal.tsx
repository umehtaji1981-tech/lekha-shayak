import React, { useState, useMemo, useEffect } from 'react';
import { Upload, X, AlertCircle, FileCode, ArrowRight, FileSpreadsheet, Cpu, Search, Plus, CheckCircle2, AlertTriangle, Check, Loader2, Save, UserPlus, ShieldAlert, ShieldCheck, UserCheck, Package, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TallyVoucher } from '../services/tallyImport';
import { parseBankFile } from '../services/bankImport';
import { dbService } from '../lib/db';

interface BankImportModalProps {
  onImport: (vouchers: TallyVoucher[]) => Promise<void>;
  onClose: () => void;
  ledgers: any[];
  items?: any[];
  onCreateLedger?: (name: string, group: string) => Promise<any>;
  companyId?: string;
  activeFY?: any;
}

export const BankImportModal = ({ onImport, onClose, ledgers, items = [], onCreateLedger, companyId, activeFY }: BankImportModalProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [vouchers, setVouchers] = useState<TallyVoucher[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingVoucherIdx, setEditingVoucherIdx] = useState<number | null>(null);
  const [savingSingleIdx, setSavingSingleIdx] = useState<number | null>(null);
  const [ledgerSearchTerm, setLedgerSearchTerm] = useState('');
  const [activeBankId, setActiveBankId] = useState<string>('');

  // Tab states and de-duplication mapping guards
  const [activeImportTab, setActiveImportTab] = useState<'vouchers' | 'integrity'>('vouchers');
  const [ledgerMappings, setLedgerMappings] = useState<Record<string, { action: 'create' | 'map' | 'skip'; targetId?: string; group?: string }>>({});
  const [itemMappings, setItemMappings] = useState<Record<string, { action: 'create' | 'map' | 'skip'; targetId?: string; gstRate?: number; hsn?: string }>>({});

  // Quick Add ledger state
  const [quickAddRowIndex, setQuickAddRowIndex] = useState<number | null>(null);
  const [quickLedgerName, setQuickLedgerName] = useState('');
  const [quickLedgerGroup, setQuickLedgerGroup] = useState('Sundry Debtors');

  // Filter ledgers to Cash and Bank Accounts
  const bankLedgers = useMemo(() => {
    return ledgers.filter(l => ['Bank Accounts', 'Bank', 'Cash-in-hand', 'Cash'].includes(l.group));
  }, [ledgers]);

  // Memoized unique newly discovered parties and stock items
  const newlyDetectedParties = useMemo(() => {
    if (vouchers.length === 0) return [];
    const list: { name: string; type: string; occurrences: number }[] = [];
    vouchers.forEach(v => {
      if (!v.partyName) return;
      const isExist = ledgers.some(l => l.name.toLowerCase() === v.partyName.toLowerCase());
      if (!isExist) {
        const idx = list.findIndex(p => p.name.toLowerCase() === v.partyName.toLowerCase());
        if (idx === -1) {
          list.push({ name: v.partyName, type: v.type, occurrences: 1 });
        } else {
          list[idx].occurrences += 1;
        }
      }
    });
    return list;
  }, [vouchers, ledgers]);

  const newlyDetectedItems = useMemo(() => {
    if (vouchers.length === 0) return [];
    const list: { name: string; occurrences: number }[] = [];
    vouchers.forEach(v => {
      const invs = (v as any).inventoryEntries || [];
      invs.forEach((inv: any) => {
        if (!inv.name) return;
        const isExist = (items || []).some(i => i.name.toLowerCase() === inv.name.toLowerCase());
        if (!isExist) {
          const idx = list.findIndex(pt => pt.name.toLowerCase() === inv.name.toLowerCase());
          if (idx === -1) {
            list.push({ name: inv.name, occurrences: 1 });
          } else {
            list[idx].occurrences += 1;
          }
        }
      });
    });
    return list;
  }, [vouchers, items]);

  // Default corporate firm bank account
  useEffect(() => {
    if (bankLedgers.length > 0 && !activeBankId) {
      const defaultBank = bankLedgers.find(l => l.group === 'Bank Accounts') || bankLedgers[0];
      setActiveBankId(defaultBank.id);
    }
  }, [bankLedgers, activeBankId]);

  const [aiSuggestingIdx, setAiSuggestingIdx] = useState<number | null>(null);

  const getLocalFuzzyMatch = (narration: string, currentLedgers: any[]) => {
    const normNarr = narration.toLowerCase();
    
    // Look for exact matches or containing matches
    const match = currentLedgers.find(l => {
      const normLedger = (l.name || '').toLowerCase();
      if (!normLedger) return false;
      return normNarr.includes(normLedger);
    });
    if (match) return match;

    // Smart keyword mapping rule lists for India context
    const rules = [
      { keywords: ['charge', 'chg', 'fee', 'comm', 'commission', 'charges'], ledgerNames: ['Bank Charges', 'Bank Charges & Commission', 'Charges'] },
      { keywords: ['fuel', 'petrol', 'diesel', 'hpcl', 'bpcl', 'iocl', 'shell'], ledgerNames: ['Fuel Expenses', 'Vehicle Expenses', 'Conveyance Expenses'] },
      { keywords: ['salary', 'wage', 'salaries'], ledgerNames: ['Salary Expenses', 'Wages', 'Salary'] },
      { keywords: ['broker', 'advocate', 'legal', 'consultant'], ledgerNames: ['Legal & Professional Fees', 'Consulting Charges'] },
      { keywords: ['rent', 'lease', 'office rent'], ledgerNames: ['Rent Account', 'Office Rent', 'Rent Expenses'] },
      { keywords: ['interest', 'dividend'], ledgerNames: ['Interest Income', 'Interest Paid', 'Finance Costs'] },
      { keywords: ['tax', 'gst', 'tds', 'tcs'], ledgerNames: ['GST Payable', 'TDS Payable', 'Duties & Taxes'] },
      { keywords: ['upi', 'paytm', 'phonepe', 'gpay', 'suspense'], ledgerNames: ['Suspense Account', 'Cash-in-hand'] }
    ];

    for (const rule of rules) {
      if (rule.keywords.some(kw => normNarr.includes(kw))) {
        const matchedAccount = currentLedgers.find(l => 
          rule.ledgerNames.some(name => (l.name || '').toLowerCase().includes(name.toLowerCase()))
        );
        if (matchedAccount) return matchedAccount;
      }
    }
    return null;
  };

  const fetchAiLedgerSuggestion = async (idx: number, description: string) => {
    if (aiSuggestingIdx !== null) return;
    setAiSuggestingIdx(idx);
    try {
      const response = await fetch('/api/ai/suggest-ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          ledgers: ledgers.map(l => ({ id: l.id, name: l.name, group: l.group }))
        })
      });
      const data = await response.json();
      if (data.isMatchFound && data.matchedLedgerName) {
        const newV = [...vouchers];
        newV[idx].partyName = data.matchedLedgerName;
        newV[idx].isAiMapped = true;
        setVouchers(newV);
      } else if (data.suggestedLedgerName) {
        setQuickAddRowIndex(idx);
        setQuickLedgerName(data.suggestedLedgerName);
        setQuickLedgerGroup(data.suggestedLedgerGroup || 'Indirect Expenses');
        alert(`AI Suggestion: Close ledger not found. Suggested creating: "${data.suggestedLedgerName}" (under ${data.suggestedLedgerGroup || 'Indirect Expenses'}).\n\nReason: ${data.reasoning || ''}`);
      } else {
        alert("AI could not map this narration description. Please map manually.");
      }
    } catch (err) {
      console.error(err);
      alert("AI mapping server request failed.");
    } finally {
      setAiSuggestingIdx(null);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    
    setFile(selectedFile);
    setIsParsing(true);
    setError(null);

    try {
      const parsed = await parseBankFile(selectedFile);
      // Enrich vouchers with current ledger matches using dual exact + fuzzy rule mapping
      const enriched = parsed.map(v => {
        let matchedLedger = ledgers.find(l => 
          (l.name || '').toLowerCase() === (v.partyName || '').toLowerCase()
        );

        let isLocalSubMatch = false;
        if (!matchedLedger) {
          // Substring matching
          matchedLedger = ledgers.find(l => 
            (v.narration || '').toLowerCase().includes((l.name || '').toLowerCase())
          );
        }

        if (!matchedLedger) {
          // Rule based fuzzy matching (e.g. CHG/SBI -> Bank Charges)
          matchedLedger = getLocalFuzzyMatch(v.narration || '', ledgers);
          if (matchedLedger) {
            isLocalSubMatch = true;
          }
        }

        const partyName = matchedLedger ? matchedLedger.name : v.partyName;
        let suggestedGroup = v.type === 'Receipt' ? 'Sundry Debtors' : 'Sundry Creditors';
        if (matchedLedger) {
          suggestedGroup = matchedLedger.group || suggestedGroup;
        } else {
          const normNarr = (v.narration || '').toLowerCase();
          if (normNarr.includes('charge') || normNarr.includes('chg') || normNarr.includes('fuel') || normNarr.includes('salary') || normNarr.includes('rent')) {
            suggestedGroup = 'Indirect Expenses';
          }
        }

        return {
          ...v,
          partyName,
          matchedLedgerId: matchedLedger?.id || null,
          isLocalFuzzyMatched: isLocalSubMatch,
          suggestedGroup,
          saved: false
        };
      });
      setVouchers(enriched);

      // Automated initializing mapping configurations
      const freshLedgerMap: Record<string, { action: 'create' | 'map' | 'skip'; targetId?: string; group?: string }> = {};
      const freshItemMap: Record<string, { action: 'create' | 'map' | 'skip'; targetId?: string; gstRate?: number; hsn?: string }> = {};
      
      parsed.forEach(v => {
        if (v.partyName) {
          const isExist = ledgers.some(l => l.name.toLowerCase() === v.partyName.toLowerCase());
          if (!isExist && !freshLedgerMap[v.partyName]) {
            let group = 'Sundry Debtors';
            if (v.type === 'Purchases' || v.type === 'Payment') {
              group = 'Sundry Creditors';
            }
            freshLedgerMap[v.partyName] = { action: 'create', group };
          }
        }
        
        const invs = (v as any).inventoryEntries || [];
        invs.forEach((inv: any) => {
          if (inv.name) {
            const isExist = (items || []).some(i => i.name.toLowerCase() === inv.name.toLowerCase());
            if (!isExist && !freshItemMap[inv.name]) {
              freshItemMap[inv.name] = { action: 'create', gstRate: 18, hsn: '' };
            }
          }
        });
      });
      setLedgerMappings(freshLedgerMap);
      setItemMappings(freshItemMap);

      const hasNewEntities = Object.keys(freshLedgerMap).length > 0 || Object.keys(freshItemMap).length > 0;
      setActiveImportTab(hasNewEntities ? 'integrity' : 'vouchers');
    } catch (err) {
      setError("Failed to parse file. " + (err instanceof Error ? err.message : "Please ensure it's a valid format."));
      console.error(err);
    } finally {
      setIsParsing(false);
    }
  };

  const updateVoucherLedger = (idx: number, ledgerName: string) => {
    const newVouchers = [...vouchers];
    newVouchers[idx].partyName = ledgerName;
    setVouchers(newVouchers);
    setEditingVoucherIdx(null);
  };

  const handleCreateAndAssignLedger = async (idx: number, name: string, group?: string) => {
    const defGroup = group || (vouchers[idx].type === 'Receipt' ? 'Sundry Debtors' : 'Sundry Creditors');
    if (onCreateLedger) {
      try {
        await onCreateLedger(name, defGroup);
        updateVoucherLedger(idx, name);
      } catch (err) {
        console.error("Failed to create ledger", err);
      }
    } else if (companyId) {
      try {
        await dbService.add(`companies/${companyId}/ledgers`, {
          name,
          group: defGroup,
          openingBalance: 0,
          currentBalance: 0,
          companyId
        });
        updateVoucherLedger(idx, name);
      } catch (err) {
        console.error("Failed to create ledger via dbService", err);
      }
    }
  };

  const handleCreateLedgerOnTheFly = async (name: string, group: string) => {
    try {
      const docRef = await dbService.add(`companies/${companyId}/ledgers`, {
        name,
        group,
        openingBalance: 0,
        currentBalance: 0,
        companyId,
        createdAt: new Date().toISOString()
      });
      return docRef.id;
    } catch (err) {
      console.error("Fly ledger creation error", err);
      throw err;
    }
  };

  const handleCreateItemOnTheFly = async (name: string, gstRate: number, hsn: string) => {
    try {
      const docRef = await dbService.add(`companies/${companyId}/items`, {
        name,
        hsn: hsn || '',
        sku: `SKU-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`,
        unit: 'PCS',
        gstRate: Number(gstRate) || 18,
        purchasePrice: 0,
        salesPrice: 0,
        stockLevel: 0,
        openingStockQty: 0,
        openingStockRate: 0,
        openingStockValue: 0,
        companyId,
        createdAt: new Date().toISOString()
      });
      return docRef.id;
    } catch (err) {
      console.error("Fly item creation error", err);
      throw err;
    }
  };

  const resolveMappingRules = async () => {
    if (!companyId) return { resolvedParties: {}, resolvedItems: {} };

    const resolvedParties: Record<string, { id: string; name: string }> = {};
    const resolvedItems: Record<string, { id: string; name: string }> = {};

    // 1. Core ledger mappings
    for (const p of newlyDetectedParties) {
      const rule = ledgerMappings[p.name] || { action: 'create', group: 'Sundry Debtors' };
      if (rule.action === 'skip') {
        continue;
      } else if (rule.action === 'map' && rule.targetId) {
        const found = ledgers.find(l => l.id === rule.targetId);
        if (found) {
          resolvedParties[p.name.toLowerCase()] = { id: found.id, name: found.name };
        }
      } else {
        // action === 'create'
        const existingInDb = ledgers.find(l => l.name.toLowerCase() === p.name.toLowerCase());
        if (existingInDb) {
          resolvedParties[p.name.toLowerCase()] = { id: existingInDb.id, name: existingInDb.name };
        } else {
          const lid = await handleCreateLedgerOnTheFly(p.name, rule.group || 'Sundry Debtors');
          resolvedParties[p.name.toLowerCase()] = { id: lid, name: p.name };
        }
      }
    }

    // 2. Core item mappings
    for (const it of newlyDetectedItems) {
      const rule = itemMappings[it.name] || { action: 'create', gstRate: 18, hsn: '' };
      if (rule.action === 'skip') {
        continue;
      } else if (rule.action === 'map' && rule.targetId) {
        const found = (items || []).find(i => i.id === rule.targetId);
        if (found) {
          resolvedItems[it.name.toLowerCase()] = { id: found.id, name: found.name };
        }
      } else {
        // action === 'create'
        const existingInDb = (items || []).find(i => i.name.toLowerCase() === it.name.toLowerCase());
        if (existingInDb) {
          resolvedItems[it.name.toLowerCase()] = { id: existingInDb.id, name: existingInDb.name };
        } else {
          const iid = await handleCreateItemOnTheFly(it.name, rule.gstRate || 18, rule.hsn || '');
          resolvedItems[it.name.toLowerCase()] = { id: iid, name: it.name };
        }
      }
    }

    return { resolvedParties, resolvedItems };
  };

  const handleSaveSingleVoucher = async (idx: number) => {
    if (!companyId) {
      alert("Error: Company ID is required to save transactions.");
      return;
    }
    if (!activeBankId) {
      alert("Please select a Statement Firm Bank/Cash Account first.");
      return;
    }

    setSavingSingleIdx(idx);
    try {
      const v = vouchers[idx];
      const selectedBank = ledgers.find(l => l.id === activeBankId);
      
      const ptMap = ledgerMappings[v.partyName];
      if (ptMap && ptMap.action === 'skip') {
        alert("This record is skipped by current mapping rules. Uncheck skip on integrity panel before saving.");
        setSavingSingleIdx(null);
        return;
      }

      // Resolve maps
      const { resolvedParties, resolvedItems } = await resolveMappingRules();

      let ledgerId = '';
      let partyName = v.partyName;

      const resolvedPt = resolvedParties[v.partyName.toLowerCase()];
      if (resolvedPt) {
        ledgerId = resolvedPt.id;
        partyName = resolvedPt.name;
      } else {
        let ledger = ledgers.find(l => (l.name || '').toLowerCase() === (v.partyName || '').toLowerCase());
        ledgerId = ledger?.id || '';
        partyName = ledger?.name || v.partyName;
      }

      if (!ledgerId) {
        let group = v.type === 'Receipt' ? 'Sundry Debtors' : 'Sundry Creditors';
        if (v.type === 'Contra') group = 'Bank Accounts';

        const createdId = await handleCreateLedgerOnTheFly(v.partyName, group);
        ledgerId = createdId;
        partyName = v.partyName;
      }

      // Map inventory
      const invoiceItems: any[] = [];
      const invs = (v as any).inventoryEntries || [];
      for (const entry of invs) {
        if (!entry.name) continue;
        const itMap = itemMappings[entry.name];
        if (itMap && itMap.action === 'skip') continue;

        let itemId = '';
        let itemName = entry.name;
        const resolvedIt = resolvedItems[entry.name.toLowerCase()];
        if (resolvedIt) {
          itemId = resolvedIt.id;
          itemName = resolvedIt.name;
        } else {
          const foundIt = (items || []).find(it => it.name.toLowerCase() === entry.name.toLowerCase());
          itemId = foundIt?.id || '';
          itemName = foundIt?.name || entry.name;
        }

        if (itemId) {
          const rate = Number(entry.rate) || Number(entry.amount);
          const qty = Number(entry.qty) || 1;
          const amount = Number(entry.amount);
          const activeGstRate = itMap?.gstRate || 18;
          const itemTax = amount * (activeGstRate / 100);

          invoiceItems.push({
            itemId,
            name: itemName,
            qty,
            rate,
            amount,
            gstRate: activeGstRate,
            cgst: itemTax / 2,
            sgst: itemTax / 2,
            igst: itemTax,
            tax: itemTax
          });
        }
      }

      const isDeposit = v.type === 'Receipt';
      if (activeFY) {
        if (v.date < activeFY.startDate || v.date > activeFY.endDate) {
          alert(`Error: This transaction date (${v.date}) is outside the active financial year ${activeFY.label} (${activeFY.startDate} to ${activeFY.endDate}).`);
          setSavingSingleIdx(null);
          return;
        }
      }

      await dbService.addTransactionWithStock(companyId, {
        type: v.type, // 'Receipt' | 'Payment' | 'Contra'
        date: v.date,
        partyId: ledgerId,
        partyName: partyName,
        bankId: activeBankId,
        bankName: selectedBank?.name || 'Local Account',
        totalAmount: Number(v.amount),
        netAmount: Number(v.amount),
        isDeposit: isDeposit,
        notes: `Imported via Statement (Single): ${v.narration}`,
        narration: `Imported via Statement (Single): ${v.narration}`,
        status: 'PAID',
        fy: activeFY?.id || '',
        voucherNumber: v.voucherNumber || `${v.type.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-6)}-${idx}`,
        items: invoiceItems.length > 0 ? invoiceItems : null
      });

      const updated = [...vouchers];
      updated[idx] = {
        ...updated[idx],
        saved: true
      } as any;
      setVouchers(updated);
    } catch (err: any) {
      alert("Failed to save transaction: " + err.message);
    } finally {
      setSavingSingleIdx(null);
    }
  };

  const handleImport = async () => {
    if (!companyId) {
      setIsImporting(true);
      try {
        await onImport(vouchers.filter(v => !(v as any).saved));
        onClose();
      } catch (err) {
        setError("Import failed. Please check your data.");
      } finally {
        setIsImporting(false);
      }
      return;
    }

    if (!activeBankId) {
      alert("Please select a Statement Firm Bank/Cash Account first.");
      return;
    }

    setIsImporting(true);
    try {
      const selectedBank = ledgers.find(l => l.id === activeBankId);
      const pending = vouchers.filter(v => !(v as any).saved);
      const invalidDates = pending.filter(v => activeFY && (v.date < activeFY.startDate || v.date > activeFY.endDate));
      if (invalidDates.length > 0) {
        alert(`Error: ${invalidDates.length} transaction entries are outside the active financial year ${activeFY.label || ''} (${activeFY.startDate} to ${activeFY.endDate}). Please modify or exclude them before importing.`);
        setIsImporting(false);
        return;
      }

      // First run: resolve all pending automated allocations
      const { resolvedParties, resolvedItems } = await resolveMappingRules();

      let successCount = 0;

      for (let i = 0; i < pending.length; i++) {
        const v = pending[i];
        
        // Skip voucher if its main party is set to skip
        const ptMap = ledgerMappings[v.partyName];
        if (ptMap && ptMap.action === 'skip') {
          continue;
        }

        let ledgerId = '';
        let partyName = v.partyName;

        const resolvedPt = resolvedParties[v.partyName.toLowerCase()];
        if (resolvedPt) {
          ledgerId = resolvedPt.id;
          partyName = resolvedPt.name;
        } else {
          let ledger = ledgers.find(l => (l.name || '').toLowerCase() === (v.partyName || '').toLowerCase());
          ledgerId = ledger?.id || '';
          partyName = ledger?.name || v.partyName;
        }

        if (!ledgerId) {
          // Fallback creation
          let group = v.type === 'Receipt' ? 'Sundry Debtors' : 'Sundry Creditors';
          if (v.type === 'Contra') group = 'Bank Accounts';

          const createdId = await handleCreateLedgerOnTheFly(v.partyName, group);
          ledgerId = createdId;
          partyName = v.partyName;
        }

        // Parse and map inventory items
        const invoiceItems: any[] = [];
        const invs = (v as any).inventoryEntries || [];
        for (const entry of invs) {
          if (!entry.name) continue;
          
          const itMap = itemMappings[entry.name];
          if (itMap && itMap.action === 'skip') {
            continue;
          }

          let itemId = '';
          let itemName = entry.name;
          const resolvedIt = resolvedItems[entry.name.toLowerCase()];
          if (resolvedIt) {
            itemId = resolvedIt.id;
            itemName = resolvedIt.name;
          } else {
            const foundIt = (items || []).find(it => it.name.toLowerCase() === entry.name.toLowerCase());
            itemId = foundIt?.id || '';
            itemName = foundIt?.name || entry.name;
          }

          if (itemId) {
            const rate = Number(entry.rate) || Number(entry.amount);
            const qty = Number(entry.qty) || 1;
            const amount = Number(entry.amount);
            const activeGstRate = itMap?.gstRate || 18;
            const itemTax = amount * (activeGstRate / 100);

            invoiceItems.push({
              itemId,
              name: itemName,
              qty,
              rate,
              amount,
              gstRate: activeGstRate,
              cgst: itemTax / 2,
              sgst: itemTax / 2,
              igst: itemTax,
              tax: itemTax
            });
          }
        }

        const isDeposit = v.type === 'Receipt';
        await dbService.addTransactionWithStock(companyId, {
          type: v.type, // 'Receipt' | 'Payment' | 'Contra'
          date: v.date,
          partyId: ledgerId,
          partyName: partyName,
          bankId: activeBankId,
          bankName: selectedBank?.name || 'Local Account',
          totalAmount: Number(v.amount),
          netAmount: Number(v.amount),
          isDeposit: isDeposit,
          notes: `Imported via Statement Bank Import: ${v.narration}`,
          narration: `Imported via Statement Bank Import: ${v.narration}`,
          status: 'PAID',
          fy: activeFY?.id || '',
          voucherNumber: v.voucherNumber || `${v.type.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-6)}-B${i}`,
          items: invoiceItems.length > 0 ? invoiceItems : null
        });
        successCount++;
      }

      alert(`Successfully validated and imported ${successCount} entries, with automated de-duplication mappings applied!`);
      onClose();
    } catch (err: any) {
      setError("Import failed: " + err.message);
    } finally {
      setIsImporting(false);
    }
  };

  const filteredVouchers = useMemo(() => {
    return vouchers.filter(v => 
      (v.partyName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (v.narration || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (v.amount.toString()).includes(searchTerm)
    );
  }, [vouchers, searchTerm]);

  // Group ledgers by group for dynamic layout structuring
  const groupedLedgers = useMemo(() => {
    return ledgers.reduce((acc: any, ledger) => {
      const grp = ledger.group || 'Other Ledgers';
      if (!acc[grp]) acc[grp] = [];
      acc[grp].push(ledger);
      return acc;
    }, {});
  }, [ledgers]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-[32px] shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col h-[85vh]"
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white">
          <div className="flex items-center gap-4">
             <div className="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-100 italic font-black text-xl animate-pulse">
                B
             </div>
             <div>
                <h3 className="font-black text-slate-900 text-xl tracking-tight">Statement Import Center</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Excel • PDF • CSV • AI Reconciliation & Contra Engine</p>
             </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-50 rounded-full transition-colors text-slate-400 hover:text-slate-900">
            <X size={20} />
          </button>
        </div>

        {/* Global Dest Bank Account Selector bar */}
        {file && bankLedgers.length > 0 && (
          <div className="px-6 py-3.5 bg-indigo-50/40 border-b flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-black uppercase tracking-wider text-slate-500">Statement Firm Bank / Cash Account:</span>
              <select
                className="bg-white border border-slate-250 rounded-xl px-4 py-1.5 text-xs font-bold text-indigo-700 focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all shadow-sm max-w-xs"
                value={activeBankId}
                onChange={(e) => setActiveBankId(e.target.value)}
              >
                {bankLedgers.map(l => (
                  <option key={l.id} value={l.id}>{l.name} ({l.group})</option>
                ))}
              </select>
            </div>

            <div className="flex gap-4 text-[10px] font-bold text-slate-500">
              <span className="bg-white px-2.5 py-1.5 rounded-lg border">
                Deposits: <span className="text-emerald-600 font-extrabold font-mono">₹{vouchers.filter(t => t.type === 'Receipt').reduce((sum, t) => sum + t.amount, 0).toLocaleString()}</span>
              </span>
              <span className="bg-white px-2.5 py-1.5 rounded-lg border">
                Withdrawals: <span className="text-rose-600 font-extrabold font-mono">₹{vouchers.filter(t => t.type === 'Payment').reduce((sum, t) => sum + t.amount, 0).toLocaleString()}</span>
              </span>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-hidden flex flex-col bg-slate-50/50">
          {!file ? (
            <div className="p-12 flex flex-col items-center justify-center h-full">
              <div className="w-full max-w-lg bg-white border-2 border-dashed border-slate-200 rounded-[32px] p-12 text-center group hover:border-indigo-400 transition-colors">
                <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
                  <Upload size={32} />
                </div>
                <h4 className="text-xl font-black text-slate-900 mb-2">Upload your bank statement</h4>
                <p className="text-slate-500 text-sm mb-8 font-medium">We'll automatically extract date, particulars, and amount. AI will try to guess the ledgers.</p>
                
                <div className="grid grid-cols-2 gap-3 mb-8 text-left max-w-sm mx-auto">
                   <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <p className="text-[10px] font-black text-indigo-600 uppercase mb-1">Top Suggestion</p>
                      <p className="text-[11px] font-bold text-slate-700 leading-tight">Download "Detailed Statement" in Excel/CSV format from NetBanking.</p>
                   </div>
                   <div className="p-3 bg-slate-100/50 rounded-xl border border-slate-100">
                      <p className="text-[10px] font-black text-indigo-600 uppercase mb-1">Major Banks</p>
                      <p className="text-[11px] font-bold text-slate-700 leading-tight">HDFC, SBI, ICICI & Axis (Excel/PDF) are fully supported.</p>
                   </div>
                </div>

                <label className="btn-primary-lg inline-flex items-center gap-2 cursor-pointer shadow-xl shadow-indigo-100 hover:shadow-indigo-200 transition-all">
                   Select File
                  <input type="file" accept=".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png" className="hidden" onChange={handleFileChange} />
                </label>
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full overflow-hidden">
               {/* Controls / Double Tabs */}
               <div className="flex bg-slate-100/80 border-b border-slate-200/50 p-1 font-bold text-xs shrink-0 select-none">
                 <button
                   onClick={() => setActiveImportTab('integrity')}
                   className={`flex-1 py-3 text-center rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer ${
                     activeImportTab === 'integrity' 
                     ? 'bg-white text-indigo-700 shadow-sm font-black border border-slate-200/50 outline-none' 
                     : 'text-slate-500 hover:text-slate-800'
                   }`}
                 >
                   <ShieldAlert size={14} className={newlyDetectedParties.length + newlyDetectedItems.length > 0 ? "text-orange-500 animate-pulse font-black" : ""} />
                   Validation & Duplication Preventer ({newlyDetectedParties.length + newlyDetectedItems.length} Discovered)
                 </button>
                 <button
                   onClick={() => setActiveImportTab('vouchers')}
                   className={`flex-1 py-3 text-center rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer ${
                     activeImportTab === 'vouchers' 
                     ? 'bg-white text-indigo-700 shadow-sm font-black border border-slate-200/50 outline-none' 
                     : 'text-slate-500 hover:text-slate-800'
                   }`}
                 >
                   <FileSpreadsheet size={14} />
                   Voucher Journal Entries ({vouchers.length})
                 </button>
               </div>

               {activeImportTab === 'integrity' && (
                 <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-slate-50">
                   
                   {/* Overview Card */}
                   <div className="p-5 bg-gradient-to-r from-indigo-50 to-blue-50/50 border border-indigo-100 rounded-3xl flex items-start gap-4">
                     <div className="p-3 bg-indigo-600 text-white rounded-2xl shrink-0">
                       <ShieldCheck size={24} />
                     </div>
                     <div>
                       <h4 className="text-sm font-black text-slate-800 font-sans">Tally XML Quality & Duplication Guard ACTIVE</h4>
                       <p className="text-xs text-slate-500 leading-relaxed mt-1 font-sans">
                         We analyzed your file and found <strong>{newlyDetectedParties.length} new ledgers</strong> and <strong>{newlyDetectedItems.length} new stock items</strong>. 
                         Choose whether to automatically create them instantly, map them to existing registers, or skip them to avoid duplicating your records.
                       </p>
                     </div>
                   </div>

                   {/* Grid of Ledgers and Items */}
                   <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                     
                     {/* Ledgers Panel */}
                     <div className="space-y-4">
                       <div className="flex items-center justify-between font-sans">
                         <h5 className="text-xs font-black uppercase text-slate-400 tracking-wider flex items-center gap-2">
                           <UserCheck size={14} className="text-indigo-600" />
                           1. Newly Discovered Ledgers ({newlyDetectedParties.length})
                         </h5>
                         <span className="text-[10px] bg-slate-200/60 font-extrabold px-2 py-0.5 rounded text-slate-550 uppercase">Interactive Mapping</span>
                       </div>

                       {newlyDetectedParties.length === 0 ? (
                         <div className="p-8 bg-white border border-slate-100 text-center rounded-3xl text-slate-400 text-xs font-sans">
                           <Check size={32} className="text-emerald-500 mx-auto mb-2" />
                           All party ledgers matched perfectly with your database! No duplication risk.
                         </div>
                       ) : (
                         <div className="space-y-3">
                           {newlyDetectedParties.map((p, idx) => {
                             const currentVal = ledgerMappings[p.name] || { action: 'create', group: 'Sundry Debtors' };
                             return (
                               <div key={idx} className={`p-4 bg-white rounded-2xl border transition-all ${
                                 currentVal.action === 'skip' ? 'border-slate-200 opacity-60 bg-slate-50' :
                                 currentVal.action === 'map' ? 'border-indigo-600 ring-2 ring-indigo-50' : 'border-slate-100 hover:border-indigo-100'
                               }`}>
                                 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 font-sans">
                                   <div>
                                     <p className="text-xs font-black text-slate-800 break-all">{p.name}</p>
                                     <p className="text-[10px] text-slate-400 mt-0.5">Found {p.occurrences} times in voucher entries</p>
                                   </div>

                                   {/* Action selector */}
                                   <div className="flex flex-wrap gap-2 shrink-0 select-none">
                                     <button
                                       type="button"
                                       onClick={() => setLedgerMappings(prev => ({
                                         ...prev,
                                         [p.name]: { ...prev[p.name], action: 'create', group: p.type === 'Purchases' || p.type === 'Payment' ? 'Sundry Creditors' : 'Sundry Debtors' }
                                       }))}
                                       className={`px-2.5 py-1 text-[10px] font-black rounded-lg uppercase tracking-wider transition-all border cursor-pointer ${
                                         currentVal.action === 'create' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-50 text-slate-400 border-slate-150 hover:bg-slate-100'
                                       }`}
                                     >
                                       🆕 Create
                                     </button>
                                     <button
                                       type="button"
                                       onClick={() => setLedgerMappings(prev => ({
                                         ...prev,
                                         [p.name]: { ...prev[p.name], action: 'map', targetId: ledgers[0]?.id || '' }
                                       }))}
                                       className={`px-2.5 py-1 text-[10px] font-black rounded-lg uppercase tracking-wider transition-all border cursor-pointer ${
                                         currentVal.action === 'map' ? 'bg-indigo-50 border-indigo-200 text-indigo-805' : 'bg-slate-50 text-slate-400 border-slate-150 hover:bg-slate-100'
                                       }`}
                                     >
                                       🔗 Map
                                     </button>
                                     <button
                                       type="button"
                                       onClick={() => setLedgerMappings(prev => ({
                                         ...prev,
                                         [p.name]: { ...prev[p.name], action: 'skip' }
                                       }))}
                                       className={`px-2.5 py-1 text-[10px] font-black rounded-lg uppercase tracking-wider transition-all border cursor-pointer ${
                                         currentVal.action === 'skip' ? 'bg-rose-50 border-rose-200 text-rose-805' : 'bg-slate-50 text-slate-400 border-slate-150 hover:bg-slate-100'
                                       }`}
                                     >
                                       🚫 Skip
                                     </button>
                                   </div>
                                 </div>

                                 {/* Meta Fields based on Actions Chosen */}
                                 {currentVal.action === 'create' && (
                                   <div className="mt-3 pt-3 border-t border-slate-105 flex items-center justify-between gap-4 bg-slate-100/50 -mx-4 -mb-4 p-3 rounded-b-2xl font-sans">
                                     <span className="text-[10px] font-black uppercase text-slate-500">Account Parent Group:</span>
                                     <select
                                       value={currentVal.group || 'Sundry Debtors'}
                                       onChange={(e) => setLedgerMappings(prev => ({
                                         ...prev,
                                         [p.name]: { ...prev[p.name], group: e.target.value }
                                       }))}
                                       className="bg-white border rounded-xl py-1 px-3 text-xs font-bold text-slate-700 outline-none cursor-pointer font-sans"
                                     >
                                       <option value="Sundry Debtors">Sundry Debtors (Customers)</option>
                                       <option value="Sundry Creditors">Sundry Creditors (Suppliers)</option>
                                       <option value="Bank Accounts">Bank Accounts</option>
                                       <option value="Cash-in-hand">Cash-in-hand</option>
                                       <option value="Direct Expenses">Direct Expenses</option>
                                       <option value="Indirect Expenses">Indirect Expenses</option>
                                     </select>
                                   </div>
                                 )}

                                 {currentVal.action === 'map' && (
                                   <div className="mt-3 pt-3 border-t border-slate-105 flex items-center justify-between gap-4 bg-slate-100/50 -mx-4 -mb-4 p-3 rounded-b-2xl font-sans">
                                     <span className="text-[10px] font-black uppercase text-slate-500 flex items-center gap-1">
                                       <ArrowRight size={10} /> Map to Exist Ledger:
                                     </span>
                                     <select
                                       value={currentVal.targetId || ''}
                                       onChange={(e) => setLedgerMappings(prev => ({
                                         ...prev,
                                         [p.name]: { ...prev[p.name], targetId: e.target.value }
                                       }))}
                                       className="bg-white border text-center rounded-xl py-1 px-3 text-xs font-bold text-slate-700 outline-none max-w-xs cursor-pointer font-sans"
                                     >
                                       {ledgers.map(l => (
                                         <option key={l.id} value={l.id}>{l.name} ({l.group})</option>
                                       ))}
                                     </select>
                                   </div>
                                 )}
                               </div>
                             );
                           })}
                         </div>
                       )}
                     </div>

                     {/* Stock Items Panel */}
                     <div className="space-y-4">
                       <div className="flex items-center justify-between font-sans">
                         <h5 className="text-xs font-black uppercase text-slate-400 tracking-wider flex items-center gap-2">
                           <Package size={14} className="text-indigo-600" />
                           2. Newly Discovered Stock Items ({newlyDetectedItems.length})
                         </h5>
                         <span className="text-[10px] bg-slate-200/60 font-extrabold px-2 py-0.5 rounded text-slate-550 uppercase">Tally Inventory Match</span>
                       </div>

                       {newlyDetectedItems.length === 0 ? (
                         <div className="p-8 bg-white border border-slate-100 text-center rounded-3xl text-slate-400 text-xs font-sans">
                           <Check size={32} className="text-emerald-500 mx-auto mb-2" />
                           No new stock items parsed from voucher list or they mapped cleanly.
                         </div>
                       ) : (
                         <div className="space-y-3 font-sans">
                           {newlyDetectedItems.map((itemObj, idx) => {
                             const currentVal = itemMappings[itemObj.name] || { action: 'create', gstRate: 18, hsn: '' };
                             return (
                               <div key={idx} className={`p-4 bg-white rounded-2xl border transition-all ${
                                 currentVal.action === 'skip' ? 'border-slate-200 opacity-60 bg-slate-50' :
                                 currentVal.action === 'map' ? 'border-indigo-600 ring-2 ring-indigo-50' : 'border-slate-100 hover:border-indigo-100'
                               }`}>
                                 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                   <div>
                                     <p className="text-xs font-black text-slate-800 break-all">{itemObj.name}</p>
                                     <p className="text-[10px] text-slate-400 mt-0.5">Discovered {itemObj.occurrences} times in Tally bills</p>
                                   </div>

                                   {/* Action selector */}
                                   <div className="flex flex-wrap gap-2 shrink-0 select-none">
                                     <button
                                       type="button"
                                       onClick={() => setItemMappings(prev => ({
                                         ...prev,
                                         [itemObj.name]: { ...prev[itemObj.name], action: 'create' }
                                       }))}
                                       className={`px-2.5 py-1 text-[10px] font-black rounded-lg uppercase tracking-wider transition-all border cursor-pointer ${
                                         currentVal.action === 'create' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-50 text-slate-400 border-slate-150 hover:bg-slate-100'
                                       }`}
                                     >
                                       🆕 Create
                                     </button>
                                     <button
                                       type="button"
                                       onClick={() => setItemMappings(prev => ({
                                         ...prev,
                                         [itemObj.name]: { ...prev[itemObj.name], action: 'map', targetId: (items || [])[0]?.id || '' }
                                       }))}
                                       className={`px-2.5 py-1 text-[10px] font-black rounded-lg uppercase tracking-wider transition-all border cursor-pointer ${
                                         currentVal.action === 'map' ? 'bg-indigo-50 border-indigo-200 text-indigo-805' : 'bg-slate-50 text-slate-400 border-slate-150 hover:bg-slate-100'
                                       }`}
                                     >
                                       🔗 Map
                                     </button>
                                     <button
                                       type="button"
                                       onClick={() => setItemMappings(prev => ({
                                         ...prev,
                                         [itemObj.name]: { ...prev[itemObj.name], action: 'skip' }
                                       }))}
                                       className={`px-2.5 py-1 text-[10px] font-black rounded-lg uppercase tracking-wider transition-all border cursor-pointer ${
                                         currentVal.action === 'skip' ? 'bg-rose-50 border-rose-200 text-rose-805' : 'bg-slate-50 text-slate-400 border-slate-150 hover:bg-slate-100'
                                       }`}
                                     >
                                       🚫 Skip
                                     </button>
                                   </div>
                                 </div>

                                 {/* Meta Fields based on Actions Chosen */}
                                 {currentVal.action === 'create' && (
                                   <div className="mt-3 pt-3 border-t border-slate-105 flex flex-col gap-2 bg-slate-100/50 -mx-4 -mb-4 p-3 rounded-b-2xl text-[11px]">
                                     <div className="flex justify-between items-center">
                                       <span className="font-bold text-slate-500">Standard GST Rate (%):</span>
                                       <select
                                         value={currentVal.gstRate || 18}
                                         onChange={(e) => setItemMappings(prev => ({
                                           ...prev,
                                           [itemObj.name]: { ...prev[itemObj.name], gstRate: Number(e.target.value) }
                                         }))}
                                         className="bg-white border rounded-xl py-1 px-3 text-xs font-bold text-slate-700 outline-none cursor-pointer"
                                       >
                                         <option value="5">5% GST</option>
                                         <option value="12">12% GST</option>
                                         <option value="18">18% GST</option>
                                         <option value="28">28% GST</option>
                                         <option value="0">0% (Exempt)</option>
                                       </select>
                                     </div>
                                     <div className="flex justify-between items-center">
                                       <span className="font-bold text-slate-500">HSN Code / SAC:</span>
                                       <input
                                         type="text"
                                         maxLength={8}
                                         value={currentVal.hsn || ''}
                                         onChange={(e) => setItemMappings(prev => ({
                                           ...prev,
                                           [itemObj.name]: { ...prev[itemObj.name], hsn: e.target.value }
                                         }))}
                                         placeholder="e.g. 84713010"
                                         className="bg-white border rounded-xl py-1 px-3 text-xs font-bold text-slate-705 outline-none text-right max-w-[140px] font-mono"
                                       />
                                     </div>
                                   </div>
                                 )}

                                 {currentVal.action === 'map' && (
                                   <div className="mt-3 pt-3 border-t border-slate-105 flex items-center justify-between gap-4 bg-slate-100/50 -mx-4 -mb-4 p-3 rounded-b-2xl">
                                     <span className="text-[10px] font-black uppercase text-slate-500 flex items-center gap-1">
                                       <ArrowRight size={10} /> Map to Exist Stock Item:
                                     </span>
                                     <select
                                       value={currentVal.targetId || ''}
                                       onChange={(e) => setItemMappings(prev => ({
                                         ...prev,
                                         [itemObj.name]: { ...prev[itemObj.name], targetId: e.target.value }
                                       }))}
                                       className="bg-white border rounded-xl py-1 px-3 text-xs font-bold text-slate-707 outline-none max-w-xs cursor-pointer"
                                     >
                                       {(items || []).map(item => (
                                         <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>
                                       ))}
                                     </select>
                                   </div>
                                 )}
                               </div>
                             );
                           })}
                         </div>
                       )}
                     </div>

                   </div>

                   {/* Advisory Note */}
                   <div className="flex items-start gap-2 text-[10px] bg-indigo-50/50 p-3 rounded-2xl border border-indigo-100/50 text-indigo-800 max-w-4xl select-none leading-relaxed font-sans">
                     <Sparkles size={14} className="text-indigo-600 flex-shrink-0 mt-0.5 animate-pulse" />
                     <p className="font-semibold">
                       <strong>Mapping Safeguard Checklist:</strong> By linking newly found entries to your master lists, we will replace names in the transactions dynamically during the import loop! For entries that are created, we will initialize ledger mappings with zero outstanding balances. Review mapped connections prior to saving.
                     </p>
                   </div>

                 </div>
               )}

               {activeImportTab === 'vouchers' && (
                 <div className="flex flex-col h-full overflow-hidden">
                   {/* Controls */}
                   <div className="p-4 border-b border-slate-100 bg-white flex items-center justify-between gap-4 shrink-0 px-6">
                      <div className="flex items-center gap-4 flex-1">
                        <div className="relative flex-1 max-w-md">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                          <input 
                            type="text" 
                            placeholder="Search entries or parties..." 
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-slate-101 border-transparent rounded-xl text-xs font-bold focus:bg-white focus:border-indigo-500 outline-none transition-all"
                          />
                        </div>
                        <div className="h-8 w-px bg-slate-100"></div>
                        <div className="flex items-center gap-4">
                           <div className="flex flex-col font-sans">
                              <span className="text-[10px] text-slate-400 font-black uppercase">Vouchers Found</span>
                              <span className="text-xs font-black text-slate-900">{vouchers.length}</span>
                           </div>
                           <div className="flex flex-col font-sans">
                              <span className="text-[10px] text-slate-400 font-black uppercase">Unmatched</span>
                              <span className="text-xs font-black text-orange-600">{vouchers.filter(v => !ledgers.some(l => l.name === v.partyName)).length}</span>
                           </div>
                        </div>
                      </div>
                      <button onClick={() => { setFile(null); setVouchers([]); }} className="text-xs font-black text-slate-400 hover:text-red-500 uppercase tracking-widest flex items-center gap-1 transition-colors cursor-pointer border-none bg-transparent outline-none">
                        <AlertCircle size={14} />
                        Reset
                      </button>
                   </div>

               {/* Transactions Table */}
               <div className="flex-1 overflow-y-auto p-4 space-y-2">
                 {isParsing && (
                   <div className="flex flex-col items-center justify-center py-20 animate-pulse">
                     <Cpu size={48} className="text-indigo-600 mb-4 animate-spin" />
                     <p className="text-sm font-black text-slate-600">AI is analyzing your statement...</p>
                   </div>
                 )}

                 {!isParsing && filteredVouchers.map((v, idx) => {
                   const isLedgerExists = ledgers.some(l => l.name === v.partyName);
                   const isEditing = editingVoucherIdx === idx;
                   const isSaved = (v as any).saved;

                   return (
                     <div key={idx} className={`group bg-white p-4 rounded-2xl border transition-all ${isSaved ? 'bg-emerald-50/20 border-emerald-100' : isEditing ? 'border-indigo-600 ring-4 ring-indigo-50' : 'border-slate-100 hover:border-indigo-200'}`}>
                        <div className="flex items-center gap-6">
                           {/* Date Column */}
                           <div className="w-16 text-center shrink-0">
                              <p className="text-[10px] font-black text-slate-400 uppercase">{v.date.split('-')[0]}</p>
                              <p className="text-sm font-black text-slate-900">{v.date.split('-').slice(1).reverse().join('/')}</p>
                           </div>

                           {/* Particulars Column */}
                           <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1.5">
                                 <div className={`p-1 rounded-lg ${v.type === 'Receipt' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                                    {v.type === 'Receipt' ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                                 </div>
                                 
                                 {/* Type/Entry Selector so user can choose type of mapping */}
                                 <select
                                   value={v.type}
                                   disabled={!!isSaved}
                                   onChange={(e) => {
                                     const newV = [...vouchers];
                                     newV[idx].type = e.target.value as any;
                                     setVouchers(newV);
                                   }}
                                   className="text-[10px] font-black uppercase tracking-wider bg-slate-100 border border-slate-200 hover:bg-white rounded px-1.5 py-0.5 outline-none font-sans text-slate-700"
                                 >
                                   <option value="Receipt">Receipt (Inflow)</option>
                                   <option value="Payment">Payment (Outflow)</option>
                                   <option value="Contra">Contra (Transfer)</option>
                                 </select>
                              </div>
                              {/* Dynamic smart-matching alert badges */}
                              <div className="flex flex-wrap gap-1.5 mb-1 items-center">
                                {(v as any).isLocalFuzzyMatched && !isSaved && (
                                  <span className="inline-flex items-center gap-1 text-[8.5px] bg-indigo-50 border border-indigo-150 text-indigo-700 font-extrabold px-2 py-0.5 rounded-md uppercase tracking-wider animate-pulse font-sans">
                                    <Sparkles size={8} className="fill-indigo-600/20" /> Substring Rule-Matched
                                  </span>
                                )}
                                {(v as any).isAiMapped && !isSaved && (
                                  <span className="inline-flex items-center gap-1 text-[8.5px] bg-emerald-50 border border-emerald-150 text-emerald-700 font-extrabold px-2 py-0.5 rounded-md uppercase tracking-wider font-sans">
                                    <Sparkles size={8} className="fill-emerald-600/20" /> AI Recommended
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 font-semibold break-words whitespace-pre-wrap leading-relaxed mb-2" title={v.narration}>{v.narration}</p>
                              
                              <div className="flex items-center gap-2">
                                 <div className="relative flex-1 max-w-md">
                                    <button 
                                      type="button"
                                      disabled={!!isSaved}
                                      onClick={() => {
                                        setEditingVoucherIdx(isEditing ? null : idx);
                                        setLedgerSearchTerm('');
                                      }}
                                      className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold border transition-all flex items-center justify-between ${isSaved ? 'bg-slate-100 text-slate-400' : isLedgerExists ? 'bg-indigo-50/50 border-indigo-100 text-indigo-900 hover:bg-indigo-50' : 'bg-orange-50/50 border-orange-100 text-orange-900 hover:bg-orange-50'}`}
                                    >
                                       <span className="truncate">{v.partyName}</span>
                                       {isSaved ? <CheckCircle2 size={14} className="text-emerald-500" /> : isLedgerExists ? <CheckCircle2 size={14} /> : <Plus size={14} />}
                                    </button>

                                    {/* Action button to trigger quick create if not found */}
                                    {!isSaved && (
                                      <div className="absolute right-[68px] top-[9px] flex items-center z-40">
                                        <button
                                          type="button"
                                          onClick={() => fetchAiLedgerSuggestion(idx, v.narration)}
                                          disabled={aiSuggestingIdx === idx}
                                          className={`p-1 flex items-center justify-center rounded border transition ${aiSuggestingIdx === idx ? 'bg-indigo-100 border-indigo-250 text-indigo-400 cursor-not-allowed animate-spin' : 'text-amber-600 bg-amber-50 hover:bg-amber-100 border-amber-200 hover:text-amber-700 shadow-2xs'}`}
                                          title="AI Suggest Best Map"
                                          style={{ width: '22px', height: '22px' }}
                                        >
                                          <Sparkles size={11} className="shrink-0 fill-amber-600/10" />
                                        </button>
                                      </div>
                                    )}
                                    {!isSaved && !isLedgerExists && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setQuickAddRowIndex(idx);
                                          setQuickLedgerName(v.partyName);
                                          setQuickLedgerGroup(v.type === 'Contra' ? 'Bank Accounts' : (v.type === 'Receipt' ? 'Sundry Debtors' : 'Sundry Creditors'));
                                        }}
                                        className="absolute right-9 top-1/2 -translate-y-1/2 p-1.5 text-indigo-600 bg-indigo-50 hover:bg-indigo-105 rounded border border-indigo-100 shadow-sm"
                                        title="Quick Create Missing Ledger"
                                      >
                                        <UserPlus size={12} />
                                      </button>
                                    )}

                                    {isEditing && !isSaved && (
                                      <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-white border border-slate-200 rounded-2xl shadow-2xl p-3 max-h-64 overflow-y-auto w-80">
                                         {/* Dropdown search field */}
                                         <div className="mb-2 shrink-0">
                                            <input
                                              type="text"
                                              placeholder="Search and filter ledgers..."
                                              value={ledgerSearchTerm}
                                              onChange={(e) => setLedgerSearchTerm(e.target.value)}
                                              className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 bg-slate-50"
                                              autoFocus
                                              onClick={(e) => e.stopPropagation()}
                                            />
                                         </div>

                                         <div className="p-1 border-b border-slate-100 mb-2">
                                            <button 
                                               type="button"
                                               onClick={() => handleCreateAndAssignLedger(idx, ledgerSearchTerm.trim() || v.partyName)}
                                               className="w-full flex items-center gap-2 p-2 rounded-xl text-emerald-600 hover:bg-emerald-50 text-[10px] font-black uppercase transition-colors"
                                            >
                                               <Plus size={14} />
                                               Create "{ledgerSearchTerm.trim() || v.partyName}" as Ledger
                                            </button>
                                         </div>

                                         {/* Grouped ledgers lookup */}
                                         <div className="space-y-2 overflow-y-auto max-h-40">
                                            {(() => {
                                              const search = ledgerSearchTerm.toLowerCase();
                                              const filtered = ledgers.filter(l => 
                                                (l.name || '').toLowerCase().includes(search) || 
                                                (l.group || '').toLowerCase().includes(search)
                                              );

                                              if (filtered.length === 0) {
                                                return (
                                                  <p className="text-[10px] font-bold text-slate-400 p-2 text-center">
                                                    No matching ledgers. Click "+" above to create.
                                                  </p>
                                                );
                                              }

                                              const groups = filtered.reduce((acc: any, l) => {
                                                const grp = l.group || 'Other';
                                                if (!acc[grp]) acc[grp] = [];
                                                acc[grp].push(l);
                                                return acc;
                                              }, {});

                                              return Object.keys(groups).map(grp => (
                                                <div key={grp} className="space-y-1">
                                                   <div className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest px-2 pt-1">{grp}</div>
                                                   {groups[grp].map((l: any) => (
                                                      <button
                                                         key={l.id}
                                                         type="button"
                                                         onClick={() => {
                                                           updateVoucherLedger(idx, l.name);
                                                           setLedgerSearchTerm('');
                                                         }}
                                                         className="w-full text-left p-1.5 hover:bg-slate-50 hover:text-indigo-600 rounded-lg text-xs font-bold text-slate-600 transition-colors flex justify-between items-center"
                                                      >
                                                         <span className="truncate">{l.name}</span>
                                                         {l.name === v.partyName && <Check size={12} className="text-indigo-600" />}
                                                      </button>
                                                   ))}
                                                </div>
                                              ));
                                            })()}
                                         </div>
                                      </div>
                                    )}
                                 </div>
                              </div>

                              {/* Contra Indicator details helper */}
                              {v.type === 'Contra' && (() => {
                                const targetLedgerObj = ledgers.find(l => (l.name || '').toLowerCase() === (v.partyName || '').toLowerCase());
                                const isValidContra = targetLedgerObj && ['Bank Accounts', 'Cash-in-hand', 'Bank', 'Cash'].includes(targetLedgerObj.group);
                                return (
                                  <div className="space-y-2 mt-2">
                                    <div className="p-2.5 bg-indigo-50/40 rounded-xl border border-indigo-100 flex flex-col gap-1.5 max-w-sm">
                                      <span className="text-[9px] font-black text-indigo-700 uppercase tracking-wider block">
                                        Transfer {v.type === 'Receipt' ? 'From' : 'To'} Account (Select Account):
                                      </span>
                                      <div className="flex flex-wrap gap-1">
                                        {bankLedgers
                                          .filter(bl => bl.id !== activeBankId)
                                          .map(bl => {
                                            const isSelected = targetLedgerObj?.id === bl.id;
                                            return (
                                              <button
                                                key={bl.id}
                                                type="button"
                                                disabled={!!isSaved}
                                                onClick={() => updateVoucherLedger(idx, bl.name)}
                                                className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 border cursor-pointer ${
                                                  isSelected
                                                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm font-extrabold'
                                                    : 'bg-white text-slate-700 border-slate-201 hover:border-indigo-300 hover:text-indigo-600'
                                                }`}
                                              >
                                                <span>{['Cash-in-hand', 'Cash'].includes(bl.group) ? '💵' : '🏦'}</span>
                                                <span className="truncate max-w-[120px]">{bl.name}</span>
                                              </button>
                                            );
                                          })}
                                      </div>
                                    </div>

                                    {!isValidContra ? (
                                      <p className="text-[9px] font-bold text-amber-600 bg-amber-50 p-1.5 rounded-lg border border-amber-100 max-w-xs">
                                        ⚠️ Warning: Selecting Contra requires both accounts to be Bank/Cash accounts. Update mapped ledger to a Bank/Cash account above or via the options.
                                      </p>
                                    ) : (
                                      <p className="text-[9px] font-bold text-indigo-600 bg-indigo-50/40 p-1.5 rounded-lg border border-indigo-100 max-w-xs">
                                        Contra Transfer: ₹{v.amount.toLocaleString()} between Statement Bank and {targetLedgerObj?.name}.
                                      </p>
                                    )}
                                  </div>
                                );
                              })()}
                           </div>

                           {/* Amount Column */}
                           <div className="text-right shrink-0">
                              <p className={`text-xl font-black ${v.type === 'Receipt' ? 'text-emerald-600' : 'text-slate-900'}`}>
                                 {v.type === 'Receipt' ? '+' : '-'} ₹{v.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </p>
                              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1 font-mono">
                                 ₹{v.amount.toLocaleString('en-IN')}
                              </div>
                           </div>

                           {/* Save Entry actions */}
                           <div className="shrink-0 text-center pl-4 pr-2">
                              {isSaved ? (
                                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-xl">
                                  <Check size={12} className="text-emerald-600 font-black" /> Mapped
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleSaveSingleVoucher(idx)}
                                  disabled={savingSingleIdx !== null || isImporting}
                                  className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-600 hover:text-white border border-indigo-100 px-3 py-1.5 rounded-xl transition-all shadow-sm cursor-pointer disabled:opacity-40"
                                >
                                  {savingSingleIdx === idx ? (
                                    <Loader2 className="animate-spin" size={12} />
                                  ) : (
                                    <Save size={12} />
                                  )}
                                  Save Entry
                                </button>
                              )}
                           </div>
                        </div>
                     </div>
                   );
                 })}

                 {filteredVouchers.length === 0 && !isParsing && (
                   <div className="text-center py-20 text-slate-400 bg-white rounded-3xl border border-slate-100">
                      <Search size={48} className="mx-auto mb-4 opacity-10 animate-bounce" />
                      <p className="text-xs font-black uppercase tracking-widest text-slate-400">No matching entries found</p>
                   </div>
                 )}
               </div>
            </div>
          )}
        </div>
      )}
    </div>

        {/* Footer actions bar */}
        <div className="p-8 border-t border-slate-100 bg-white flex justify-between items-center shrink-0">
           <div className="flex items-center gap-6">
              <div className="flex flex-col">
                 <span className="text-[10px] text-slate-400 font-black uppercase">Total Processed</span>
                 <span className="text-lg font-black text-slate-900">₹{vouchers.reduce((sum, v) => sum + v.amount, 0).toLocaleString()}</span>
              </div>
              <div className="flex flex-col">
                 <span className="text-[10px] text-slate-400 font-black uppercase">Pending to Import</span>
                 <span className="text-lg font-black text-indigo-600">{vouchers.filter(v => !(v as any).saved).length} entries</span>
              </div>
           </div>
           
           <div className="flex gap-4">
              <button 
                onClick={onClose} 
                className="px-8 py-3 rounded-2xl text-slate-500 font-black text-xs uppercase tracking-widest border border-slate-100 hover:bg-slate-50 transition-all"
              >
                Close
              </button>
              <button 
                disabled={!file || vouchers.length === 0 || isImporting || isParsing || !vouchers.some(v => !(v as any).saved)} 
                onClick={handleImport}
                className="px-8 py-3 rounded-2xl bg-indigo-600 text-white font-black text-xs uppercase tracking-widest hover:bg-slate-900 shadow-xl shadow-indigo-100 transition-all disabled:opacity-50 disabled:grayscale flex items-center gap-2"
              >
                {isImporting ? 'Processing...' : 'Import to Ledgers'}
                <ArrowRight size={14} />
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
            <p className="text-xs text-slate-500 mb-6 font-medium">Create and save a new ledger account instantly so it becomes fully selectable in dropdown lists.</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-black text-slate-400 mb-1 tracking-wider">Ledger Name</label>
                <input
                  type="text"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-bold text-slate-800 outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 transition-all font-sans"
                  value={quickLedgerName}
                  onChange={(e) => setQuickLedgerName(e.target.value)}
                  placeholder="Enter custom customer, supplier, or bank name"
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
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-black uppercase tracking-wider rounded-xl transition-all font-sans"
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
                    await handleCreateAndAssignLedger(quickAddRowIndex, quickLedgerName.trim(), quickLedgerGroup);
                    setQuickAddRowIndex(null);
                  } catch (err: any) {
                    alert('Error saving ledger: ' + err.message);
                  }
                }}
                className="flex-1 py-3 bg-indigo-600 hover:bg-slate-900 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-lg shadow-indigo-105 transition-all font-sans"
              >
                Create & Select
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};
