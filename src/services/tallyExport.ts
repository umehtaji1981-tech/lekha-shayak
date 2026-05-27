
/**
 * Tally XML Export Service
 * Generates XML files compatible with Tally.ERP 9 and TallyPrime
 */

const formatTallyDate = (dateStr: string) => {
  return dateStr.replace(/-/g, '');
};

const escapeXml = (unsafe: string) => {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
};

export const generateTallyXml = (transactions: any[], companyName: string) => {
  let xml = `<?xml version="1.0"?>
<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
     <SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>
    </STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">`;

  transactions.forEach((tx) => {
    const date = formatTallyDate(tx.date);
    const voucherType = tx.type; // Sales, Purchases, Receipt, Payment
    const partyName = tx.partyName;
    const isSales = voucherType === 'Sales';
    const isPurchase = voucherType === 'Purchases';
    const totalAmount = Number(tx.totalAmount) || 0;
    
    // Determine the main ledger based on type
    let ledgerName = '';
    if (isSales) ledgerName = 'Sales Account';
    else if (isPurchase) ledgerName = 'Purchase Account';
    else if (tx.type === 'Receipt' || tx.type === 'Payment') {
        ledgerName = tx.bankName || 'Cash';
    }

    xml += `
     <VOUCHER VCHTYPE="${escapeXml(voucherType)}" ACTION="Create" OBJVIEW="Accounting VoucherView">
      <DATE>${date}</DATE>
      <VOUCHERNUMBER>${escapeXml(tx.voucherNumber)}</VOUCHERNUMBER>
      <PARTYLEDGERNAME>${escapeXml(partyName)}</PARTYLEDGERNAME>
      <PERSISTEDVIEW>Accounting VoucherView</PERSISTEDVIEW>
      
      <!-- Party Ledger Entry -->
      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>${escapeXml(partyName)}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>${(isSales || tx.type === 'Payment') ? 'YES' : 'NO'}</ISDEEMEDPOSITIVE>
       <AMOUNT>${(isSales || tx.type === 'Payment') ? -totalAmount : totalAmount}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>

      <!-- Account Ledger Entry (Sales/Purchase/Bank) -->
      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>${escapeXml(ledgerName)}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>${(isSales || tx.type === 'Payment') ? 'NO' : 'YES'}</ISDEEMEDPOSITIVE>
       <AMOUNT>${(isSales || tx.type === 'Payment') ? totalAmount : -totalAmount}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
     </VOUCHER>`;
  });

  xml += `
    </TALLYMESSAGE>
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>`;

  return xml;
};

export const downloadTallyXml = (xml: string, filename: string) => {
  const blob = new Blob([xml], { type: 'text/xml' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
};
