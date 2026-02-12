import type { Message as FCMMessage } from "firebase-admin/messaging";
import admin from "firebase-admin";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getConfigDir } from "../config/index.js";

let fcmApp: admin.app.App | null = null;

/**
 * Initialize FCM (Firebase Cloud Messaging) client.
 * Requires firebase-admin-sdk.json in OpenClaw config directory.
 */
export async function initializeFCM(): Promise<boolean> {
  try {
    const serviceAccountPath = resolve(getConfigDir(), "firebase-admin-sdk.json");
    const serviceAccount = JSON.parse(await readFile(serviceAccountPath, "utf-8"));

    fcmApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    console.log("✅ FCM initialized successfully");
    return true;
  } catch (error) {
    const err = error as Error;
    console.warn("⚠️  FCM initialization failed:", err.message);
    console.warn("   Push notifications will be disabled.");
    console.warn("   Place firebase-admin-sdk.json in OpenClaw config directory to enable.");
    return false;
  }
}

/**
 * Send push notification via FCM (Android) or APNs (iOS via FCM).
 */
export async function sendPushNotification(params: {
  pushToken: string;
  pushPlatform: "fcm" | "apns";
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<boolean> {
  if (!fcmApp) {
    console.warn("FCM not initialized, skipping push notification");
    return false;
  }

  try {
    const message: FCMMessage = {
      token: params.pushToken,
      notification: {
        title: params.title,
        body: params.body,
      },
      data: params.data || {},
      // Platform-specific config
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "messages",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
          },
        },
      },
    };

    const response = await admin.messaging().send(message);
    console.log(`✅ Push notification sent: ${response}`);
    return true;
  } catch (error) {
    const err = error as Error;
    console.error("❌ Push notification failed:", err.message);
    return false;
  }
}
