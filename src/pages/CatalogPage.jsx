import { useEffect, useMemo, useState } from "react";
import { BookOpen, LogIn, LogOut, Loader2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useCatalog } from "../hooks/useCatalog";
import LoginModal from "../components/LoginModal";
import ClienteFiadoView from "./ClienteFiadoView";
import Styles from "../components/Styles";
import CardDetail from "../components/CardDetail";
import ComboIngredients from "../components/ComboIngredients";
import ProductImage from "../components/ProductImage";
import LogoEasterEgg from "../components/LogoEasterEgg";
import { formatSoles } from "../utils/format";
import logo from "../assets/logo.png";

// Copiado tal cual de App.jsx: mismo cálculo, mismo criterio de
// "disponible" — el catálogo público necesita saber si algo está
// agotado sin duplicar ninguna lógica de venta real.
function availabilityFor(product, stock) {
  if (!product.consumes || product.consumes.length === 0) return Infinity;
  return Math.min(
    ...product.consumes.map((c) => Math.floor((stock[c.key] ?? 0) / c.qty))
  );
}

// Ruta pública "/": mostrador de solo lectura, clon visual exacto del
// panel de Admin (mismo <Styles/>, mismas clases tz-) pero sin ninguna
// función operativa/contable — nada de stats, historial, ni acciones
// de venta. Los productos se ven, no se seleccionan: sin onClick, sin
// checkbox, sin selector de cantidad (ver .tz-card-readonly abajo).
export default function CatalogPage() {
  const { session, loading: authLoading, signOut } = useAuth();
  const { sections, productsById, stock, loading: catalogLoading, error } = useCatalog();
  const [activeTab, setActiveTab] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [fiadoOpen, setFiadoOpen] = useState(false);

  // El admin puede ocultar productos puntuales del catálogo público
  // (desde "Editar Stock" en /admin) sin dejar de venderlos en el POS.
  // Acá se filtran, y se descartan grupos/secciones que queden vacíos.
  const visibleSections = useMemo(
    () =>
      sections
        .map((section) => ({
          ...section,
          groups: section.groups
            .map((group) => ({
              ...group,
              items: group.items.filter((item) => item.visiblePublico !== false),
            }))
            .filter((group) => group.items.length > 0),
        }))
        .filter((section) => section.groups.length > 0),
    [sections]
  );

  useEffect(() => {
    setActiveTab((prev) => prev || visibleSections[0]?.key || "");
  }, [visibleSections]);

  const activeSection = visibleSections.find((s) => s.key === activeTab);

  const handleFiadosClick = () => {
    if (session) {
      setFiadoOpen(true);
    } else {
      setLoginOpen(true);
    }
  };

  if (catalogLoading) {
    return (
      <div className="tz-root tz-loading">
        <Styles />
        <Loader2 className="tz-spin" size={34} />
        <p>Cargando catálogo…</p>
      </div>
    );
  }

  return (
    <div className="tz-root">
      <Styles />
      <header className="tz-header">
        <div className="tz-header-row">
          <button
            className="tz-header-btn"
            onClick={handleFiadosClick}
            aria-label="Fiados"
          >
            <BookOpen size={19} />
            <span className="tz-header-btn-label">Fiados</span>
          </button>

          <div className="tz-header-center">
            <LogoEasterEgg src={logo} alt="TONAZO!" className="tz-logo" />
            <p className="tz-subtitle">Compra Ya</p>
          </div>

          {authLoading ? (
            <span className="tz-header-btn" style={{ visibility: "hidden" }} />
          ) : session ? (
            <button
              className="tz-header-btn"
              onClick={signOut}
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              <LogOut size={19} />
              <span className="tz-header-btn-label">Salir</span>
            </button>
          ) : (
            <button
              className="tz-header-btn"
              onClick={() => setLoginOpen(true)}
              aria-label="Ingresar"
            >
              <LogIn size={19} />
              <span className="tz-header-btn-label">Login</span>
            </button>
          )}
        </div>
      </header>

      <main className="tz-main">
        {/* ---------------- TABS ---------------- */}
        {visibleSections.length > 0 && (
          <nav className="tz-tabs">
            {visibleSections.map((s) => (
              <button
                key={s.key}
                className={`tz-tab ${activeTab === s.key ? "tz-tab-active" : ""} ${
                  s.label.trim().toLowerCase() === "combos" ? "tz-tab-combos" : ""
                }`}
                onClick={() => setActiveTab(s.key)}
              >
                {s.label}
              </button>
            ))}
          </nav>
        )}

        {/* ---------------- MOSTRADOR (solo lectura) ---------------- */}
        <section className="tz-products">
          {error ? (
            <div className="tz-empty">
              <p>{error}</p>
            </div>
          ) : !activeSection ? (
            <div className="tz-empty">
              <p>Todavía no hay productos publicados.</p>
            </div>
          ) : (
            activeSection.groups.map((group, gi) => (
              <div key={gi} className="tz-group">
                {group.title && (
                  <div className="tz-group-heading">
                    <span className="tz-badge">{group.numero}</span>
                    <h2>{group.title}</h2>
                  </div>
                )}
                <div className="tz-grid">
                  {group.items.map((item) => {
                    const avail = availabilityFor(item, stock);
                    const soldOut = avail <= 0;
                    const low = avail > 0 && avail <= 3;

                    return (
                      <div
                        key={item.id}
                        className={`tz-card tz-card-readonly ${
                          soldOut ? "tz-card-disabled" : ""
                        } ${item.esCombo ? "tz-card-combo" : ""}`}
                      >
                        <div className="tz-card-row">
                          <ProductImage item={item} editable={false} />
                          <div className="tz-card-main">
                            <div className="tz-card-top">
                              <div className="tz-card-info">
                                {item.combo && <span className="tz-combo">{item.combo}</span>}
                                <h3 className="tz-card-name">
                                  {item.name.split(/(\+)/).map((part, i) =>
                                    part === "+" ? (
                                      <span className="tz-name-plus" key={i}>
                                        +
                                      </span>
                                    ) : (
                                      <span key={i}>{part}</span>
                                    )
                                  )}
                                </h3>
                                <CardDetail item={item} />
                                <ComboIngredients item={item} productsById={productsById} />
                              </div>
                            </div>

                            <div className="tz-card-bottom">
                              <div className="tz-card-stockrow">
                                {soldOut ? (
                                  <span className="tz-tag tz-tag-danger">AGOTADO</span>
                                ) : low ? (
                                  <span className="tz-tag tz-tag-warn">¡Quedan {avail}!</span>
                                ) : (
                                  <span className="tz-tag tz-tag-ok">Disponible</span>
                                )}
                              </div>
                              <div className="tz-card-priceqty">
                                <div className="tz-price-block">
                                  <span className="tz-price-label">Precio</span>
                                  <span className="tz-price">{formatSoles(item.price)}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </section>
      </main>

      {loginOpen && (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          onSuccess={() => {
            setLoginOpen(false);
            setFiadoOpen(true);
          }}
        />
      )}
      {fiadoOpen && <ClienteFiadoView onClose={() => setFiadoOpen(false)} />}
    </div>
  );
}
