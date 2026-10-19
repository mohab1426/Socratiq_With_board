/**
 * SmartBoard Gemini & WebSocket Client Service.
 * Connects to SocratiQ backend proxies (/api/v1/smartboard/*)
 */
import { apiBase } from "./api"

export const SMARTBOARD_API_BASE = `${apiBase()}/smartboard`

export const generateImageContent = async (prompt: string, size: "1K" | "2K" | "4K" = "1K"): Promise<string | null> => {
  try {
    const response = await fetch(`${SMARTBOARD_API_BASE}/generate-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, size })
    });
    const data = await response.json();
    return data.imageUrl || null;
  } catch (error) {
    console.error("Image generation failed:", error);
    return null;
  }
};

export const generateSimulationCode = async (prompt: string): Promise<string | null> => {
  try {
    const response = await fetch(`${SMARTBOARD_API_BASE}/generate-simulation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    const data = await response.json();
    return data.code || null;
  } catch (error) {
    console.error("Simulation generation failed:", error);
    return null;
  }
};

export const generateVectorDrawing = async (prompt: string): Promise<any[] | null> => {
  try {
    const response = await fetch(`${SMARTBOARD_API_BASE}/generate-vector`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    const data = await response.json();
    return data.elements || [];
  } catch (error) {
    console.error("Vector generation failed:", error);
    return null;
  }
};

export const sendChatProxy = async (messages: any[], screenshot: string | null, tools: any[], systemInstruction: string): Promise<any> => {
  try {
    const response = await fetch(`${SMARTBOARD_API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, screenshot, tools, systemInstruction })
    });
    const data = await response.json();
    if (!response.ok) {
      return { error: data.detail || data.message || `Server error (${response.status})` };
    }
    return data;
  } catch (error: any) {
    console.error("Chat failed:", error);
    return { error: error?.message || "Connection failed" };
  }
};

export const getLiveWebSocketUrl = (): string => {
  const base = apiBase();
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (base.startsWith('http')) {
    return base.replace(/^http/, 'ws') + '/smartboard/live';
  }
  return `${wsProtocol}//${window.location.host}${base}/smartboard/live`;
};
