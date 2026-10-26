import React from 'react';
import { createRoot } from 'react-dom/client';
import '../css/theme.css';
import '../css/lobby.css';
import '../css/card-frame.css';
import LobbyPage from './pages/LobbyPage.jsx';

createRoot(document.body).render(<LobbyPage />);
