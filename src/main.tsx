import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './store/store';
import App from './App.tsx';
import { windowChannel } from './services/windowChannel';
import { initScreenPlacement } from './services/screenPlacement';
import { sanctumPlugin } from '@marginalia/sanctum';
import './styles.scss';
import '@fortawesome/fontawesome-free/css/all.min.css';

windowChannel.start(window);
void initScreenPlacement();
sanctumPlugin.register?.();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>
);
