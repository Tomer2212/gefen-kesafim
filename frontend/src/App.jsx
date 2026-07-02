import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router-dom";
import { MeetingRemindersProvider } from "./context/MeetingRemindersContext";
import MeetingRemindersOverlay from "./components/MeetingRemindersOverlay";
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
import AddSchoolPage from "./pages/AddSchoolPage";

export const SessionContext = createContext(undefined);

// Returns false when session is absent OR access_token is within 60 seconds of expiry.
// Prevents PrivateRoute from rendering protected pages with an expired token while
// Supabase is still in the process of auto-refreshing (INITIAL_SESSION race condition).
function sessionIsValid(session) {
  if (!session?.access_token) return false;
  if (!session.expires_at) return true;
  return (session.expires_at - 60) > Math.floor(Date.now() / 1000);
}

function PrivateRoute({ children }) {
  const session = useContext(SessionContext);
  // Spinner while: (a) session unknown, or (b) session exists but token is expired
  // — case (b) happens when onAuthStateChange fires INITIAL_SESSION before auto-refresh completes
  if (session === undefined || (session !== null && !sessionIsValid(session))) return (
    <div className="min-h-screen flex items-center justify-center bg-scene"
         role="status" aria-label="טוען...">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"
           aria-hidden="true" />
    </div>
  );
  return session ? children : <Navigate to="/login" replace />;
}

function AdminRoute({ children }) {
  const session = useContext(SessionContext);
  if (session === undefined || (session !== null && !sessionIsValid(session))) return null;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

function AppLayout() {
  return (
    <>
      <Outlet />
      <MeetingRemindersOverlay />
    </>
  );
}

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
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
      { path: "/school/new", element: <AdminRoute><AddSchoolPage /></AdminRoute> },
      { path: "/notifications", element: <PrivateRoute><NotificationsPage /></PrivateRoute> },
      { path: "/profile", element: <PrivateRoute><ProfilePage /></PrivateRoute> },
      { path: "/super-admin", element: <PrivateRoute><SuperAdminPage /></PrivateRoute> },
      { path: "/set-password", element: <SetPasswordPage /> },
      { path: "/unsubscribe", element: <UnsubscribePage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
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
      <MeetingRemindersProvider>
        <RouterProvider router={router} />
      </MeetingRemindersProvider>
    </SessionContext.Provider>
  );
}
