import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { ReactNode } from "react";

export function Layout({ children }: { children: ReactNode }) {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <>
      <nav className="nav">
        <NavLink to="/" className="nav-brand">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z" />
            <path d="M12 8v4l3 3" />
          </svg>
          Research Brain
        </NavLink>

        <div className="nav-links">
          <NavLink to="/" end className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
            Topics
          </NavLink>
          <NavLink to="/topics/new" className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
            + New Topic
          </NavLink>
        </div>

        <div className="nav-user">
          <span className="nav-email">{session?.user?.email ?? ""}</span>
          <button className="btn btn-ghost btn-sm" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </nav>
      <main>{children}</main>
    </>
  );
}
