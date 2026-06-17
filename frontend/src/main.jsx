import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import '@fontsource-variable/fraunces';
import '@fontsource-variable/schibsted-grotesk';
import '@fontsource/ibm-plex-mono';
import '@fontsource/ibm-plex-mono/500.css';

import './styles/tokens.css';
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
