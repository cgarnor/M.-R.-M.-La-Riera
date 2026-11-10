import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// StrictMode is intentionally not used: its double effect invocation would dispose
// GPU buffers shared between the viewer geometries.
createRoot(document.getElementById('root')!).render(<App />);
