/// <reference types="vite/client" />
import './styles.css';

import { createRoot } from 'react-dom/client';

import App from './App';

// The @meshtastic/transport-web-bluetooth library calls readFromRadio() from a
// characteristicvaluechanged event listener without awaiting or catching errors.
// When a GATT write is in progress at the same moment, readValue() throws
// "GATT operation already in progress" as an unhandled rejection.  The
// connection is still alive — the next notification will retry the read — so
// we suppress this specific error rather than letting it appear as a crash.
window.addEventListener('unhandledrejection', (event) => {
  if (String(event.reason).includes('GATT operation already in progress')) {
    console.debug('[BLE] Suppressed GATT-busy unhandled rejection from transport layer');
    event.preventDefault();
  }
});

if (import.meta.env.DEV) {
  import('react').then((React) =>
    import('react-dom').then((ReactDOM) =>
      import('@axe-core/react').then((axe) => axe.default(React.default, ReactDOM.default, 1000)),
    ),
  );
}

createRoot(document.getElementById('root')!).render(<App />);
