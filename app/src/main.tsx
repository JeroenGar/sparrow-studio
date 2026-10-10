import { createRoot } from 'react-dom/client';
import { prepareIsolation } from './engine/isolation';
import App from './ui/App';
import './styles.css';

void prepareIsolation().then(() => createRoot(document.getElementById('root')!).render(<App />));
