import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AddSpace } from '@/pages/AddSpace';
import { FixAttemptDetail } from '@/pages/FixAttemptDetail';
import { SpaceDashboard } from '@/pages/SpaceDashboard';
import { SpacesList } from '@/pages/SpacesList';

export function App() {
  return (
    <TooltipProvider delayDuration={250}>
      <BrowserRouter>
        <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
          <Routes>
            <Route path="/" element={<SpacesList />} />
            <Route path="/spaces/new" element={<AddSpace />} />
            <Route path="/spaces/:id" element={<SpaceDashboard />} />
          <Route path="/spaces/:id/fix-attempts/:fid" element={<FixAttemptDetail />} />
          </Routes>
        </div>
      </BrowserRouter>
    </TooltipProvider>
  );
}
