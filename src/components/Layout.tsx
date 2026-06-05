import { NavLink } from "react-router-dom";

export function Layout({ children }: { children: React.ReactNode }) {
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
      </nav>
      <main>{children}</main>
    </>
  );
}
