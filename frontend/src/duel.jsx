import { createRoot } from 'react-dom/client';
import '../css/theme.css';
import '../css/card-frame.css';
import '../css/duel.css';
import DuelPage from './pages/DuelPage.jsx';

createRoot(document.getElementById('root')).render(<DuelPage />);
