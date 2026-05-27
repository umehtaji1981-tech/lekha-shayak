import { GoogleGenAI } from "@google/genai";
import { TallyVoucher } from "./tallyImport";

// Note: In server-side Gemini apps, we usually proxy this. 
// But since we are full-stack, we will use /api/parse-document for safety if needed.
// However, the prompt asks for "for faster entry" and mentions JPEG/PDF.
// I will implement a client-safe proxy or call directly if we have a key.

export const parseDocumentWithAI = async (file: File): Promise<TallyVoucher[]> => {
  const base64Data = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });

  // Call our backend API to proxy the Gemini request to keep the key safe
  const response = await fetch('/api/ai/parse-bank-statement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: base64Data,
      mimeType: file.type
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to parse document with AI");
  }

  return response.json();
};
