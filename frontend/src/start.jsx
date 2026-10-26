import React from 'react';
import { createRoot } from 'react-dom/client';
import '../css/theme.css';
import '../css/start.css';
import StartPage from './pages/StartPage.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <StartPage />
  </React.StrictMode>
);
