import React from 'react';
import { createRoot } from 'react-dom/client';
import '../css/theme.css';
import '../css/lobby.css';
import '../css/arena.css';
import '../css/card-frame.css';
import '../css/deck-builder.css';
import '../css/fragments.css';
import '../css/card-dismantle.css';
import LobbyPage from './pages/LobbyPage.jsx';

createRoot(document.body).render(<LobbyPage />);
