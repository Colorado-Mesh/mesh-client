/// <reference types="vite/client" />
import './styles.css';

import { createRoot } from 'react-dom/client';

import App from './App';

if (import.meta.env.DEV) {
  import('react').then((React) =>
    import('react-dom').then((ReactDOM) =>
      import('@axe-core/react').then((axe) => axe.default(React.default, ReactDOM.default, 1000)),
    ),
  );
}

createRoot(document.getElementById('root')!).render(<App />);
