import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Initialize Gemini
  const genAI = new GoogleGenAI({ 
    apiKey: process.env.GEMINI_API_KEY || "",
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  // API Route for AI Processing of Bills/Statements
  const generateGeminiContent = async (
    genAIInstance: any, 
    modelName: string, 
    payload: { contents: any[]; config?: any }
  ): Promise<string> => {
    const modelsToTry = [
      modelName,
      "gemini-2.5-flash",
      "gemini-flash-latest",
      "gemini-3.5-flash"
    ].filter((value, index, self) => self.indexOf(value) === index); // unique values

    let lastError = null;

    for (const currentModel of modelsToTry) {
      try {
        console.log(`[AI] Attempting design with model: ${currentModel} with strict application/json...`);
        const response = await genAIInstance.models.generateContent({
          model: currentModel,
          contents: payload.contents,
          config: payload.config
        });
        const resText = response.text || "";
        // Try parsing to make sure it's valid JSON
        JSON.parse(resText);
        return resText;
      } catch (err: any) {
        console.error(`[AI] Error with model ${currentModel} in strict JSON mode:`, err);
        lastError = err;

        // Try standard markdown code block output mode as fallback
        try {
          console.log(`[AI] Fallback: Trying model ${currentModel} without responseMimeType constraint...`);
          const fallbackConfig = { ...payload.config };
          if (fallbackConfig.responseMimeType) {
            delete fallbackConfig.responseMimeType;
          }

          let fallbackPrompt = "";
          let otherParts: any[] = [];
          if (payload.contents && payload.contents[0] && payload.contents[0].parts) {
            fallbackPrompt = payload.contents[0].parts[0]?.text || "";
            otherParts = payload.contents[0].parts.slice(1);
          }

          if (!fallbackPrompt.toLowerCase().includes("return valid json")) {
            fallbackPrompt += "\n\nIMPORTANT: Return ONLY valid JSON. Make sure to wrap your JSON response in a single ```json ... ``` code block, and do not include any other conversational text or explanation.";
          }

          const fallbackContents = [
            {
              parts: [
                { text: fallbackPrompt },
                ...otherParts
              ]
            }
          ];

          const response = await genAIInstance.models.generateContent({
            model: currentModel,
            contents: fallbackContents,
            config: fallbackConfig
          });

          const textOutput = response.text || "";
          const jsonMatch = textOutput.match(/```json\s*([\s\S]*?)\s*```/) || textOutput.match(/```\s*([\s\S]*?)\s*```/);
          const jsonContent = jsonMatch ? jsonMatch[1].trim() : textOutput.trim();

          JSON.parse(jsonContent); // Validate it is indeed valid JSON
          return jsonContent;
        } catch (fallbackErr) {
          console.error(`[AI] Fallback for ${currentModel} failed:`, fallbackErr);
        }
      }
    }

    throw lastError || new Error("All AI parsing models and fallback options failed.");
  };

  app.post("/api/ai/process-document", async (req, res) => {
    try {
      const { fileData, mimeType, type } = req.body;
      
      const prompt = type === 'bill' 
        ? `You are an expert OCR, Indian billing, and GST document parsing assistant.
Your task is to analyze the attached billing document and extract its structural information correctly.

CRITICAL RULES:
1. IDENTIFY THE SUPPLIER (VENDOR) CORRECTLY (MOST IMPORTANT):
   - The supplier/vendor is the party billing/selling goods or services (the creditor who issued the invoice). Look for headings like: "Supplier (Bill from)", "Seller", "Sold by", "Invoice from", "Supplied by", "From:", or look for the party that owns the invoice header layout.
   - For example, if "M/s Patel Agency" is labeled as "Supplier (Bill from)", then "M/s Patel Agency" MUST be extracted as the 'vendorName', and their GSTIN (e.g., "23AAMFP4630R1ZQ") must be extracted as the 'gstin' of the vendor.
   - "Goodluck Traders" (the user's company name) is the BUYER / CUSTOMER / BILL TO / SHIP TO party in this setup. DO NOT extract Goodluck Traders as the vendorName. Goodluck Traders is the receiver of this purchase bill.
2. EXTRACT STRUCTURAL METADATA:
   - 'vendorName': Name of the creditor vendor selling goods (e.g. "M/s Patel Agency").
   - 'gstin': GSTIN of the creditor vendor. Be extremely careful to extract the selling vendor's GSTIN, NOT the customer's GSTIN (such as the customer's GSTIN "23AMIPB4686M1ZS").
   - 'invoiceNumber': The bill/invoice number (e.g. "1/26-27").
   - 'date': The billing date formatted as 'YYYY-MM-DD'. For example, if the date is "1-Apr-26", format it exactly as "2026-04-01".
3. EXTRACT TABLES AND TAXES:
   - 'items': An array of objects, one for each product/service line item in the table (ignore subtotal, tax rows, or round-off rows in this array):
     * 'name': Clean product/service name (e.g. "Cement").
     * 'qty': Total quantity as a number (e.g. 45 or 45.00). If it has space separated unit details, extract only the number (e.g. "45.00 bgs" becomes 45).
     * 'rate': Rate per unit as a number (e.g. 248.31).
     * 'amount': Item net taxable subtotal as a number (e.g., 11173.73).
   - 'subTotal': Subtotal net of taxes (e.g. 11173.73).
   - 'cgst': Central GST amount (if present) as a number (e.g. 1005.64).
   - 'sgst': State GST amount (if present) as a number (e.g. 1005.64).
   - 'igst': Integrated GST amount (if present) as a number (e.g. 0).
   - 'totalAmount': Grand total of the invoice as a number (e.g. 13185.00).

Return valid JSON matching this exact structure.`
        : "Extract transactions from this bank statement. Return JSON array of objects with: date, description, amount, type (credit/debit).";

      const text = await generateGeminiContent(genAI, "gemini-3.5-flash", {
        contents: [
          {
            parts: [
              { text: prompt },
              { inlineData: { data: fileData, mimeType } }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      });

      res.json({ result: JSON.parse(text) });
    } catch (error: any) {
      console.error("AI Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Route for AI Ledger Auto-Mapping suggestions
  app.post("/api/ai/suggest-ledger", async (req, res) => {
    try {
      const { description, ledgers } = req.body;
      const prompt = `You are a smart bank ledger reconciliation assistant.
We have an imported bank transaction narration/description: "${description}".
We have a list of available business ledger accounts:
${JSON.stringify(ledgers.map((l: any) => ({ id: l.id, name: l.name, group: l.group })))}

Your task is to:
1. Find the single best matching ledger from the list of available ledgers. Be highly intelligent: search for substrings, abbreviations, synonyms, or merchant categories (e.g. "CHG/SBI/9892" matches "Bank Charges & Commission"; "MOHIT CONSTR" matches "Mohit Constructions"; "FUEL/HP/MUM" matches "Vehicle Expense"; "A/C TRANSFER" might match "Bank Accounts" or a customer).
2. If a reasonably close match exists, return its "id" and "name". Set "isMatchFound" to true.
3. If NO suitable matching ledger exists in the current accounts, suggest a new ledger name and specify the standard accounting group it should belong to (e.g. "Indirect Expenses" for charges/fuel/salary, "Sundry Debtors" for a customer name, "Indirect Incomes" for interest).

Return a JSON response matching this exact structure:
{
  "isMatchFound": boolean,
  "matchedLedgerId": string | null,
  "matchedLedgerName": string | null,
  "suggestedLedgerName": string,
  "suggestedLedgerGroup": string,
  "reasoning": string
}`;

      const text = await generateGeminiContent(genAI, "gemini-3.5-flash", {
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      });

      res.json(JSON.parse(text));
    } catch (error: any) {
      console.error("AI Ledger Mapping Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Route for AI Processing of Bank Statements
  app.post("/api/ai/parse-bank-statement", async (req, res) => {
    try {
      const { data, mimeType } = req.body;
      
      const prompt = `
        You are an extremely precise bank statement parsers database.
        CRITICAL: This bank statement document contains multiple pages of transaction ledger rows. You MUST extract EVERY SINGLE transaction row across ALL pages of the statement, from page 1 to the very last page.
        Do NOT skip, summarize, collapse, truncate, or omit any single transaction under any circumstances. If the statement has 50 entries, output 50 JSON objects.

        For each transaction entry, return an object with:
        - date (string: format strictly YYYY-MM-DD)
        - voucherNumber (string: derived from entry UPI Reference ID, cheque ID, transaction reference number, or generated unique ID)
        - type (string: "Receipt" for deposits/credits, "Payment" for withdrawals/debits)
        - partyName (string: identified or guessed ledger name from description, e.g., "MOHIT CONSTRUCTIONS", "PANKAJ ", "GOOD LUCK TRADERS", "Zomato", etc. Keep it clear and literal)
        - amount (number: absolute numeric amount)
        - narration (string: full original, detailed transaction narration/description without any shortening or truncating)

        Return strictly ONLY the raw JSON array. Ensure 100% of all statement entries are processed.
      `;

      const text = await generateGeminiContent(genAI, "gemini-3.5-flash", {
        contents: [
          {
            parts: [
              { text: prompt },
              { inlineData: { data, mimeType } }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      });

      res.json(JSON.parse(text));
    } catch (error: any) {
      console.error("AI Bank Parse Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
