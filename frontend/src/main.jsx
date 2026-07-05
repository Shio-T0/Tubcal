import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

// Core fonts for the default Shōwa skins — eager so first paint has them.
import '@fontsource-variable/fraunces';
import '@fontsource-variable/schibsted-grotesk';
import '@fontsource/ibm-plex-mono';
import '@fontsource/ibm-plex-mono/500.css';

// Skin fonts (Terminal/Bauhaus/Space) load lazily via lib/skinFonts.js when
// their theme is selected — see state.jsx. Aqua/Blueprint reuse system + Plex Mono.

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
