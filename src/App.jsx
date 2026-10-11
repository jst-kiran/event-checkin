import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import CheckIn from './pages/CheckIn'
import AdminLogin from './pages/AdminLogin'
import AdminDashboard from './pages/AdminDashboard'
import ProtectedRoute from './components/ProtectedRoute'

/**
 * This event: the check-in desk (verify + check in) and an organizer
 * dashboard. The previous event's screens (lunch, project upload, teams,
 * projects) are gone; their URLs fall through to the catch-all below, and their
 * API endpoints no longer exist on the server, so nothing depends on hiding a
 * link.
 */
export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<CheckIn />} />
        <Route path="/checkin" element={<CheckIn />} />

        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />

        {/* A mistyped or retired URL should land somewhere useful, not on a
            404 that someone at the desk cannot act on. */}
        <Route path="*" element={<Navigate to="/checkin" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
