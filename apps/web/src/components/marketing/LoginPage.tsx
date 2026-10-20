import { useState } from "react";
import type { Auth } from "../../state/useAuth";
import { Alert } from "../ui";

export function LoginPage({ auth }: { auth: Auth }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <main className="login">
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await auth.login(username.trim(), password);
          } catch (err) {
            setError(err instanceof Error ? err.message : "登录失败");
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 className="login-title">登录推文工作台</h1>
        <p className="muted small">门店账号用于生成和发布本店推文；总部账号用于下发推广任务和系统设置。</p>
        <label className="field">
          <span>账号</span>
          <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="门店编号或总部账号" required />
        </label>
        <label className="field">
          <span>口令</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <Alert tone="danger">{error}</Alert>}
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy || !username.trim() || !password}>
          {busy ? "正在登录…" : "登录"}
        </button>
        <p className="muted small">首次部署的初始账号见服务端启动日志；登录后请在“设置”里修改口令。</p>
      </form>
    </main>
  );
}
