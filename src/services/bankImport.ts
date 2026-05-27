import { TallyVoucher } from './tallyImport';
import * as XLSX from 'xlsx';

export const parseBankFile = async (file: File): Promise<TallyVoucher[]> => {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const mimeType = file.type;
  
  if (extension === 'xml') {
    const text = await file.text();
    const { parseTallyXml } = await import('./tallyImport');
    return parseTallyXml(text);
  }

  // Handle PDF and Images using Gemini AI
  if ((mimeType || '').includes('pdf') || (mimeType || '').includes('image')) {
    const { parseDocumentWithAI } = await import('./geminiService');
    return parseDocumentWithAI(file);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Find the first sheet that has content
        let sheetName = workbook.SheetNames[0];
        for (const name of workbook.SheetNames) {
          const sheet = workbook.Sheets[name];
          if (sheet['!ref']) {
            sheetName = name;
            break;
          }
        }
        
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 }) as any[][];
        
        // Basic heuristic to find headers and data
        // We look for columns like Date, Particulars/Description, Credit/Deposit, Debit/Withdrawal
        const vouchers: TallyVoucher[] = [];
        
        let headerRowIndex = -1;
        for(let i=0; i<Math.min(rows.length, 50); i++) { // Increased lookahead
          const rowStr = rows[i].join(' ').toLowerCase();
          const hasDate = rowStr.includes('date') || rowStr.includes('txn');
          const hasDesc = rowStr.includes('particular') || rowStr.includes('description') || rowStr.includes('narration') || rowStr.includes('remarks');
          const hasAmount = rowStr.includes('credit') || rowStr.includes('debit') || rowStr.includes('amount') || rowStr.includes('withdrawal') || rowStr.includes('deposit');
          
          if (hasDate && (hasDesc || hasAmount)) {
            headerRowIndex = i;
            break;
          }
        }

        if (headerRowIndex === -1) headerRowIndex = 0; // Fallback

        const headers = rows[headerRowIndex].map(h => String(h || '').toLowerCase().trim());
        const dateIdx = headers.findIndex(h => h.includes('date') || h === 'txn' || h.includes('tran date') || h.includes('value date'));
        const descIdx = headers.findIndex(h => h.includes('particular') || h.includes('desc') || h.includes('narration') || h.includes('remark') || h.includes('details') || h.includes('transaction details'));
        const creditIdx = headers.findIndex(h => h.includes('credit') || h.includes('deposit') || h.includes('receipt') || h.includes('amt received') || h.includes('deposit amt') || h.includes('cr amt'));
        const debitIdx = headers.findIndex(h => h.includes('debit') || h.includes('withdraw') || h.includes('payment') || h.includes('amt paid') || h.includes('withdrawal amt') || h.includes('dr amt'));
        
        // Single amount column case
        const amountIdx = headers.findIndex(h => h === 'amount' || h === 'balance' || h === 'total amount');

        for (let i = headerRowIndex + 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;
          if (!row[dateIdx] && !row[descIdx]) continue;

          let dateValue = row[dateIdx];
          // Handle Excel date numbers
          if (typeof dateValue === 'number' && dateValue > 30000) {
            const date = new Date(Math.round((dateValue - 25569) * 86400 * 1000));
            dateValue = date.toISOString().split('T')[0];
          } else if (typeof dateValue === 'string' && dateValue.includes('/')) {
             // Try to reformat DD/MM/YYYY to YYYY-MM-DD
             const parts = dateValue.split('/');
             if (parts.length === 3) {
               if (parts[2].length === 4) dateValue = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
               else if (parts[0].length === 4) dateValue = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
               else if (parts[2].length === 2) dateValue = `20${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
             }
          }

          const narration = String(row[descIdx] || '');
          const rawCredit = String(row[creditIdx] || '0').replace(/[^0-9.-]/g, '');
          const rawDebit = String(row[debitIdx] || '0').replace(/[^0-9.-]/g, '');
          
          let credit = parseFloat(rawCredit) || 0;
          let debit = parseFloat(rawDebit) || 0;

          // If credit/debit are not separate but in one 'amount' column
          if (credit === 0 && debit === 0 && amountIdx !== -1) {
            const val = parseFloat(String(row[amountIdx] || '0').replace(/[^0-9.-]/g, ''));
            if (val > 0) credit = val;
            else if (val < 0) debit = Math.abs(val);
          }

          if (credit === 0 && debit === 0) continue;

          const amount = credit || debit;
          const type = credit > 0 ? 'Receipt' : 'Payment';
          
          // Try to extract a clean party name from narration
          // Usually narration looks like "UPI-USER NAME-REF" or "CHQ PAID TO PARTY NAME"
          let partyName = narration.split(' ').slice(0, 3).join(' ').trim();
          if (narration.includes('-')) partyName = narration.split('-')[1]?.trim() || partyName;

          vouchers.push({
            date: String(dateValue),
            voucherNumber: `BANK-${i}`,
            type,
            partyName: partyName || 'Unknown Party',
            amount,
            narration,
            ledgerEntries: [] // Simplified for bank import
          } as any);
        }

        resolve(vouchers);
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
};
