# MediaUnderstanding Feature Overview

This document summarizes how the MediaUnderstanding feature works, where media attachments are received, minimal config for audio, and an example Web inbound message for audio.

## How MediaUnderstanding Works

MediaUnderstanding turns **incoming media** (images, audio, video) into **text** (transcriptions, descriptions) and merges that into the message context so the agent can reason over it. Implementation lives under **`src/media-understanding/`**.

### Entry Point

- **`src/auto-reply/reply/get-reply.ts`**  
  After `finalizeInboundContext(ctx)`, it calls:

  ```ts
  await applyMediaUnderstanding({
    ctx: finalized,
    cfg,
    agentDir,
    activeModel: { provider, model },
  });
  ```

  So every reply that goes through the auto-reply pipeline runs media understanding on the current `MsgContext` (unless `OPENCLAW_TEST_FAST=1`).

### Apply Flow (`src/media-understanding/apply.ts`)

1. **Normalize attachments**  
   `normalizeMediaAttachments(ctx)` produces a list of `MediaAttachment` from `ctx.MediaPath`, `ctx.MediaUrl`, `ctx.MediaType` and/or `ctx.MediaPaths`, `ctx.MediaUrls`, `ctx.MediaTypes` (see `attachments.ts`).

2. **Build cache**  
   `createMediaAttachmentCache(attachments)` so providers can resolve paths/URLs and read buffers.

3. **Run capabilities**  
   For **image**, **audio**, and **video** (in that order), it calls `runCapability(...)` with concurrency. Each capability checks config, scope, and attachment policy; selects attachments; resolves model entries; and runs provider/CLI (transcribe/describe).

4. **Write back to context**  
   Transcripts/descriptions are appended to `ctx.Body`, `ctx.Transcript` is set for audio, `ctx.MediaUnderstanding` and `ctx.MediaUnderstandingDecisions` are updated, and file blocks are added for non-audio attachments. Then `finalizeInboundContext(ctx, ...)` is called.

### Runner and Providers

- **Runner** (`src/media-understanding/runner.ts`): `runCapability` applies scope, selects attachments, resolves models, runs each attachment through providers. Image can be **skipped** when the primary chat model supports vision (image is sent to the model directly).
- **Model resolution**: Config-driven entries plus “auto” (e.g. local Whisper, Sherpa-ONNX, Deepgram for audio).
- **Providers** (`src/media-understanding/providers/`): OpenAI, Anthropic, Google, Groq, MiniMax, Deepgram (audio).

### Types (`src/media-understanding/types.ts`)

- **`MediaAttachment`**: `{ path?, url?, mime?, index }` — one normalized attachment.
- **`MediaUnderstandingOutput`**: `kind` (e.g. `audio.transcription`, `image.description`), `attachmentIndex`, `text`, `provider`, `model`.
- **`MediaUnderstandingDecision`**: capability, outcome, per-attachment attempt/chosen info.

---

## Where MediaAttachment Messages Are Received

**`MediaAttachment`** is not a separate message type. It is the **normalized shape** of media derived from **`MsgContext`**: media-understanding turns `MsgContext` into `MediaAttachment[]` via `normalizeAttachments(ctx)` in **`src/media-understanding/attachments.ts`**.

Incoming channel messages set media fields on `MsgContext` in these handlers:

| Channel   | File                                              | How media is set on context                                                                 |
|----------|----------------------------------------------------|----------------------------------------------------------------------------------------------|
| **Signal** | `src/signal/monitor/event-handler.ts`             | Fetches first attachment; sets `MediaPath`, `MediaType`, `MediaUrl` on `ctxPayload`.        |
| **Slack**  | `src/slack/monitor/message-handler/prepare.ts`    | `effectiveMedia` → `MediaPath`, `MediaType`, `MediaUrl` on finalized context.               |
| **Telegram** | `src/telegram/bot-message-context.ts`          | `allMedia` → single: `MediaPath`/`MediaType`/`MediaUrl`; multiple: `MediaPaths`/`MediaUrls`/`MediaTypes`. |
| **Line**   | `src/line/bot-message-context.ts`               | Same pattern as Telegram.                                                                   |
| **Web (WhatsApp)** | `src/web/auto-reply/monitor/process-message.ts` | `params.msg.mediaPath`, `mediaUrl`, `mediaType` copied onto `ctxPayload`.                   |

That same `MsgContext` then flows into the auto-reply pipeline and `applyMediaUnderstanding`, where **`normalizeAttachments(ctx)`** produces **`MediaAttachment[]`**.

---

## Minimal MediaUnderstanding Config for Audio

From **`src/config/types.tools.ts`** and **`src/media-understanding/resolve.ts`** / **`runner.ts`**:

- **`tools.media.audio.enabled`** must be **`true`** or the audio capability is skipped.
- At least one **model entry** is required. For a provider (e.g. Deepgram), set **`provider`**; **`model`** is optional and falls back to `DEFAULT_AUDIO_MODELS` (e.g. Deepgram → `"nova-3"`).
- **`type`** can be omitted; it defaults to `"provider"` when there is no `command`.

