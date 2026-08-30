import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/600.css';
import '@fontsource/vazirmatn/700.css';
import '@xyflow/react/dist/style.css';
import './styles.css';
import './mobile-fix.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
