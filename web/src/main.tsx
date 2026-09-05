import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { prepareIsolation } from './isolation';
void prepareIsolation().then(() => createRoot(document.getElementById('root')!).render(<App />));
