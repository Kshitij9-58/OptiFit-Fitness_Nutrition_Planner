import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App.jsx';
import { AuthProvider } from './lib/auth.jsx';
import './index.css';

// AuthProvider wraps the whole app so any component can ask who is signed in.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);