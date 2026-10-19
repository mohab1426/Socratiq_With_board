"""SmartBoard API endpoints.
Provides real-time AI endpoints matching the SmartBoard reference:
- /api/v1/smartboard/config: API Key & service readiness
- /api/v1/smartboard/generate-image: AI Image generation proxy
- /api/v1/smartboard/generate-simulation: HTML/JS interactive simulation generator
- /api/v1/smartboard/generate-vector: Structured vector graphics generator
- /api/v1/smartboard/chat: Multimodal chat with board vision and tool calling
- WebSocket /api/v1/smartboard/live: Bi-directional WebSocket relay to Google Multimodal Live API
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
import websockets

log = logging.getLogger("socratiq.smartboard")

router = APIRouter(prefix="/smartboard", tags=["smartboard"])
SMARTBOARD_MODEL = os.getenv("SMARTBOARD_GEMINI_MODEL", "gemini-flash-lite-latest")


def _get_gemini_keys() -> list[str]:
    keys = []
    # Check all possible environment variables, prioritizing keys 2, 3, 4 then 1
    for key in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_STUDIO_API_KEY_2", "GOOGLE_AI_STUDIO_API_KEY_3", "GOOGLE_AI_STUDIO_API_KEY_4", "GOOGLE_AI_STUDIO_API_KEY_1", "AI_DEFAULT_API_KEY"):
        val = os.getenv(key)
        if val and val.strip() and val.strip() != "no":
            m = re.match(r"^\$\{([^}]+)\}$", val.strip())
            if m:
                nested = os.getenv(m.group(1))
                if nested and nested.strip() and nested.strip() != "no" and nested.strip() not in keys:
                    keys.append(nested.strip())
            elif val.strip() not in keys:
                keys.append(val.strip())
    return keys


def _get_gemini_key() -> Optional[str]:
    keys = _get_gemini_keys()
    return keys[0] if keys else None


class ImageGenIn(BaseModel):
    prompt: str
    size: str = "1K"


class SimulationGenIn(BaseModel):
    prompt: str


class VectorGenIn(BaseModel):
    prompt: str


class ChatMessageIn(BaseModel):
    role: str
    text: Optional[str] = ""
    audio: Optional[str] = None
    mime_type: Optional[str] = "audio/wav"


class ChatIn(BaseModel):
    messages: List[ChatMessageIn]
    screenshot: Optional[str] = None
    tools: Optional[List[Dict[str, Any]]] = None
    systemInstruction: Optional[str] = None


@router.get("/config")
def get_config():
    key = _get_gemini_key()
    return {"status": "online" if key else "no_key"}


@router.post("/generate-image")
async def generate_image(body: ImageGenIn):
    key = _get_gemini_key()
    if not key:
        raise HTTPException(status_code=503, detail="Gemini API key is not configured")

    prompt = f"{body.prompt}. Minimalist style, isolated subject on white background if possible, high quality."
    url = f"https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key={key}"
    
    # Try Imagen API first
    payload = {
        "instances": [{"prompt": prompt}],
        "parameters": {"sampleCount": 1, "aspectRatio": "1:1"}
    }
    
    import httpx
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            resp = await client.post(url, json=payload)
            if resp.status_code == 200:
                data = resp.json()
                predictions = data.get("predictions", [])
                if predictions and "bytesBase64Encoded" in predictions[0]:
                    b64 = predictions[0]["bytesBase64Encoded"]
                    mime = predictions[0].get("mimeType", "image/png")
                    return {"imageUrl": f"data:{mime};base64,{b64}"}
        except Exception as e:
            log.warning("Imagen direct API attempt failed: %s", e)

        # Fallback to generateContent with gemini-2.5-flash / image preview if supported
        fallback_url = f"https://generativelanguage.googleapis.com/v1beta/models/{SMARTBOARD_MODEL}:generateContent?key={key}"
        fb_payload = {
            "contents": [{"parts": [{"text": f"Generate a detailed visual illustration for: {prompt}"}]}]
        }
        try:
            resp = await client.post(fallback_url, json=fb_payload)
            if resp.status_code == 200:
                data = resp.json()
                for cand in data.get("candidates", []):
                    for part in cand.get("content", {}).get("parts", []):
                        if "inlineData" in part:
                            inline = part["inlineData"]
                            return {"imageUrl": f"data:{inline.get('mimeType', 'image/jpeg')};base64,{inline['data']}"}
        except Exception as e:
            log.warning("Image fallback failed: %s", e)

    # Return placeholder svg if external generative image fails
    placeholder_svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="100%" height="100%" fill="#f1f5f9"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#64748b">{body.prompt[:40]}</text></svg>'
    import base64
    b64_svg = base64.b64encode(placeholder_svg.encode()).decode()
    return {"imageUrl": f"data:image/svg+xml;base64,{b64_svg}"}


@router.post("/generate-simulation")
async def generate_simulation(body: SimulationGenIn):
    key = _get_gemini_key()
    if not key:
        raise HTTPException(status_code=503, detail="Gemini API key is not configured")

    system_prompt = (
        f'Create a self-contained, interactive HTML/JS simulation for: "{body.prompt}".\n'
        '- Use Tailwind CSS for styling.\n'
        '- Important: Use a clean, modern design with a WHITE background (bg-white) and dark text (text-slate-900) to fit a light-mode whiteboard.\n'
        '- It must fit within a 500x400px container.\n'
        '- Return ONLY the HTML code (no markdown fences).\n'
        '- Ensure it is visually appealing, responsive and fully interactive.'
    )
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{SMARTBOARD_MODEL}:generateContent?key={key}"
    payload = {
        "contents": [{"parts": [{"text": system_prompt}]}]
    }

    import httpx
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=payload)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=f"Gemini error: {resp.text}")
        data = resp.json()
        try:
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            code = text.replace("```html", "").replace("```", "").strip()
            return {"code": code}
        except (KeyError, IndexError):
            raise HTTPException(status_code=500, detail="Malformed model response")


@router.post("/generate-vector")
async def generate_vector(body: VectorGenIn):
    key = _get_gemini_key()
    if not key:
        raise HTTPException(status_code=503, detail="Gemini API key is not configured")

    prompt = (
        f'Generate a vector drawing for: "{body.prompt}".\n'
        'Return a JSON object with an "elements" property containing an array of shapes.\n'
        'Supported shapes:\n'
        '- {"type": "rect", "x": 0, "y": 0, "width": 100, "height": 80, "color": "#2563eb", "filled": true}\n'
        '- {"type": "circle", "x": 50, "y": 50, "radius": 40, "color": "#ef4444", "filled": true}\n'
        '- {"type": "triangle", "x": 0, "y": 0, "width": 80, "height": 80, "color": "#16a34a", "filled": true}\n'
        '- {"type": "line", "x1": 0, "y1": 0, "x2": 100, "y2": 100, "color": "#000000", "strokeWidth": 3}\n'
        '- {"type": "path", "pathData": "M 0 0 L 50 50", "color": "#000000", "strokeWidth": 3}\n'
        'Coordinates should be relative to (0,0) as the top-left of the drawing.\n'
        'Output ONLY valid JSON.'
    )
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{SMARTBOARD_MODEL}:generateContent?key={key}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"}
    }

    import httpx
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=payload)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=f"Gemini error: {resp.text}")
        data = resp.json()
        try:
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            parsed = json.loads(text)
            return parsed
        except Exception as e:
            log.warning("Vector parsing error: %s", e)
            return {"elements": []}


@router.post("/chat")
async def chat(body: ChatIn):
    key = _get_gemini_key()
    if not key:
        raise HTTPException(status_code=503, detail="Gemini API key is not configured")

    contents = []
    for m in body.messages:
        parts = []
        if m.text:
            parts.append({"text": m.text})
        if m.audio:
            clean_audio = m.audio.split(",")[-1] if "," in m.audio else m.audio
            parts.append({
                "inlineData": {
                    "mimeType": m.mime_type or "audio/wav",
                    "data": clean_audio
                }
            })
        if not parts:
            parts.append({"text": ""})
        contents.append({
            "role": "user" if m.role == "user" else "model",
            "parts": parts
        })

    # If screenshot provided, attach to last user message
    if body.screenshot and contents:
        last_user = next((c for c in reversed(contents) if c["role"] == "user"), None)
        if last_user:
            clean_b64 = body.screenshot.split(",")[-1] if "," in body.screenshot else body.screenshot
            last_user["parts"].append({
                "inlineData": {
                    "mimeType": "image/jpeg",
                    "data": clean_b64
                }
            })

    config: Dict[str, Any] = {}
    if body.tools:
        config["tools"] = [{"functionDeclarations": body.tools}]
    if body.systemInstruction:
        config["systemInstruction"] = {"parts": [{"text": body.systemInstruction}]}

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{SMARTBOARD_MODEL}:generateContent?key={key}"
    payload = {
        "contents": contents,
        **({"tools": config["tools"]} if "tools" in config else {}),
        **({"systemInstruction": config["systemInstruction"]} if "systemInstruction" in config else {})
    }

    import httpx
    import base64

    # Validate audio base64 if present
    for idx, m in enumerate(body.messages):
        if m.audio:
            if len(m.audio) > 10 * 1024 * 1024:  # 10MB limit
                raise HTTPException(status_code=413, detail="Audio payload too large (max 10MB)")
            try:
                clean_audio = m.audio.split(",")[-1] if "," in m.audio else m.audio
                base64.b64decode(clean_audio, validate=True)
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid audio base64 payload")

    async with httpx.AsyncClient(timeout=45.0) as client:
        try:
            resp = await client.post(url, json=payload)
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Gemini API timed out")
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"Failed to communicate with Gemini: {str(e)}")

        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=f"Gemini error: {resp.text}")
        data = resp.json()
        
        reply_text = None
        function_calls = []
        try:
            parts = data["candidates"][0]["content"]["parts"]
            for p in parts:
                if "text" in p and not reply_text:
                    reply_text = p["text"]
                if "functionCall" in p:
                    function_calls.append({"functionCall": p["functionCall"]})
        except (KeyError, IndexError):
            pass

        return {"text": reply_text, "functionCalls": function_calls}


@router.websocket("/live")
async def live_relay(client_ws: WebSocket):
    await client_ws.accept()
    keys = _get_gemini_keys()
    if not keys:
        await client_ws.close(code=1011, reason="Gemini API key is not configured")
        return

    # Receive initial setup message from client
    try:
        first_msg = await client_ws.receive()
    except Exception:
        return

    setup_text = first_msg.get("text")
    setup_bytes = first_msg.get("bytes")
    if not setup_text and not setup_bytes:
        await client_ws.close(code=1008, reason="Missing setup message")
        return

    connected_ws = None
    for key in keys:
        google_url = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key={key}"
        try:
            g_ws = await websockets.connect(google_url)
            if setup_text:
                await g_ws.send(setup_text)
            else:
                await g_ws.send(setup_bytes)
            ack = await asyncio.wait_for(g_ws.recv(), timeout=5)
            if isinstance(ack, bytes):
                try:
                    await client_ws.send_text(ack.decode("utf-8"))
                except UnicodeDecodeError:
                    await client_ws.send_bytes(ack)
            else:
                await client_ws.send_text(ack)
            connected_ws = g_ws
            break
        except Exception as e:
            log.warning("Live WebSocket setup failed on key, trying fallback: %s", str(e)[:100])
            try:
                await g_ws.close()
            except Exception:
                pass

    if not connected_ws:
        await client_ws.close(code=1011, reason="All Gemini API keys failed or exceeded quota")
        return

    google_ws = connected_ws
    stop_event = asyncio.Event()

    async def client_to_google():
        try:
            while not stop_event.is_set():
                msg = await client_ws.receive()
                if "text" in msg and msg["text"]:
                    await google_ws.send(msg["text"])
                elif "bytes" in msg and msg["bytes"]:
                    await google_ws.send(msg["bytes"])
        except WebSocketDisconnect:
            pass
        except Exception as e:
            log.warning("client_to_google interrupted: %s", e)
        finally:
            stop_event.set()

    async def google_to_client():
        try:
            async for message in google_ws:
                if stop_event.is_set():
                    break
                if isinstance(message, bytes):
                    try:
                        await client_ws.send_text(message.decode("utf-8"))
                    except UnicodeDecodeError:
                        await client_ws.send_bytes(message)
                elif isinstance(message, str):
                    await client_ws.send_text(message)
                else:
                    await client_ws.send_bytes(message)
        except Exception as e:
            log.warning("google_to_client interrupted: %s", e)
        finally:
            stop_event.set()

    try:
        done, pending = await asyncio.wait(
            [asyncio.create_task(client_to_google()), asyncio.create_task(google_to_client())],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
    finally:
        try:
            await google_ws.close()
        except Exception:
            pass
        try:
            await client_ws.close()
        except Exception:
            pass
