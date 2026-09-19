import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { SessionProvider, useSession } from "./session.tsx";
import { Login } from "./pages/Login.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Activities } from "./pages/Activities.tsx";
import { ActivityDetail } from "./pages/ActivityDetail.tsx";
import { Record } from "./pages/Record.tsx";
import { Coach } from "./pages/Coach.tsx";
import { Feed } from "./pages/Feed.tsx";
import { Settings } from "./pages/Settings.tsx";

export function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}

function Shell() {
  const { user, loading } = useSession();

  if (loading) return <div className="chargement">Chargement...</div>;
  if (!user) return <Login />;

  return (
    <div className="app">
      <nav className="nav">
        <div className="marque">
          <span className="pastille">⌚</span>
          Montre
        </div>
        <Item to="/" icon="📊" label="Accueil" />
        <Item to="/seance" icon="⏱️" label="Seance" />
        <Item to="/activites" icon="📁" label="Activites" />
        <Item to="/coach" icon="🎯" label="Coach" />
        <Item to="/flux" icon="👥" label="Flux" />
        <Item to="/reglages" icon="⚙️" label="Reglages" />
        <div className="bas">
          <Item to="/reglages" icon="🙂" label={user.displayName} />
        </div>
      </nav>

      <main className="contenu">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/seance" element={<Record />} />
          <Route path="/activites" element={<Activities />} />
          <Route path="/activites/:id" element={<ActivityDetail />} />
          <Route path="/coach" element={<Coach />} />
          <Route path="/flux" element={<Feed />} />
          <Route path="/reglages" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Item({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <NavLink to={to} end={to === "/"} className={({ isActive }) => (isActive ? "actif" : "")}>
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
}
