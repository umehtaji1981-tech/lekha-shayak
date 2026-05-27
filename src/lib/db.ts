import { 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  setDoc,
  getDoc, 
  getDocs,
  onSnapshot,
  query,
  where,
  runTransaction,
  FieldValue
} from 'firebase/firestore';
import { db, auth } from './firebase';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  // If user is not signed in, permission errors are expected during logout transitions
  if (!auth.currentUser && error instanceof Error && error.message.toLowerCase().includes('permission')) {
    return;
  }

  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const dbService = {
  async addLog(companyId: string, action: string, details: string) {
    if (!companyId) return;
    try {
      await addDoc(collection(db, `companies/${companyId}/activity_logs`), {
        action,
        details,
        userId: auth.currentUser?.uid,
        userEmail: auth.currentUser?.email,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      console.error("Log failed", e);
    }
  },

  async add(path: string, data: any) {
    try {
      const res = await addDoc(collection(db, path), {
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      if (path.includes('companies/')) {
        const companyId = path.split('/')[1];
        this.addLog(companyId, 'CREATE', `Added new entry to ${path.split('/').pop()}: ${data.name || data.voucherNumber || 'unnamed'}`);
      }
      return res;
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, path);
    }
  },
  
  async set(path: string, id: string, data: any) {
    if (!id || typeof id !== 'string' || id.trim() === '') {
      console.warn(`dbService.set: id was empty or invalid (path: ${path}, id: ${id})`);
      return;
    }
    try {
      const docRef = doc(db, path, id);
      const isNew = !(await getDoc(docRef)).exists();
      const timestamp = new Date().toISOString();
      return await setDoc(docRef, {
        ...data,
        updatedAt: timestamp,
        ...(isNew ? { createdAt: timestamp } : {})
      }, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `${path}/${id}`);
    }
  },

  async update(path: string, id: string, data: any) {
    if (!id || typeof id !== 'string' || id.trim() === '') {
      console.warn(`dbService.update: id was empty or invalid (path: ${path}, id: ${id})`);
      return;
    }
    try {
      const docRef = doc(db, path, id);
      const res = await updateDoc(docRef, {
        ...data,
        updatedAt: new Date().toISOString(),
      });
      if (path.includes('companies/')) {
        const companyId = path.split('/')[1];
        this.addLog(companyId, 'UPDATE', `Updated ${path.split('/').pop()}: ${data.name || data.voucherNumber || id}`);
      }
      return res;
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `${path}/${id}`);
    }
  },

  async get(path: string, id: string) {
    if (!id || typeof id !== 'string' || id.trim() === '') {
      console.warn(`dbService.get: id was empty or invalid (path: ${path}, id: ${id})`);
      return null;
    }
    try {
      const docSnap = await getDoc(doc(db, path, id));
      return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `${path}/${id}`);
    }
  },

  async delete(path: string, id: string) {
    if (!id || typeof id !== 'string' || id.trim() === '') {
      console.warn(`dbService.delete: id was empty or invalid (path: ${path}, id: ${id})`);
      return;
    }
    try {
      await deleteDoc(doc(db, path, id));
      if (path.includes('companies/')) {
        const companyId = path.split('/')[1];
        this.addLog(companyId, 'DELETE', `Deleted ${path.split('/').pop()} with ID: ${id}`);
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `${path}/${id}`);
    }
  },

  async deleteTransactionWithStock(companyId: string, transactionId: string) {
    if (!companyId || !transactionId) {
      console.warn(`dbService.deleteTransactionWithStock: Missing arguments. companyId: ${companyId}, transactionId: ${transactionId}`);
      return;
    }
    try {
      const transactionRef = doc(db, `companies/${companyId}/transactions`, transactionId);
      let transData: any = null;
      await runTransaction(db, async (tx) => {
        const transSnap = await tx.get(transactionRef);
        if (!transSnap.exists()) return;

        transData = transSnap.data() as any;
        const { items, type, partyId, totalAmount } = transData;

        // 1. Collect all read refs
        const itemIds = new Set<string>();
        if (items) items.forEach((i: any) => i.itemId && itemIds.add(i.itemId));
        
        // 2. Perform all reads
        const itemSnaps: any = {};
        for (const id of Array.from(itemIds)) {
          itemSnaps[id] = await tx.get(doc(db, `companies/${companyId}/items`, id));
        }

        let ledgerSnap = null;
        if (partyId) {
          ledgerSnap = await tx.get(doc(db, `companies/${companyId}/ledgers`, partyId));
        }

        // Collect Bank Snap before any writes
        let bankSnap = null;
        const isImmediatePaymentBank = transData.isPaid && transData.bankId && ['Sales', 'Purchases', 'sales', 'purchases'].includes(type);
        const bankId = transData.bankId;
        if ((['Receipt', 'Payment', 'Contra', 'receipt', 'payment', 'contra'].includes(type) || isImmediatePaymentBank) && bankId) {
          bankSnap = await tx.get(doc(db, `companies/${companyId}/ledgers`, bankId));
        }

        // 3. Perform all logic/calculations
        // Reverse stock
        if (items && items.length > 0) {
          for (const itemRow of items) {
            if (itemRow.itemId && itemSnaps[itemRow.itemId]?.exists()) {
              const currentStock = itemSnaps[itemRow.itemId].data().stockLevel || 0;
              const qty = itemRow.qty || 0;
              // If it was Sales, stock decreased, so add back. If Purchases, stock increased, so subtract.
              const newStock = ['Sales', 'sales'].includes(type) ? currentStock + qty : currentStock - qty;
              tx.update(doc(db, `companies/${companyId}/items`, itemRow.itemId), { stockLevel: newStock });
            }
          }
        }

        // Reverse Ledger Balance
        if (totalAmount && ledgerSnap && ledgerSnap.exists()) {
          const currentBal = Number(ledgerSnap.data().currentBalance) || 0;
          const amount = Number(totalAmount) || 0;
          
          let multiplier = ['Sales', 'Payment', 'sales', 'payment'].includes(type) ? 1 : -1;
          if (['Contra', 'contra'].includes(type)) {
            multiplier = transData.isDeposit ? -1 : 1;
          }
          
          let oldImpact = amount * multiplier;
          if (isImmediatePaymentBank) oldImpact = 0; // It was net zero for the party

          tx.update(doc(db, `companies/${companyId}/ledgers`, partyId), { 
            currentBalance: currentBal - oldImpact 
          });
        }

        // Handle Bank Account reversal
        if (bankSnap && bankSnap.exists() && bankId) {
          const bankBal = Number(bankSnap.data().currentBalance) || 0;
          const amount = Number(totalAmount) || 0;
          // Sales/Receipt: Dr Bank (+), Purchase/Payment: Cr Bank (-)
          // Reverse: Sales/Receipt (-), Purchase/Payment (+)
          let bankMultiplier = ['Sales', 'Receipt', 'sales', 'receipt'].includes(type) ? 1 : -1;
          if (['Contra', 'contra'].includes(type)) {
            bankMultiplier = transData.isDeposit ? 1 : -1;
          }
          tx.update(doc(db, `companies/${companyId}/ledgers`, bankId!), {
            currentBalance: bankBal - (amount * bankMultiplier)
          });
        }

        // 4. Delete the transaction
        tx.delete(transactionRef);
      });

      if (transData) {
        this.addLog(companyId, 'DELETE', `Deleted ${transData.type || ''} transaction: ${transData.voucherNumber || ''}`);
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `companies/${companyId}/transactions/${transactionId}`);
    }
  },

  async updateTransactionWithStock(companyId: string, transactionId: string, newData: any) {
    if (!companyId || !transactionId) {
      console.warn(`dbService.updateTransactionWithStock: Missing arguments. companyId: ${companyId}, transactionId: ${transactionId}`);
      return;
    }
    try {
      const transactionRef = doc(db, `companies/${companyId}/transactions`, transactionId);
      await runTransaction(db, async (tx) => {
        // 1. Transaction Read
        const transSnap = await tx.get(transactionRef);
        if (!transSnap.exists()) throw new Error("Transaction not found");
        const oldData = transSnap.data() as any;

        // 2. Identify all related reads
        const itemIds = new Set<string>();
        if (oldData.items) {
          oldData.items.forEach((i: any) => {
            if (i.itemId && typeof i.itemId === 'string' && i.itemId.trim() !== '') {
              itemIds.add(i.itemId.trim());
            }
          });
        }
        if (newData.items) {
          newData.items.forEach((i: any) => {
            if (i.itemId && typeof i.itemId === 'string' && i.itemId.trim() !== '') {
              itemIds.add(i.itemId.trim());
            }
          });
        }

        const ledgerIds = new Set<string>();
        if (oldData.partyId && typeof oldData.partyId === 'string' && oldData.partyId.trim() !== '') ledgerIds.add(oldData.partyId.trim());
        if (newData.partyId && typeof newData.partyId === 'string' && newData.partyId.trim() !== '') ledgerIds.add(newData.partyId.trim());
        if (oldData.bankId && typeof oldData.bankId === 'string' && oldData.bankId.trim() !== '') ledgerIds.add(oldData.bankId.trim());
        if (newData.bankId && typeof newData.bankId === 'string' && newData.bankId.trim() !== '') ledgerIds.add(newData.bankId.trim());

        // 3. Perform all reads before any writes
        const currentStocks: any = {};
        for (const id of Array.from(itemIds)) {
          if (!id) continue;
          const snap = await tx.get(doc(db, `companies/${companyId}/items`, id));
          if (snap.exists()) {
            currentStocks[id] = snap.data().stockLevel || 0;
          }
        }

        const ledgerSnaps: any = {};
        for (const id of Array.from(ledgerIds)) {
          if (!id) continue;
          ledgerSnaps[id] = await tx.get(doc(db, `companies/${companyId}/ledgers`, id));
        }

        // 4. Calculations (Pure logic, no writes yet)
        const stockChanges: any = {};
        if (oldData.items) {
          for (const itemRow of oldData.items) {
            if (itemRow.itemId && currentStocks[itemRow.itemId] !== undefined) {
              const qty = Number(itemRow.qty) || 0;
              stockChanges[itemRow.itemId] = (Number(stockChanges[itemRow.itemId] ?? currentStocks[itemRow.itemId])) + 
                (['Sales', 'sales'].includes(oldData.type) ? qty : -qty);
            }
          }
        }
        if (newData.items) {
          for (const itemRow of newData.items) {
            if (itemRow.itemId && (stockChanges[itemRow.itemId] !== undefined || currentStocks[itemRow.itemId] !== undefined)) {
              const qty = Number(itemRow.qty) || 0;
              const baseStock = Number(stockChanges[itemRow.itemId] ?? currentStocks[itemRow.itemId]);
              stockChanges[itemRow.itemId] = baseStock - (['Sales', 'sales'].includes(newData.type) ? qty : -qty);
            }
          }
        }

        const ledgerBalances: any = {};
        // Reverse old impact
        if (oldData.partyId && oldData.totalAmount && ledgerSnaps[oldData.partyId]?.exists()) {
          const currentBal = Number(ledgerSnaps[oldData.partyId].data().currentBalance) || 0;
          const oldIsPaid = oldData.isPaid && oldData.bankId && ['Sales', 'Purchases'].includes(oldData.type);
          
          let oldMultiplier = ['Sales', 'Payment'].includes(oldData.type) ? 1 : -1;
          if (oldData.type === 'Contra') {
            oldMultiplier = oldData.isDeposit ? -1 : 1;
          }
          
          let oldImpact = Number(oldData.totalAmount) * oldMultiplier;
          if (oldIsPaid) oldImpact = 0;

          ledgerBalances[oldData.partyId] = currentBal - oldImpact;
        }

        // Handle old bank impact
        const oldIsPaidBank = (['Receipt', 'Payment', 'Contra'].includes(oldData.type) || (oldData.isPaid && oldData.bankId));
        if (oldIsPaidBank && oldData.bankId && ledgerSnaps[oldData.bankId]?.exists()) {
          const currentBankBal = ledgerBalances[oldData.bankId] !== undefined 
            ? ledgerBalances[oldData.bankId]
            : (Number(ledgerSnaps[oldData.bankId].data().currentBalance) || 0);
          
          let oldBankMultiplier = ['Sales', 'Receipt'].includes(oldData.type) ? 1 : -1;
          if (oldData.type === 'Contra') {
            oldBankMultiplier = oldData.isDeposit ? 1 : -1;
          }
          ledgerBalances[oldData.bankId] = currentBankBal - (Number(oldData.totalAmount) * oldBankMultiplier);
        }

        // Apply new impact
        if (newData.partyId && newData.totalAmount && ledgerSnaps[newData.partyId]?.exists()) {
          const currentBal = ledgerBalances[newData.partyId] !== undefined 
            ? ledgerBalances[newData.partyId] 
            : (Number(ledgerSnaps[newData.partyId].data().currentBalance) || 0);
          
          const newIsPaid = newData.isPaid && newData.bankId && ['Sales', 'Purchases'].includes(newData.type);
          
          let newMultiplier = ['Sales', 'Payment'].includes(newData.type) ? 1 : -1;
          if (newData.type === 'Contra') {
            newMultiplier = newData.isDeposit ? -1 : 1;
          }
          
          let newImpact = Number(newData.totalAmount) * newMultiplier;
          if (newIsPaid) newImpact = 0;

          ledgerBalances[newData.partyId] = currentBal + newImpact;
        }

        // Apply new bank impact
        const newIsPaidBank = (['Receipt', 'Payment', 'Contra'].includes(newData.type) || (newData.isPaid && newData.bankId));
        if (newIsPaidBank && newData.bankId && ledgerSnaps[newData.bankId]?.exists()) {
          const currentBankBal = ledgerBalances[newData.bankId] !== undefined
            ? ledgerBalances[newData.bankId]
            : (Number(ledgerSnaps[newData.bankId].data().currentBalance) || 0);
          
          let newBankMultiplier = ['Sales', 'Receipt'].includes(newData.type) ? 1 : -1;
          if (newData.type === 'Contra') {
            newBankMultiplier = newData.isDeposit ? 1 : -1;
          }
          ledgerBalances[newData.bankId] = currentBankBal + (Number(newData.totalAmount) * newBankMultiplier);
        }

        // 5. Apply all writes
        Object.entries(stockChanges).forEach(([id, newStock]) => {
          tx.update(doc(db, `companies/${companyId}/items`, id), { stockLevel: Number(newStock) || 0 });
        });

        Object.entries(ledgerBalances).forEach(([id, newBal]) => {
          tx.update(doc(db, `companies/${companyId}/ledgers`, id), { currentBalance: Number(newBal) || 0 });
        });

        tx.update(transactionRef, { ...newData, updatedAt: new Date().toISOString() });
      });

      this.addLog(companyId, 'UPDATE', `Updated ${newData.type} transaction: ${newData.voucherNumber}`);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `companies/${companyId}/transactions/${transactionId}`);
    }
  },

  async addTransactionWithStock(companyId: string, newData: any) {
    if (!companyId) {
      console.warn("dbService.addTransactionWithStock: Missing companyId.");
      return;
    }
    try {
      const transactionRef = doc(collection(db, `companies/${companyId}/transactions`));
      await runTransaction(db, async (tx) => {
        // 1. Identify reads
        const itemIds = new Set<string>();
        if (newData.items) {
          newData.items.forEach((i: any) => {
            if (i.itemId && typeof i.itemId === 'string' && i.itemId.trim() !== '') {
              itemIds.add(i.itemId.trim());
            }
          });
        }
        
        // 2. Perform all reads
        const currentStocks: any = {};
        for (const id of Array.from(itemIds)) {
          if (!id) continue;
          const snap = await tx.get(doc(db, `companies/${companyId}/items`, id));
          if (snap.exists()) {
            currentStocks[id] = snap.data().stockLevel || 0;
          }
        }

        let ledgerSnap = null;
        if (newData.partyId && typeof newData.partyId === 'string' && newData.partyId.trim() !== '') {
          ledgerSnap = await tx.get(doc(db, `companies/${companyId}/ledgers`, newData.partyId.trim()));
        }

        const isImmediatePayment = newData.isPaid && newData.bankId && ['Sales', 'Purchases'].includes(newData.type);
        let bankSnap = null;
        if ((['Receipt', 'Payment', 'Contra'].includes(newData.type) || isImmediatePayment) && newData.bankId && typeof newData.bankId === 'string' && newData.bankId.trim() !== '') {
          bankSnap = await tx.get(doc(db, `companies/${companyId}/ledgers`, newData.bankId.trim()));
        }

        // 3. Logic
        if (newData.items) {
          for (const itemRow of newData.items) {
            if (itemRow.itemId && currentStocks[itemRow.itemId] !== undefined) {
              const qty = Number(itemRow.qty) || 0;
              currentStocks[itemRow.itemId] = (Number(currentStocks[itemRow.itemId]) || 0) - (['Sales', 'sales'].includes(newData.type) ? qty : -qty);
            }
          }
        }

        // 4. Writes
        Object.entries(currentStocks).forEach(([id, newStock]) => {
          tx.update(doc(db, `companies/${companyId}/items`, id), { stockLevel: Number(newStock) || 0 });
        });

        if (newData.partyId && newData.totalAmount && ledgerSnap && ledgerSnap.exists()) {
          const currentBal = Number(ledgerSnap.data().currentBalance) || 0;
          
          let multiplier = ['Sales', 'Payment'].includes(newData.type) ? 1 : -1;
          if (newData.type === 'Contra') {
            multiplier = newData.isDeposit ? -1 : 1;
          }
          
          let balanceChange = Number(newData.totalAmount) * multiplier;
          
          // If settled immediately, party balance impact is neutralized
          if (isImmediatePayment) {
            balanceChange = 0;
          }

          tx.update(doc(db, `companies/${companyId}/ledgers`, newData.partyId), { 
            currentBalance: currentBal + balanceChange
          });
        }

        // Handle Bank Account for Receipt/Payment OR Immediate Payment for Sales/Purchases
        if (bankSnap && bankSnap.exists() && newData.bankId) {
          const bankBal = Number(bankSnap.data().currentBalance) || 0;
          const amount = Number(newData.totalAmount) || 0;
          // Sales/Receipt: Dr Bank (+), Purchase/Payment: Cr Bank (-)
          let bankMultiplier = ['Sales', 'Receipt'].includes(newData.type) ? 1 : -1;
          if (newData.type === 'Contra') {
            bankMultiplier = newData.isDeposit ? 1 : -1;
          }
          tx.update(doc(db, `companies/${companyId}/ledgers`, newData.bankId), {
            currentBalance: bankBal + (amount * bankMultiplier)
          });
        }

        const timestamp = new Date().toISOString();
        tx.set(transactionRef, { 
          ...newData, 
          createdAt: timestamp,
          updatedAt: timestamp 
        });
      });
      this.addLog(companyId, 'CREATE', `Added ${newData.type} transaction: ${newData.voucherNumber} (₹${newData.totalAmount})`);
      return { id: transactionRef.id };
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, `companies/${companyId}/transactions`);
    }
  },

  async getCollection(path: string, constraints: any[] = []) {
    try {
      const q = query(collection(db, path), ...constraints);
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, path);
    }
  },

  listenCollection(path: string, constraints: any[], callback: (data: any[]) => void) {
    const q = query(collection(db, path), ...constraints);
    return onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      callback(data);
    }, (e) => handleFirestoreError(e, OperationType.LIST, path));
  },

  async getNextSequence(companyId: string, type: string, fy: string) {
    if (!companyId || !type || !fy) {
      console.warn(`dbService.getNextSequence: Missing arguments. companyId: ${companyId}, type: ${type}, fy: ${fy}`);
      return { prefix: '', suffix: '', lastNumber: 0, padding: 1, currentFullNumber: '1' };
    }
    const sequenceId = `${type}_${fy}`;
    const sequenceRef = doc(db, `companies/${companyId}/sequences`, sequenceId);

    try {
      return await runTransaction(db, async (transaction) => {
        const seqDoc = await transaction.get(sequenceRef);
        
        let lastNumber = 0;
        let prefix = '';
        let suffix = '';
        let padding = 1;

        if (seqDoc.exists()) {
          const data = seqDoc.data();
          lastNumber = data.lastNumber;
          prefix = data.prefix || '';
          suffix = data.suffix || '';
          padding = data.padding || 1;
        }

        const nextNumber = lastNumber + 1;
        const formattedNumber = nextNumber.toString().padStart(padding, '0');
        const voucherNumber = `${prefix}${formattedNumber}${suffix}`;

        transaction.set(sequenceRef, {
          type,
          fy,
          lastNumber: nextNumber,
          prefix,
          suffix,
          padding,
          companyId,
          updatedAt: new Date().toISOString()
        }, { merge: true });

        return voucherNumber;
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `companies/${companyId}/sequences/${sequenceId}`);
    }
  },

  async rolloverFinancialYear(companyId: string, oldFYId: string, newFYId: string) {
    try {
      // 1. Fetch current data
      const ledgersSnap = await getDocs(collection(db, `companies/${companyId}/ledgers`));
      const sequencesSnap = await getDocs(query(
        collection(db, `companies/${companyId}/sequences`), 
        where('fy', '==', oldFYId)
      ));

      await runTransaction(db, async (tx) => {
        // 2. Process Ledgers
        ledgersSnap.docs.forEach(ledgerDoc => {
          const data = ledgerDoc.data();
          const group = data.group || '';
          const currentBal = Number(data.currentBalance) || 0;
          
          let newOpeningBal = currentBal;
          let newCurrentBal = currentBal;
          
          // Accounting logic: Nominal accounts (Income/Expense) are closed to P&L/Capital
          // Real/Personal accounts (Asset/Liability) are carried forward
          // Asset/Liability accounts are carried forward
          const incomeGroups = ['Sales Accounts', 'Indirect Incomes', 'Direct Incomes'];
          const expenseGroups = ['Purchase Accounts', 'Indirect Expenses', 'Direct Expenses'];
          
          if (incomeGroups.some(g => (group || '').includes(g)) || expenseGroups.some(g => (group || '').includes(g))) {
            newOpeningBal = 0; 
            newCurrentBal = 0;
          }
          
          tx.update(ledgerDoc.ref, {
            openingBalance: newOpeningBal,
            currentBalance: newCurrentBal,
            updatedAt: new Date().toISOString()
          });
        });

        // 3. Reset Sequences for new year
        sequencesSnap.docs.forEach(seqDoc => {
          const seqData = seqDoc.data();
          const newSeqId = `${seqData.type}_${newFYId}`;
          tx.set(doc(db, `companies/${companyId}/sequences`, newSeqId), {
            ...seqData,
            fy: newFYId,
            lastNumber: 0,
            updatedAt: new Date().toISOString()
          });
        });

        this.addLog(companyId, 'ROLLOVER', `Financial Year Rollover from ${oldFYId} to ${newFYId} completed.`);
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `companies/${companyId}/rollover`);
    }
  },

  async checkDuplicateVoucher(companyId: string, type: string, fy: string, voucherNumber: string, excludeId?: string) {
    try {
      const q = query(
        collection(db, `companies/${companyId}/transactions`),
        where('companyId', '==', companyId),
        where('type', '==', type),
        where('fy', '==', fy),
        where('voucherNumber', '==', voucherNumber)
      );
      const snapshot = await getDocs(q);
      const docs = snapshot.docs.filter(d => d.id !== excludeId);
      return docs.length > 0;
    } catch (e) {
      console.error("Duplicate check failed", e);
      return false;
    }
  }
};
