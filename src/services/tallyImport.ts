
/**
 * Tally XML Import Service
 * Parses XML files exported from Tally.ERP 9 and TallyPrime
 */

export interface TallyVoucher {
  date: string;
  voucherNumber: string;
  type: string;
  partyName: string;
  amount: number;
  narration: string;
  ledgerEntries: {
    ledgerName: string;
    amount: number;
    isDeemedPositive: boolean;
  }[];
}

export const parseTallyXml = (xmlString: string): TallyVoucher[] => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, "text/xml");
  const vouchers: TallyVoucher[] = [];

  const voucherNodes = xmlDoc.getElementsByTagName("VOUCHER");

  for (let i = 0; i < voucherNodes.length; i++) {
    const node = voucherNodes[i];
    
    const dateStr = node.getElementsByTagName("DATE")[0]?.textContent || "";
    // Tally date is YYYYMMDD
    const date = dateStr.length === 8 
      ? `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`
      : new Date().toISOString().split('T')[0];

    const voucherNumber = node.getElementsByTagName("VOUCHERNUMBER")[0]?.textContent || "";
    let type = node.getAttribute("VCHTYPE") || "";
    
    // Normalize voucher type
    if ((type || '').toLowerCase().includes('sale')) type = 'Sales';
    else if ((type || '').toLowerCase().includes('purchase')) type = 'Purchases';
    else if ((type || '').toLowerCase().includes('receipt')) type = 'Receipt';
    else if ((type || '').toLowerCase().includes('payment')) type = 'Payment';
    else if ((type || '').toLowerCase().includes('journal')) type = 'Journal';
    else if ((type || '').toLowerCase().includes('contra')) type = 'Contra';

    let partyName = node.getElementsByTagName("PARTYLEDGERNAME")[0]?.textContent || "";
    const narration = node.getElementsByTagName("NARRATION")[0]?.textContent || "";

    const ledgerEntries: any[] = [];
    const inventoryEntries: any[] = [];
    
    // Ledger Entries
    const allEntries = node.getElementsByTagName("ALLLEDGERENTRIES.LIST");
    const basicEntries = node.getElementsByTagName("LEDGERENTRIES.LIST");
    const combinedLedgers = Array.from(allEntries).concat(Array.from(basicEntries));

    // Inventory Entries (Common in Sales/Purchases)
    const invEntriesList = node.getElementsByTagName("ALLINVENTORYENTRIES.LIST");
    for (let j = 0; j < invEntriesList.length; j++) {
      const invNode = invEntriesList[j];
      const name = invNode.getElementsByTagName("STOCKITEMNAME")[0]?.textContent || "";
      const qty = invNode.getElementsByTagName("BILLEDQTY")[0]?.textContent || "";
      const amtStr = invNode.getElementsByTagName("AMOUNT")[0]?.textContent || "0";
      const rate = invNode.getElementsByTagName("RATE")[0]?.textContent || "";
      inventoryEntries.push({ name, qty, rate, amount: Math.abs(parseFloat(amtStr)) });
    }
    
    let cgst = 0, sgst = 0, igst = 0, totalTax = 0;
    let mainAmount = 0;

    for (let j = 0; j < combinedLedgers.length; j++) {
      const entryNode = combinedLedgers[j];
      const ledgerName = entryNode.getElementsByTagName("LEDGERNAME")[0]?.textContent || "";
      const amountStr = entryNode.getElementsByTagName("AMOUNT")[0]?.textContent || "0";
      const isDeemedPositive = entryNode.getElementsByTagName("ISDEEMEDPOSITIVE")[0]?.textContent === "YES";
      
      const amount = Math.abs(parseFloat(amountStr));
      if (!ledgerName || isNaN(amount)) continue;

      ledgerEntries.push({ ledgerName, amount, isDeemedPositive });
      
      const lowerName = ledgerName.toLowerCase();
      // Heuristics for Taxes
      if (lowerName.includes('cgst') || lowerName.includes('central tax')) cgst += amount;
      else if (lowerName.includes('sgst') || lowerName.includes('state tax')) sgst += amount;
      else if (lowerName.includes('igst') || lowerName.includes('integrated tax')) igst += amount;
      else if (lowerName.includes('cess')) totalTax += amount;

      // Detect "Party" - excluding sales/purchase/tax/bank accounts
      const isSystemAccount = 
        lowerName.includes('sales') || 
        lowerName.includes('purchase') || 
        lowerName.includes('gst') || 
        lowerName.includes('tax') || 
        lowerName.includes('cash') || 
        lowerName.includes('bank') || 
        lowerName.includes('round off') ||
        lowerName.includes('discount');

      if (!partyName && !isSystemAccount) {
         partyName = ledgerName;
      }
      
      if (ledgerName === partyName) {
        mainAmount = amount;
      }
    }

    // Comprehensive Fallback Logic for Party & Amount
    if (!partyName && ledgerEntries.length > 0) {
      partyName = node.getElementsByTagName("PARTYLEDGERNAME")[0]?.textContent || ledgerEntries[0].ledgerName;
      mainAmount = ledgerEntries[0].amount;
    }
    
    // For Sales/Purchases, sometimes the mainAmount is the first entry
    if (mainAmount === 0 && ledgerEntries.length > 0) {
       mainAmount = ledgerEntries[0].amount;
    }

    totalTax += cgst + sgst + igst;

    vouchers.push({
      date,
      voucherNumber: voucherNumber || node.getAttribute("VCHNO") || `TALLY-${i}`,
      type,
      partyName: partyName || 'Unknown Party',
      amount: mainAmount,
      narration,
      ledgerEntries,
      cgst,
      sgst,
      igst,
      totalTax,
      inventoryEntries // Added for detailed records
    } as any);
  }

  return vouchers;
};
