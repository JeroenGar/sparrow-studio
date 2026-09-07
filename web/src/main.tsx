import { createRoot } from 'react-dom/client';
import App from './App';
import {loadCatalog} from './datasets';
import { prepareIsolation } from './isolation';
void prepareIsolation().then(async () => {
  if (import.meta.env.PROD && ['sparrowstudio.app', 'www.sparrowstudio.app'].includes(location.hostname)) {
    const beacon = document.createElement('script');
    beacon.type = 'module';
    beacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    beacon.dataset.cfBeacon = JSON.stringify({token: '570458f3f91e4805b21cdc84923f0057'});
    document.head.append(beacon);
  }
  createRoot(document.getElementById('root')!).render(<App loadDefaultExample/>);
  void loadCatalog().catch(()=>{});
});
