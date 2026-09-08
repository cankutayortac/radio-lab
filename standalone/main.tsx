import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import NavigationTrainer from '../components/navigation-trainer';
import '../app/globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('Uygulama kökü bulunamadı.');
createRoot(root).render(
  <StrictMode>
    <NavigationTrainer />
  </StrictMode>,
);
