import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { db } from "../lib/butterbase";

type SignupState = "idle" | "submitting" | "verify";

export function SignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<SignupState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setState("submitting");

    const { data, error: signUpErr } = await db.auth.signUp({ email, password });
    if (signUpErr || !data?.user) {
      setError(signUpErr?.message ?? "Sign up failed.");
      setState("idle");
      return;
    }

    // Insert app-level user row so topics can reference users.id
    await db.from("users").insert({
      id: data.user.id,
      email: data.user.email,
      notify_channel: "slack",
    });

    setState("verify");
  }

  if (state === "verify") {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-logo" style={{ color: "var(--color-success, #059669)" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h1 className="auth-title">Check your email</h1>
          <p className="auth-subtitle">
            We sent a verification link to <strong>{email}</strong>.
            Click it to activate your account, then come back to sign in.
          </p>
          <Link to="/login" className="btn btn-primary auth-submit">
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z" />
            <path d="M12 8v4l3 3" />
          </svg>
        </div>
        <h1 className="auth-title">Create your account</h1>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="email">Email</label>
            <input
              id="email"
              className="form-input"
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input
              id="password"
              className="form-input"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="form-hint">
              Min 8 chars · uppercase · lowercase · number · special character
            </p>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="confirm">Confirm password</label>
            <input
              id="confirm"
              className="form-input"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary auth-submit"
            disabled={state === "submitting"}
          >
            {state === "submitting" ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account?{" "}
          <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