Minimal **audio-only** config:

```json
{
  "tools": {
    "media": {
      "audio": {
        "enabled": true,
        "models": [
          { "provider": "deepgram" }
        ]
      }
    }
  }
}
```

With an explicit model:

```json
{
  "tools": {
    "media": {
      "audio": {
        "enabled": true,
        "models": [
          { "provider": "deepgram", "model": "nova-2" }
        ]
      }
    }
  }
}
```

Other providers (e.g. OpenAI Whisper):

```json
"models": [
  { "provider": "openai", "model": "whisper-1" }
]
```

Deepgram requires an API key (profile/credentials). Optional per-entry overrides: `timeoutSeconds`, `maxBytes`, `language`, `profile`, etc.

---

## Example JSON Message Processed as Audio from Web

The Web pipeline builds the reply context from a **WebInboundMsg** (see **`src/web/inbound/types.ts`** and **`src/web/auto-reply/monitor/process-message.ts`**). For **audio**, the important fields are **`mediaPath`** and **`mediaType`** so that `processMessage` sets `MediaPath` / `MediaType` on the context and media-understanding runs audio on it.

Minimal **data-only** shape for such a message (the part representable as JSON; the real `WebInboundMessage` also has `sendComposing`, `reply`, `sendMedia`):

```json
{
  "id": "msg-1",
  "from": "491234567890",
  "conversationId": "491234567890",
  "to": "441234567890",
  "accountId": "default",
  "body": "",
  "chatType": "direct",
  "chatId": "491234567890@s.whatsapp.net",
  "mediaPath": "/tmp/openclaw/inbound/abc123.ogg",
  "mediaType": "audio/ogg",
  "timestamp": 1738765432000
}
```

- **`mediaPath`**: Absolute path to the downloaded audio file (Web inbox saves media under a path like `/tmp/openclaw/inbound/...` and sets this).
- **`mediaType`**: MIME type; for audio use e.g. `"audio/ogg"`, `"audio/mpeg"`, or `"audio/mp4"`.
- **`body`**: Can be `""`; when there is media, the pipeline may use a placeholder like `"<media:audio>"` or leave it empty.

---

## When the File Exists on the Client: How the Server Gets Audio

**The server does not get audio from a client file path.** A path on the client machine is not accessible to the server (different host, no shared filesystem). The server never reads the client’s filesystem.

### Web (WhatsApp) inbound

For Web/WhatsApp, the “client” is the WhatsApp session. Media is **not** sent as a path from the client. The gateway:

1. Receives the message from WhatsApp (Baileys).
2. **Downloads** the media from WhatsApp servers via `downloadInboundMedia()` (**`src/web/inbound/media.ts`**).
3. **Saves** the buffer to disk on the **server** with `saveMediaBuffer()` (**`src/web/inbound/monitor.ts`**).
4. Sets **`mediaPath`** to that **server-side** path (e.g. `/tmp/openclaw/inbound/...`).

So the path that becomes `mediaPath` is always on the machine running the gateway, after download. The client (WhatsApp user) never sends a path; the gateway fetches bytes and writes them locally.

### Gateway WebSocket (`chat.send`) inbound

When a **WebSocket client** (e.g. ClawApp, web UI) sends a message with an attachment:

- The client must send **file content**, not a path. The gateway expects **`attachments[]`** with **`content`** as **base64** (or an `ArrayBuffer`-like value that is converted to base64) — see **`src/gateway/server-methods/chat.ts`** (params `attachments`, normalized to base64).
- The server never receives or resolves a client-side path; it only receives the bytes (base64).
- **Images** are parsed by **`src/gateway/chat-attachments.ts`** (`parseMessageWithAttachments`) and passed as `images` into `dispatchInboundMessage`. **Audio** is supported: the gateway detects the **first audio** attachment (by `mimeType` or sniff), writes it to a temp file under **`media/gateway/`** via `saveMediaBuffer()`, and sets **`ctx.MediaPath`** and **`ctx.MediaType`** so media understanding can transcribe it. Only the first audio attachment is used (same as Web/Signal).

So: if the file exists on the client, the client must **read the file, encode it as base64, and send it in `attachments[].content`**. For audio, the server writes it to a server-side path and runs media understanding on that path.

---

Equivalent **context payload** passed into media understanding (after `finalizeInboundContext`), as populated from the message above:

```json
{
  "Body": "",
  "MediaPath": "/tmp/openclaw/inbound/abc123.ogg",
  "MediaType": "audio/ogg",
  "From": "491234567890",
  "To": "441234567890",
  "SessionKey": "whatsapp:default:491234567890",
  "ChatType": "direct",
  "Provider": "whatsapp",
  "Surface": "whatsapp"
}
```

---

## Doc Link

- Mintlify: [https://docs.openclaw.ai/](https://docs.openclaw.ai/) (link to media/queue docs as applicable).
