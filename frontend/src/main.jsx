import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import '@fontsource-variable/fraunces';
import '@fontsource-variable/schibsted-grotesk';
import '@fontsource/ibm-plex-mono';
import '@fontsource/ibm-plex-mono/500.css';

// Skin fonts: Terminal (VT323), Bauhaus (Archivo + Archivo Black),
// Space (Space Grotesk + Inter). Aqua/Blueprint reuse system + Plex Mono.
import '@fontsource/vt323';
import '@fontsource/archivo/400.css';
import '@fontsource/archivo/600.css';
import '@fontsource/archivo/900.css';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/inter';

import './styles/tokens.css';
import './styles/themes.css';
import './styles/base.css';
import './styles/backdrop.css';

import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
