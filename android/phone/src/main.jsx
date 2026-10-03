import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

// The same type and design tokens as the desktop — the phone is the same set,
// held in a hand.
import '@fontsource-variable/fraunces';
import '@fontsource-variable/schibsted-grotesk';
import '@fontsource/ibm-plex-mono';
import '@fontsource/ibm-plex-mono/500.css';

import '@pc/styles/tokens.css';
import '@pc/styles/themes.css';
import '@pc/styles/base.css';
import './styles/phone.css';
import './styles/motion.css';

import { installDownloads } from './lib/bridge.js';
import { installImageFade, installReveal, installScrollFlag } from './lib/motion.js';
import PhoneApp from './PhoneApp.jsx';

installDownloads();
installImageFade();
installScrollFlag();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <PhoneApp />
    </BrowserRouter>
  </React.StrictMode>,
);

// after the first paint, so the first screenful cascades in
requestAnimationFrame(() => installReveal());
