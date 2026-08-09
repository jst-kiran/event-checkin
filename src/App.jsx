import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import CheckIn from './pages/CheckIn'
import Lunch from './pages/Lunch'
import AdminLogin from './pages/AdminLogin'
import AdminDashboard from './pages/AdminDashboard'
import Teams from './pages/Teams'
import Projects from './pages/Projects'
import ProtectedRoute from './components/ProtectedRoute'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Check-in is what the QR code on the badge points at, so it is home. */}
        <Route path="/" element={<Navigate to="/checkin" replace />} />

        <Route path="/checkin" element={<CheckIn />} />
        <Route path="/lunch" element={<Lunch />} />

        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/teams"
          element={
            <ProtectedRoute>
              <Teams />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/projects"
          element={
            <ProtectedRoute>
              <Projects />
            </ProtectedRoute>
          }
        />

        {/* A mistyped URL at an event should land somewhere useful, not on a
            404 that an attendee cannot act on. */}
        <Route path="*" element={<Navigate to="/checkin" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
