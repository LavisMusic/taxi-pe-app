import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import { TaxiAuthProvider } from './contexts/TaxiAuthContext'
import RequireAdminMaster from './components/RequireAdminMaster'
import RequireUsuarioRol from './components/RequireUsuarioRol'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import LoginAdminPage from './pages/LoginAdminPage'
import RegistroConductorPage from './pages/RegistroConductorPage'
import RecuperarPinPage from './pages/RecuperarPinPage'
import AdminDashboardPage from './pages/AdminDashboardPage'
import RecolectorPage from './pages/RecolectorPage'
import ConductorPage from './pages/ConductorPage'

// Router de TaxiP. El árbol viejo (AuthProvider + CatalogPage + App.jsx
// "caja registradora") queda intacto en el repo sin importarse desde
// acá — sirve de referencia para migrar piezas del dashboard de admin
// en el siguiente paso, pero ya no es parte del flujo de rutas.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TaxiAuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/login-admin" element={<LoginAdminPage />} />
          <Route path="/registro-conductor" element={<RegistroConductorPage />} />
          <Route path="/recuperar-pin" element={<RecuperarPinPage />} />
          <Route
            path="/admin"
            element={
              <RequireAdminMaster>
                <AdminDashboardPage />
              </RequireAdminMaster>
            }
          />
          <Route
            path="/recolector"
            element={
              <RequireUsuarioRol rol="recolector">
                <RecolectorPage />
              </RequireUsuarioRol>
            }
          />
          <Route
            path="/conductor"
            element={
              <RequireUsuarioRol rol="conductor">
                <ConductorPage />
              </RequireUsuarioRol>
            }
          />
        </Routes>
      </BrowserRouter>
    </TaxiAuthProvider>
  </StrictMode>,
)
