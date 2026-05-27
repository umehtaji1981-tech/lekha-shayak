export const GST_STATES: { [key: string]: string } = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar",
  "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram",
  "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "25": "Daman & Diu",
  "26": "Dadra & Nagar Haveli", "27": "Maharashtra", "28": "Andhra Pradesh (Old)", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar Islands",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh"
};

export function validateGSTIN(gstin: string) {
  if (!gstin) return { valid: false, message: "GSTIN is required" };
  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  if (!gstinRegex.test(gstin)) return { valid: false, message: "Invalid GSTIN format (e.g. 07AAAAA1111A1Z1)" };
  
  const stateCode = gstin.substring(0, 2);
  const stateName = GST_STATES[stateCode];
  if (!stateName) return { valid: false, message: "Invalid State Code prefix" };

  const pan = gstin.substring(2, 12);
  
  // Mod 36 Checksum Validation (Luhn algorithm for alphanumeric string)
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const char = gstin[i];
    const val = chars.indexOf(char);
    if (val === -1) {
      return { valid: false, message: `Unexpected character '${char}' in GSTIN` };
    }
    const factor = (i % 2 === 0) ? 1 : 2;
    const product = val * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const remainder = sum % 36;
  const checkCode = (36 - remainder) % 36;
  const expectedCheckChar = chars[checkCode];
  const actualCheckChar = gstin[14];

  if (expectedCheckChar !== actualCheckChar) {
    return { 
      valid: false, 
      message: `Invalid GSTIN Checksum digit. Expected '${expectedCheckChar}', found '${actualCheckChar}'. Confirm GSTIN spelling.` 
    };
  }
  
  return { valid: true, stateName, stateCode, pan };
}

export function calculateGST(amount: number, rate: number, isInterState: boolean) {
  const gstAmount = (amount * rate) / 100;
  if (isInterState) {
    return { igst: gstAmount, cgst: 0, sgst: 0, total: amount + gstAmount };
  } else {
    const halfGst = gstAmount / 2;
    return { igst: 0, cgst: halfGst, sgst: halfGst, total: amount + gstAmount };
  }
}

export function numberToWords(num: number): string {
  const absoluteNum = Math.abs(num);
  if (absoluteNum === 0) return 'Zero Rupees Only';
  
  const parts = absoluteNum.toFixed(2).split('.');
  const rupees = parseInt(parts[0], 10);
  const paise = parseInt(parts[1], 10);

  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertLessThanOneThousand(n: number): string {
    if (n === 0) return '';
    let str = '';
    if (n >= 100) {
      str += ones[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
      if (n > 0) str += 'and ';
    }
    if (n >= 20) {
      str += tens[Math.floor(n / 10)] + ' ';
      n %= 10;
    }
    if (n > 0) {
      str += ones[n] + ' ';
    }
    return str.trim();
  }

  function convert(n: number): string {
    if (n === 0) return '';
    let result = '';
    
    // Crores (1,00,00,000)
    if (n >= 10000000) {
      result += convertLessThanOneThousand(Math.floor(n / 10000000)) + ' Crore ';
      n %= 10000000;
    }
    // Lakhs (1,00,000)
    if (n >= 100000) {
      result += convertLessThanOneThousand(Math.floor(n / 100000)) + ' Lakh ';
      n %= 100000;
    }
    // Thousands (1,000)
    if (n >= 1000) {
      result += convertLessThanOneThousand(Math.floor(n / 1000)) + ' Thousand ';
      n %= 1000;
    }
    // Hundreds
    if (n > 0) {
      result += convertLessThanOneThousand(n);
    }
    
    return result.trim();
  }

  let words = '';
  if (rupees > 0) {
    words += convert(rupees) + ' Rupees';
  }
  if (paise > 0) {
    if (rupees > 0) words += ' and ';
    words += convertLessThanOneThousand(paise) + ' Paise';
  }
  
  return (words.trim() + ' Only').replace(/\s+/g, ' ');
}

