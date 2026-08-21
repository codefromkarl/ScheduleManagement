"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "登录失败");
      }
      router.replace("/");
      router.refresh();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand-mark">G</div>
        <span className="login-kicker">PRIVATE WORKSPACE</span>
        <h1 id="login-title">进入 goalset</h1>
        <p>这是你的个人日程空间，请输入本地访问密码。</p>
        <form onSubmit={submit}>
          <label htmlFor="password">访问密码</label>
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
          {error && <div className="login-error" role="alert">{error}</div>}
          <Button className="login-submit" type="submit" disabled={pending}>{pending ? "验证中…" : "进入日程"}</Button>
        </form>
        <small>访问密码由当前部署环境配置。</small>
      </section>
    </main>
  );
}
