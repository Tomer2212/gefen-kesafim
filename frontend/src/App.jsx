import { createContext, useContext, useEffect, useState } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { supabase } from "./lib/supabase";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import SchoolPage from "./pages/SchoolPage";
import AdminPage from "./pages/AdminPage";
import MainPage from "./pages/MainPage";
import TermsPage from "./pages/TermsPage";
import PrivacyPage from "./pages/PrivacyPage";
import GuidePage from "./pages/GuidePage";
import ContactPage from "./pages/ContactPage";
import AccessibilityStatementPage from "./pages/AccessibilityStatementPage";
import NotificationsPage from "./pages/NotificationsPage";
import SetPasswordPage from "./pages/SetPasswordPage";

export const SessionContext = createContext(undefined);

function PrivateRoute({ children }) {
  const session = useContext(SessionContext);
  if (session === undefined) return null;
  return session ? children : <Navigate to="/login" replace />;
}

function AdminRoute({ children }) {
  const session = useContext(SessionContext);
  if (session === undefined) return null;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/terms", element: <TermsPage /> },
  { path: "/privacy", element: <PrivacyPage /> },
  { path: "/guide", element: <GuidePage /> },
  { path: "/contact", element: <ContactPage /> },
  { path: "/accessibility", element: <AccessibilityStatementPage /> },
  { path: "/", element: <PrivateRoute><DashboardPage /></PrivateRoute> },
  { path: "/school/:schoolId", element: <PrivateRoute><SchoolPage /></PrivateRoute> },
  { path: "/check", element: <PrivateRoute><MainPage /></PrivateRoute> },
  { path: "/admin", element: <AdminRoute><AdminPage /></AdminRoute> },
  { path: "/notifications", element: <PrivateRoute><NotificationsPage /></PrivateRoute> },
  { path: "/set-password", element: <SetPasswordPage /> },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export default function App() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <SessionContext.Provider value={session}>
      <RouterProvider router={router} />
    </SessionContext.Provider>
  );
}
