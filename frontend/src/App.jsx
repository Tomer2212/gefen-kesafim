import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import axios from "axios";
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
import RegisterPage from "./pages/RegisterPage";
import SuperAdminPage from "./pages/SuperAdminPage";
import UnsubscribePage from "./pages/UnsubscribePage";
import ProfilePage from "./pages/ProfilePage";

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
  { path: "/register", element: <RegisterPage /> },
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
  { path: "/profile", element: <PrivateRoute><ProfilePage /></PrivateRoute> },
  { path: "/super-admin", element: <PrivateRoute><SuperAdminPage /></PrivateRoute> },
  { path: "/set-password", element: <SetPasswordPage /> },
  { path: "/unsubscribe", element: <UnsubscribePage /> },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export default function App() {
  const [session, setSession] = useState(undefined);
  const keepAliveRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession ?? null);
      if (newSession) {
        if (!keepAliveRef.current) {
          keepAliveRef.current = setInterval(() => {
            axios.get("/health", { timeout: 5000 }).catch(() => {});
          }, 9 * 60 * 1000); // every 9 minutes — keeps Render dyno warm
        }
      } else {
        clearInterval(keepAliveRef.current);
        keepAliveRef.current = null;
      }
    });
    return () => {
      subscription.unsubscribe();
      clearInterval(keepAliveRef.current);
    };
  }, []);

  return (
    <SessionContext.Provider value={session}>
      <RouterProvider router={router} />
    </SessionContext.Provider>
  );
}
