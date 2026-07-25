import React, { useState, useRef, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import TopBar from './TopBar';
import MobileMenu from './MobileMenu';
import { ThemeProvider } from '@/lib/ThemeContext';
import PageTransition from '@/components/common/PageTransition';
import PageErrorBoundary from '@/components/common/PageErrorBoundary';
import BugReporter from '@/components/common/BugReporter';
import TutorialModal from '@/components/common/TutorialModal';
import { useLocations, useRoles, useTeamMembers } from '@/lib/useAppData';
import { useCurrentMember } from '@/hooks/useCurrentMember';
import useRealtimeNotifications from '@/hooks/useRealtimeNotifications';
import useVersionCheck from '@/hooks/useVersionCheck';

// Primary tabs that should preserve their own scroll position
const PRIMARY_TABS = new Set(['/', '/schedule', '/roadmap', '/open-shifts']);

export default function AppLayout() {
  // Prefetch all reference data at layout level so every page/modal gets it instantly from cache
  useLocations();
  useRoles();
  useTeamMembers();
  // live notification toasts + bell refresh
  useRealtimeNotifications();
  // stale open tabs get an "Update now" prompt after each deploy
  useVersionCheck();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const { member } = useCurrentMember();
  const location = useLocation();

  // First time this person opens the app on this device, run the tour once.
  useEffect(() => {
    if (!member?.id) return;
    const key = `tch-tutorial-seen-${member.id}`;
    try {
      if (!localStorage.getItem(key)) {
        setTutorialOpen(true);
        localStorage.setItem(key, '1');
      }
    } catch { /* private mode — just skip the auto-tour */ }
  }, [member?.id]);
  const mainRef = useRef(null);
  const scrollPositions = useRef({});

  // Save scroll position when leaving a primary tab; restore when returning
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;

    const currentPath = location.pathname;

    // Restore saved position for primary tabs, reset for sub-routes
    if (PRIMARY_TABS.has(currentPath)) {
      const saved = scrollPositions.current[currentPath] || 0;
      el.scrollTop = saved;
    } else {
      el.scrollTop = 0;
    }

    // Save scroll on unmount / path change
    return () => {
      if (PRIMARY_TABS.has(currentPath)) {
        scrollPositions.current[currentPath] = el.scrollTop;
      }
    };
  }, [location.pathname]);

  return (
    <ThemeProvider>
      <div className="app-shell flex bg-background overflow-hidden">
        <Sidebar collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} />
        <MobileMenu open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />

        <div className="flex-1 flex flex-col min-w-0 h-full">
          <TopBar onMobileMenuOpen={() => setMobileMenuOpen(true)} onHelp={() => setTutorialOpen(true)} />
          <main
            ref={mainRef}
            className="flex-1 p-4 lg:p-6 pb-20 lg:pb-6 overflow-x-hidden overflow-y-auto"
            style={{ overscrollBehaviorY: 'none', minHeight: 0, WebkitOverflowScrolling: 'touch' }}
          >
            {/* keyed by path: navigating away from a crashed page resets the boundary */}
            <PageErrorBoundary key={location.pathname}>
              <PageTransition><Outlet /></PageTransition>
            </PageErrorBoundary>
          </main>
        </div>

        <MobileNav />
        <BugReporter />
        <TutorialModal open={tutorialOpen} onClose={() => setTutorialOpen(false)} />
      </div>
    </ThemeProvider>
  );
}