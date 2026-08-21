"use client";

import { useEffect } from "react";

function base64ToBytes(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function keysMatch(current: ArrayBuffer | null, expected: Uint8Array) {
  if (!current) return false;
  const currentBytes = new Uint8Array(current);
  return currentBytes.length === expected.length && currentBytes.every((value, index) => value === expected[index]);
}

export async function enablePwaNotifications() {
  try {
    const status = await fetch("/api/status", { cache: "no-store" }).then((response) => response.ok ? response.json() : null) as { pwaPublicKey?: string | null } | null;
    const publicKey = status?.pwaPublicKey;
    if (!publicKey) return { ok: false, message: "尚未配置 VAPID 公钥" };
    if (!window.isSecureContext) return { ok: false, message: "PWA 通知需要 HTTPS；本机 localhost 可直接测试" };
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return { ok: false, message: "当前浏览器不支持 PWA 通知" };
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, message: "通知权限未开启" };
    const registration = await navigator.serviceWorker.ready;
    const applicationServerKey = base64ToBytes(publicKey);
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !keysMatch(subscription.options.applicationServerKey, applicationServerKey)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    const response = await fetch("/api/pwa/subscription", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...subscription.toJSON(), userAgent: navigator.userAgent }) });
    return response.ok ? { ok: true, message: "PWA 提醒已开启" } : { ok: false, message: "PWA 订阅保存失败" };
  } catch (error) {
    const detail = error instanceof DOMException && error.name === "AbortError" ? "浏览器 Push Service 拒绝创建订阅" : "PWA 订阅创建失败";
    return { ok: false, message: `${detail}；请使用普通 Chrome 或手机 HTTPS 页面重试` };
  }
}

export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // PWA support is optional; the dashboard remains usable without it.
      });
    }
  }, []);

  return null;
}
