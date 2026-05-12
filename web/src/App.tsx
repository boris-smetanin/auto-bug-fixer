import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AddSpace } from '@/pages/AddSpace';
import { SpaceDashboard } from '@/pages/SpaceDashboard';
import { SpacesList } from '@/pages/SpacesList';

export function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
        <Routes>
          <Route path="/" element={<SpacesList />} />
          <Route path="/spaces/new" element={<AddSpace />} />
          <Route path="/spaces/:id" element={<SpaceDashboard />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
