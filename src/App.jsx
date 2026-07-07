import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import MapPage from './pages/MapPage';
import './App.css';
import { Lens } from './pages/Lens';
import LS from './pages/LS'; // ← добавлен импорт

const MenuItem = ({ to, name, note, onClick }) => {
  const location = useLocation();
  const isActive = location.pathname === to || (to === '/' && location.pathname === '/lens');

  return (
    <li>
      <Link to={to} className={isActive ? 'active' : ''} onClick={onClick}>
        <span className="nav-indicator" aria-hidden="true" />
        <span className="nav-copy">
          <span className="nav-title">{name}</span>
          <span className="nav-note">{note}</span>
        </span>
      </Link>
    </li>
  );
};

const initialMapData = {
  allStations: [],
  geojsonLines: [],
  failuresData: [],
  availableDevices: []
};

function App() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [mapData, setMapData] = useState(initialMapData);

  const updateMapData = useCallback((patch) => {
    setMapData((prev) => ({ ...prev, ...patch }));
  }, []);

  const menuItems = [
    { path: '/', name: 'Аналитика', note: 'Панель DataLens' },
    { path: '/map', name: 'Карта', note: 'География отказов' },
    { path: '/ls', name: 'Журнал', note: 'Данные ШЧ' } // ← добавлен пункт меню
  ];

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 768 && isMobileMenuOpen) {
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isMobileMenuOpen]);

  // Блокируем скролл body при открытом мобильном меню
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileMenuOpen]);

  const closeMenu = () => {
    if (isMobileMenuOpen) setIsMobileMenuOpen(false);
  };

  return (
    <BrowserRouter>
      <div className="app">
        <button
          className="mobile-menu-btn"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-label="Меню"
        >
          <span />
          <span />
          <span />
        </button>

        <nav className={`sidebar ${isMobileMenuOpen ? 'open' : ''}`}>
          <div className="logo">
            <span className="logo-kicker">Система мониторинга</span>
            <h1>ЗСИБ</h1>
          </div>
          <ul>
            {menuItems.map((item) => (
              <MenuItem
                key={item.path}
                to={item.path}
                name={item.name}
                note={item.note}
                onClick={closeMenu}
              />
            ))}
          </ul>
          <div className="sidebar-footer">
            <span className="sidebar-footer__label">Платформа</span>
            <strong>React / DataLens</strong>
          </div>
        </nav>

        {isMobileMenuOpen && (
          <div
            className="mobile-overlay"
            onClick={closeMenu}
          />
        )}

        <main className="content" onClick={closeMenu}>
          <Routes>
            <Route path="/" element={<Lens />} />
            <Route
              path="/map"
              element={<MapPage mapData={mapData} onMapDataChange={updateMapData} />}
            />
            <Route path="/lens" element={<Lens />} />
            <Route path="/ls" element={<LS />} /> {/* ← добавлен маршрут */}
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;