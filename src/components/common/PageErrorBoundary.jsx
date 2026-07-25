import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Catches render crashes in the routed page so the app shell (nav, top bar,
// feedback button) stays alive. Before this existed, one bad page render
// white-screened the ENTIRE app — including the bug reporter, so people
// couldn't even tell us it happened. AppLayout keys this by pathname, so
// simply navigating elsewhere gives the next page a clean boundary.
export default class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    // console.error is hooked by errorLog, so the crash lands in the rolling
    // log that bug reports attach (production React doesn't log caught errors)
    console.error('Page crash:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <AlertTriangle className="w-10 h-10 mx-auto text-amber-500 mb-3" />
        <h2 className="font-display text-2xl tracking-wide">SOMETHING WENT WRONG</h2>
        <p className="text-sm text-muted-foreground mt-2">
          This page hit an error. The rest of the app still works — you can go back,
          try again, or use the Feedback button to send us a report.
        </p>
        <p className="text-[11px] text-muted-foreground/70 font-mono mt-3 break-words">
          {String(this.state.error?.message || this.state.error)}
        </p>
        <Button className="mt-5 gap-1.5" onClick={() => this.setState({ error: null })}>
          <RotateCcw className="w-4 h-4" /> Try again
        </Button>
      </div>
    );
  }
}
